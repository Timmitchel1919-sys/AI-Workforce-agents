/**
 * AccessService — AUTHZ-1 operator access lifecycle.
 *
 * Firebase Authentication says WHO a user is; this service decides WHAT they
 * may do. It is the only writer of `OperatorAccount` records and the only
 * source of an `OperatorPrincipal`:
 *
 *   verified identity → account (by Firebase UID) → ACTIVE + role → principal
 *   anything else (no account, pending, rejected, suspended, revoked) → none
 *
 * Rules enforced here (never in the browser):
 *   - a new identity is recorded as PENDING — never granted anything;
 *   - only an active administrator (`manage_access`) changes accounts;
 *   - an administrator cannot change their own account;
 *   - a granted role can never outrank the granting role (least privilege);
 *   - project scopes must name registered projects;
 *   - the last active administrator cannot be suspended, revoked or demoted
 *     (enforced atomically by the store);
 *   - the initial administrator bootstrap works once, then locks.
 * Every change is audited (`access_event`), with no token or credential.
 */
import {
  NotFoundError,
  OPERATOR_ROLES,
  PermissionDeniedError,
  ROLE_RANK,
  StateTransitionError,
  ValidationError,
  capabilitiesFor,
  isActiveAdmin,
  operatorCan,
  principalFor,
  type MyAccessView,
  type OperatorAccount,
  type OperatorAccountStatus,
  type OperatorAccountStore,
  type OperatorAccountView,
  type OperatorPrincipal,
  type OperatorRole,
  type VerifiedIdentity,
} from "../../contracts/index.js";
import { type AuditLog } from "../audit/audit-log.js";
import { now } from "../shared.js";

export interface AccessServiceOptions {
  store: OperatorAccountStore;
  audit: AuditLog;
  /** Project existence for scope validation (the ProjectRegistry). */
  projects: { has(projectId: string): boolean };
  clock?: () => string;
}

export interface AccessActor {
  principal: OperatorPrincipal;
  correlationId?: string;
}

export type AccessAction =
  "approve" | "reject" | "suspend" | "reactivate" | "revoke" | "change_role";

/** Which statuses each action may start from, and where it leads. */
const TRANSITIONS: Record<
  AccessAction,
  { from: readonly OperatorAccountStatus[]; to: OperatorAccountStatus }
> = {
  approve: { from: ["pending", "rejected"], to: "active" },
  reject: { from: ["pending"], to: "rejected" },
  suspend: { from: ["active"], to: "suspended" },
  reactivate: { from: ["suspended"], to: "active" },
  revoke: { from: ["active", "suspended"], to: "revoked" },
  change_role: { from: ["active"], to: "active" },
};

const MAX_REASON = 500;

export class AccessService {
  private readonly clock: () => string;

  constructor(private readonly options: AccessServiceOptions) {
    this.clock = options.clock ?? now;
  }

  /* -------------------------------------------------------------- */
  /* Authorization resolution                                      */
  /* -------------------------------------------------------------- */

  /** The principal for an identity, or null unless the account is ACTIVE. */
  async resolvePrincipal(
    identity: VerifiedIdentity,
  ): Promise<OperatorPrincipal | null> {
    return principalFor(await this.options.store.get(identity.uid));
  }

  /**
   * `GET /api/me/access`. A first visit records a PENDING access request —
   * never access. Profile fields are refreshed from the verified token.
   */
  async myAccess(identity: VerifiedIdentity): Promise<MyAccessView> {
    let account = await this.options.store.get(identity.uid);
    if (!account) {
      const timestamp = this.clock();
      const pending: OperatorAccount = {
        id: identity.uid,
        status: "pending",
        allowedProjects: [],
        ...profile(identity),
        requestedAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
      };
      const result = await this.options.store.commit({
        kind: "create_pending",
        account: pending,
      });
      if (result === "committed") {
        this.record("access_requested", identity.uid, identity.uid, {
          toStatus: "pending",
        });
      }
      account = (await this.options.store.get(identity.uid)) ?? pending;
    } else if (profileChanged(account, identity)) {
      const refreshed: OperatorAccount = {
        ...account,
        ...profile(identity),
        updatedAt: this.clock(),
        revision: account.revision + 1,
      };
      try {
        await this.options.store.commit({
          kind: "update",
          account: refreshed,
          expectedRevision: account.revision,
          activeAdminDelta: 0,
        });
        account = refreshed;
      } catch {
        // A concurrent change wins; the profile refresh is best effort.
      }
    }
    const authorized = account.status === "active" && Boolean(account.role);
    return {
      authenticated: true,
      authorized,
      status: account.status,
      ...(authorized && account.role ? { role: account.role } : {}),
      ...(authorized ? { allowedProjects: account.allowedProjects } : {}),
      capabilities: capabilitiesFor(account),
    };
  }

