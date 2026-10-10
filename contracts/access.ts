/**
 * Operator access contracts — AUTHZ-1.
 *
 * AUTHENTICATION ≠ AUTHORIZATION. Firebase Authentication proves WHO a user
 * is (a verified ID token → a stable Firebase UID). This module describes
 * WHAT that user may do in AI Workforce: an `OperatorAccount` keyed by the
 * Firebase UID, with one authoritative lifecycle and one of the existing
 * operator roles (`viewer` | `operator` | `admin`).
 *
 *   pending ──approve──▶ active ──suspend──▶ suspended ──reactivate──▶ active
 *      │                   │                     │
 *      └─reject─▶ rejected └──────revoke─────────┴──▶ revoked (terminal)
 *   rejected ──approve──▶ active
 *
 * Only an ACTIVE account with a role authorizes Control Plane access. Every
 * mutation is made server-side, atomically, and audited. Nothing here stores
 * a password, a token, or a credential.
 */
import { ValidationError, requireText } from "./index.js";
import {
  OPERATOR_ROLES,
  ROLE_CAPABILITIES,
  type ControlCapability,
  type OperatorPrincipal,
  type OperatorRole,
} from "./control.js";

export const OPERATOR_ACCOUNT_STATUSES = [
  "pending",
  "active",
  "suspended",
  "rejected",
  "revoked",
] as const;
export type OperatorAccountStatus = (typeof OPERATOR_ACCOUNT_STATUSES)[number];

/** Role hierarchy (least → most privileged). A role may only grant ≤ itself. */
export const ROLE_RANK: Readonly<Record<OperatorRole, number>> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

/** The authoritative authorization record for one Firebase identity. */
export interface OperatorAccount {
  /** The Firebase Auth UID (stable identity). */
  id: string;
  status: OperatorAccountStatus;
  /** Set once approved; kept on suspended/revoked accounts for history. */
  role?: OperatorRole;
  /** `"*"` = every project; otherwise an explicit allow-list. */
  allowedProjects: readonly string[] | "*";
  /** Minimal profile from the verified token, for administrators only. */
  email?: string;
  displayName?: string;
  emailVerified: boolean;
  requestedAt: string;
  updatedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  statusReason?: string;
  /** True for the account created by the initial administrator bootstrap. */
  bootstrap?: boolean;
  /** Optimistic-concurrency counter; bumped on every committed change. */
  revision: number;
}

/** A verified Firebase identity — authentication only, no authorization. */
export interface VerifiedIdentity {
  uid: string;
  email?: string;
  displayName?: string;
  emailVerified: boolean;
}

/** Verifies an opaque credential (Firebase ID token) → identity or null. */
export interface IdentityVerifier {
  verify(credential: string): Promise<VerifiedIdentity | null>;
}

/** `GET /api/me/access` — what the signed-in user may do. Safe for the UI. */
export interface MyAccessView {
  authenticated: true;
  authorized: boolean;
  status: OperatorAccountStatus;
  role?: OperatorRole;
  allowedProjects?: readonly string[] | "*";
  /** Capabilities of the active role — UX only; the backend re-checks. */
  capabilities: readonly ControlCapability[];
}

/** One account as shown to an administrator (Users & Access). */
export interface OperatorAccountView {
  operatorId: string;
  email?: string;
  displayName?: string;
  emailVerified: boolean;
  status: OperatorAccountStatus;
  role?: OperatorRole;
  allowedProjects: readonly string[] | "*";
  requestedAt: string;
  updatedAt: string;
  decidedAt?: string;
  statusReason?: string;
  /** The requesting administrator's own account (self-changes are refused). */
  isSelf: boolean;
}

/* ------------------------------------------------------------------ */
/* Persistence port                                                   */
/* ------------------------------------------------------------------ */

export type OperatorAccountChange =
  /** Create a pending account unless one exists (idempotent). */
  | { kind: "create_pending"; account: OperatorAccount }
  /**
   * Replace an account if it is still at `expectedRevision`. `activeAdminDelta`
   * adjusts the atomic active-administrator count; a change that would leave
   * zero active administrators is refused (`LastAdministratorError`, see contracts/index.ts).
   */
  | {
      kind: "update";
      account: OperatorAccount;
      expectedRevision: number;
      activeAdminDelta: -1 | 0 | 1;
    }
  /**
   * One-time initial administrator. Refused (`BootstrapLockedError`) once the
   * bootstrap lock exists for another identity or any active administrator
   * exists. Re-running for the same, still-active administrator is a no-op.
   */
  | { kind: "bootstrap"; account: OperatorAccount };

export type OperatorAccountCommitResult =
  "committed" | "exists" | "already_provisioned";

/** Authoritative, transactional account storage (Firestore in production). */
export interface OperatorAccountStore {
  get(operatorId: string): Promise<OperatorAccount | undefined>;
  list(): Promise<OperatorAccount[]>;
  commit(change: OperatorAccountChange): Promise<OperatorAccountCommitResult>;
}

/* ------------------------------------------------------------------ */
/* Helpers + validation                                               */
/* ------------------------------------------------------------------ */

export function isActiveAdmin(account: OperatorAccount | undefined): boolean {
  return account?.status === "active" && account.role === "admin";
}

/**
 * The single authorization decision: only an ACTIVE account with a role
 * yields a principal. Pending, rejected, suspended, revoked or missing → null.
 */
export function principalFor(
  account: OperatorAccount | undefined,
): OperatorPrincipal | null {
  if (!account || account.status !== "active" || !account.role) return null;
  return {
    id: account.id,
    role: account.role,
    allowedProjects: account.allowedProjects,
  };
}

export function capabilitiesFor(
  account: OperatorAccount | undefined,
): readonly ControlCapability[] {
  if (account?.status !== "active" || !account.role) return [];
  return ROLE_CAPABILITIES[account.role] ?? [];
}

export function validateOperatorAccount(account: OperatorAccount): void {
  if (!account || typeof account !== "object") {
    throw new ValidationError("operator account must be an object");
  }
  requireText(account.id, "account.id");
  if (!OPERATOR_ACCOUNT_STATUSES.includes(account.status)) {
    throw new ValidationError("account.status is not a known status");
  }
  if (account.role !== undefined && !OPERATOR_ROLES.includes(account.role)) {
    throw new ValidationError("account.role is not a known role");
  }
  if (account.status === "active" && account.role === undefined) {
    throw new ValidationError("an active account must have a role");
  }
  if (
    account.allowedProjects !== "*" &&
    (!Array.isArray(account.allowedProjects) ||
      !account.allowedProjects.every((p) => typeof p === "string"))
  ) {
    throw new ValidationError(
      'account.allowedProjects must be "*" or a list of project ids',
    );
  }
  if (typeof account.emailVerified !== "boolean") {
    throw new ValidationError("account.emailVerified must be a boolean");
  }
  if (!Number.isInteger(account.revision) || account.revision < 1) {
    throw new ValidationError("account.revision must be a positive integer");
  }
  requireText(account.requestedAt, "account.requestedAt");
  requireText(account.updatedAt, "account.updatedAt");
}