  /* -------------------------------------------------------------- */
  /* Administration                                                */
  /* -------------------------------------------------------------- */

  async listAccounts(
    principal: OperatorPrincipal,
  ): Promise<OperatorAccountView[]> {
    this.requireManage(principal);
    const order: Record<OperatorAccountStatus, number> = {
      pending: 0,
      active: 1,
      suspended: 2,
      rejected: 3,
      revoked: 4,
    };
    return (await this.options.store.list())
      .sort(
        (a, b) =>
          order[a.status] - order[b.status] ||
          a.requestedAt.localeCompare(b.requestedAt) ||
          a.id.localeCompare(b.id),
      )
      .map((account) => toView(account, principal.id));
  }

  /**
   * Apply one administrative action. Validation order: capability → target
   * exists → not self → allowed transition → role/scope → atomic commit.
   */
  async apply(
    action: AccessAction,
    actor: AccessActor,
    input: {
      operatorId: string;
      role?: unknown;
      allowedProjects?: unknown;
      reason?: unknown;
    },
  ): Promise<OperatorAccountView> {
    const { principal } = actor;
    this.requireManage(principal);
    const operatorId = requireId(input.operatorId);
    const current = await this.options.store.get(operatorId);
    if (!current) throw new NotFoundError("unknown operator account");
    if (operatorId === principal.id) {
      throw new PermissionDeniedError(
        "administrators cannot change their own access",
      );
    }
    const transition = TRANSITIONS[action];
    if (!transition.from.includes(current.status)) {
      throw new StateTransitionError(
        `cannot ${action.replace("_", " ")} an account that is ${current.status}`,
      );
    }

    const reason = optionalReason(input.reason);
    let role = current.role;
    let allowedProjects = current.allowedProjects;
    if (action === "approve" || action === "change_role") {
      role = this.grantableRole(principal, input.role);
      allowedProjects =
        input.allowedProjects === undefined && action === "change_role"
          ? current.allowedProjects
          : this.validScope(input.allowedProjects);
    }
    if (
      action === "change_role" &&
      role === current.role &&
      JSON.stringify(allowedProjects) ===
        JSON.stringify(current.allowedProjects)
    ) {
      throw new ValidationError("the role and project scope are unchanged");
    }

    const timestamp = this.clock();
    const next: OperatorAccount = {
      ...current,
      status: transition.to,
      ...(role ? { role } : {}),
      allowedProjects,
      decidedBy: principal.id,
      decidedAt: timestamp,
      updatedAt: timestamp,
      revision: current.revision + 1,
      ...(reason ? { statusReason: reason } : {}),
    };
    if (!reason) delete next.statusReason;

    const before = isActiveAdmin(current);
    const after = isActiveAdmin(next);
    await this.options.store.commit({
      kind: "update",
      account: next,
      expectedRevision: current.revision,
      activeAdminDelta: before === after ? 0 : after ? 1 : -1,
    });

    this.record(eventFor(action), principal.id, operatorId, {
      fromStatus: current.status,
      toStatus: next.status,
      ...(current.role !== next.role
        ? { fromRole: current.role, toRole: next.role }
        : next.role
          ? { role: next.role }
          : {}),
      allowedProjects: next.allowedProjects,
      ...(actor.correlationId ? { correlationId: actor.correlationId } : {}),
    });
    return toView(next, principal.id);
  }

  /* -------------------------------------------------------------- */
  /* Initial administrator bootstrap (trusted server-side tool)    */
  /* -------------------------------------------------------------- */

  /**
   * Provision the FIRST administrator for an existing Firebase identity.
   * Idempotent for the same identity; refused once any administrator exists.
   * Never reachable through the HTTP API.
   */
  async bootstrapInitialAdmin(
    identity: VerifiedIdentity,
  ): Promise<"created" | "already_provisioned"> {
    const current = await this.options.store.get(identity.uid);
    const timestamp = this.clock();
    const account: OperatorAccount = {
      ...(current ?? { requestedAt: timestamp }),
      id: identity.uid,
      status: "active",
      role: "admin",
      allowedProjects: "*",
      ...profile(identity),
      decidedBy: "bootstrap",
      decidedAt: timestamp,
      updatedAt: timestamp,
      bootstrap: true,
      revision: (current?.revision ?? 0) + 1,
    } as OperatorAccount;
    delete account.statusReason;
    try {
      const result = await this.options.store.commit({
        kind: "bootstrap",
        account,
      });
      if (result === "already_provisioned") {
        this.record(
          "bootstrap_already_provisioned",
          "bootstrap",
          identity.uid,
          {},
        );
        return "already_provisioned";
      }
      this.record("initial_admin_bootstrapped", "bootstrap", identity.uid, {
        fromStatus: current?.status,
        toStatus: "active",
        toRole: "admin",
      });
      return "created";
    } catch (error) {
      this.record("bootstrap_refused", "bootstrap", identity.uid, {
        reason: error instanceof Error ? error.name : "error",
      });
      throw error;
    }
  }

  /* -------------------------------------------------------------- */
  /* Internals                                                     */
  /* -------------------------------------------------------------- */

  private requireManage(principal: OperatorPrincipal): void {
    if (!principal || !operatorCan(principal, "manage_access")) {
      throw new PermissionDeniedError(
        "managing access requires the administrator role",
      );
    }
  }

  private grantableRole(
    principal: OperatorPrincipal,
    raw: unknown,
  ): OperatorRole {
    if (
      typeof raw !== "string" ||
      !(OPERATOR_ROLES as readonly string[]).includes(raw)
    ) {
      throw new ValidationError(
        `role must be one of ${OPERATOR_ROLES.join(", ")}`,
      );
    }
    const role = raw as OperatorRole;
    if (ROLE_RANK[role] > ROLE_RANK[principal.role]) {
      throw new PermissionDeniedError("cannot grant a role above your own");
    }
    return role;
  }

  private validScope(raw: unknown): readonly string[] | "*" {
    if (raw === "*") return "*";
    if (
      !Array.isArray(raw) ||
      raw.length === 0 ||
      !raw.every((p) => typeof p === "string")
    ) {
      throw new ValidationError(
        'allowedProjects must be "*" or a non-empty list of project ids',
      );
    }
    const unique = [...new Set(raw as string[])].sort();
    const unknown = unique.filter((p) => !this.options.projects.has(p));
    if (unknown.length > 0) {
      throw new ValidationError("allowedProjects contains unknown projects");
    }
    return unique;
  }

  private record(
    action: string,
    actor: string,
    operatorId: string,
    data: Record<string, unknown>,
  ): void {
    this.options.audit.record("access_event", {
      data: { action, actor, operatorId, ...data },
    });
  }
}

function eventFor(action: AccessAction): string {
  return {
    approve: "access_approved",
    reject: "access_rejected",
    suspend: "operator_suspended",
    reactivate: "operator_reactivated",
    revoke: "access_revoked",
    change_role: "operator_role_changed",
  }[action];
}

function requireId(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError("operatorId is required");
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new ValidationError("operatorId is not a valid identifier");
  }
  return value;
}

function optionalReason(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ValidationError("reason must be text");
  }
  const reason = value.trim();
  if (reason.length > MAX_REASON) {
    throw new ValidationError(`reason must be at most ${MAX_REASON} chars`);
  }
  return reason || undefined;
}

function profile(identity: VerifiedIdentity): {
  email?: string;
  displayName?: string;
  emailVerified: boolean;
} {
  return {
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.displayName ? { displayName: identity.displayName } : {}),
    emailVerified: identity.emailVerified === true,
  };
}

function profileChanged(
  account: OperatorAccount,
  identity: VerifiedIdentity,
): boolean {
  const p = profile(identity);
  return (
    account.email !== p.email ||
    account.displayName !== p.displayName ||
    account.emailVerified !== p.emailVerified
  );
}

function toView(
  account: OperatorAccount,
  requesterId: string,
): OperatorAccountView {
  return {
    operatorId: account.id,
    ...(account.email ? { email: account.email } : {}),
    ...(account.displayName ? { displayName: account.displayName } : {}),
    emailVerified: account.emailVerified,
    status: account.status,
    ...(account.role ? { role: account.role } : {}),
    allowedProjects: account.allowedProjects,
    requestedAt: account.requestedAt,
    updatedAt: account.updatedAt,
    ...(account.decidedAt ? { decidedAt: account.decidedAt } : {}),
    ...(account.statusReason ? { statusReason: account.statusReason } : {}),
    isSelf: account.id === requesterId,
  };
}
