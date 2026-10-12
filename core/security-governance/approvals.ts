/**
 * Governance approvals, layered on the platform ApprovalSystem.
 *
 * The ApprovalSystem stays the single source of truth for the decision, so an
 * approval taken in the existing Approvals page and one taken in the Trust
 * Center are the same record. This engine adds: the full context a human needs
 * (action, resource, risk, reason, impact, reversibility, changes, command),
 * a fingerprint that binds an approval to ONE exact action, single use,
 * expiry, cancellation, and the governance ledger trail. Agents cannot decide.
 */
import { createHash } from "node:crypto";
import {
  operatorCan,
  operatorCanAccessProject,
  type Approval,
  type OperatorPrincipal,
} from "../../contracts/index.js";
import type {
  ActionRequest,
  GovApprovalState,
  GovernanceApprovalView,
  SecurityDecision,
} from "../../contracts/security-governance.js";
import type { Repository } from "../../contracts/persistence.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import { SyncCache } from "../knowledge-memory/memory-service.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";
import type { GovernanceLedger } from "./ledger.js";

export interface ApprovalMeta {
  id: string;
  fingerprint: string;
  consumedAt?: string;
  cancelledBy?: string;
  cancelledAt?: string;
}

export class GovernanceApprovalError extends Error {
  constructor(
    readonly code:
      "forbidden" | "not_found" | "invalid_state" | "invalid_request",
    message: string,
  ) {
    super(message);
    this.name = "GovernanceApprovalError";
  }
}

export function fingerprintOf(
  req: Pick<
    ActionRequest,
    "projectId" | "action" | "resource" | "taskId" | "agentId" | "command"
  >,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        req.projectId,
        req.action,
        req.resource,
        req.taskId ?? "",
        req.agentId ?? "",
        req.command ?? "",
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}

const TTL_MS = 24 * 3_600_000;

const IMPACT: Record<string, string> = {
  LOW: "Limited to the named resource.",
  MEDIUM: "Affects the named resource and what depends on it.",
  HIGH: "Can change behaviour for users or other components.",
  CRITICAL: "Can cause serious or permanent damage.",
};

export class GovernanceApprovals {
  private readonly meta: Repository<ApprovalMeta>;
  constructor(
    private readonly approvals: Pick<
      ApprovalSystem,
      "request" | "get" | "list" | "decide" | "expire" | "expireStale"
    >,
    meta: Repository<ApprovalMeta>,
    private readonly ledger: GovernanceLedger,
    private readonly clock: () => string,
  ) {
    this.meta = new SyncCache(meta);
  }

  /** Ask a human. Returns the already-open request for the same exact action if there is one. */
  request(
    req: ActionRequest,
    decision: SecurityDecision,
  ): { approvalId: string; created: boolean } {
    const fingerprint = fingerprintOf(req);
    for (const m of this.meta.list()) {
      if (m.fingerprint !== fingerprint || m.cancelledAt || m.consumedAt)
        continue;
      const a = this.approvals.get(m.id);
      if (a?.status === "requested")
        return { approvalId: a.id, created: false };
    }
    const requestedBy = req.agentId ?? req.principalId ?? "system";
    const expires = new Date(Date.parse(this.clock()) + TTL_MS).toISOString();
    const approval = this.approvals.request({
      action: "governance.approve_action",
      requestedBy,
      reason: maskSecrets(`${decision.explanation}`).slice(0, 700),
      expiresAt: expires,
      metadata: {
        approvalKind: "governance_action",
        projectId: req.projectId,
        ...(req.taskId ? { taskId: req.taskId } : {}),
        ...(req.executionId ? { executionId: req.executionId } : {}),
        ...(req.agentId ? { agentId: req.agentId } : {}),
        ...(req.modelId ? { modelId: req.modelId } : {}),
        governance: {
          action: req.action,
          resource: maskSecrets(req.resource).slice(0, 300),
          risk: decision.risk.level,
          environment: decision.environment,
          policies: decision.policies.map((p) => p.name),
          impact: IMPACT[decision.risk.level],
          reversibility: decision.risk.reversible
            ? "Reversible"
            : "Not reversible",
          changes: req.content
            ? `${req.content.length} characters of new content`
            : (req.count ?? 1) > 1
              ? `${req.count} resources`
              : "1 resource",
          ...(req.command
            ? { command: maskSecrets(req.command).slice(0, 200) }
            : {}),
          fingerprint,
        },
      },
    });
    this.meta.upsert({ id: approval.id, fingerprint });
    this.ledger.record("approval.requested", {
      actor: requestedBy,
      projectId: req.projectId,
      agentId: req.agentId,
      taskId: req.taskId,
      executionId: req.executionId,
      action: req.action,
      resource: req.resource,
      risk: decision.risk.level,
      policyIds: decision.policies.map((p) => p.policyId),
      result: "PENDING",
      detail: { approvalId: approval.id },
    });
    return { approvalId: approval.id, created: true };
  }

  private stateOf(a: Approval, m?: ApprovalMeta): GovApprovalState {
    if (m?.cancelledAt) return "CANCELLED";
    if (a.status === "approved") return "APPROVED";
    if (a.status === "rejected") return "DENIED";
    if (a.status === "expired") return "EXPIRED";
    if (a.expiresAt && Date.parse(a.expiresAt) <= Date.parse(this.clock()))
      return "EXPIRED";
    return "PENDING";
  }

  /** Is there an unused, unexpired approval for exactly this action? */
  approvedFor(req: ActionRequest): string | undefined {
    const fingerprint = fingerprintOf(req);
    for (const m of this.meta.list()) {
      if (m.fingerprint !== fingerprint || m.consumedAt || m.cancelledAt)
        continue;
      const a = this.approvals.get(m.id);
      if (a && this.stateOf(a, m) === "APPROVED") return a.id;
    }
    return undefined;
  }

  consume(approvalId: string): void {
    const m = this.meta.findById(approvalId);
    if (m && !m.consumedAt)
      this.meta.upsert({ ...m, consumedAt: this.clock() });
  }

  view(approval: Approval): GovernanceApprovalView | undefined {
    const g = approval.decisionMetadata["governance"] as
      Record<string, unknown> | undefined;
    const kind = approval.decisionMetadata["approvalKind"];
    if (!g && kind !== "governance_action") return undefined;
    const m = this.meta.findById(approval.id);
    const state = this.stateOf(approval, m);
    const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
    const md = approval.decisionMetadata;
    return {
      approvalId: approval.id,
      state,
      ...(typeof md["executionId"] === "string"
        ? { executionId: md["executionId"] }
        : {}),
      ...(typeof md["taskId"] === "string" ? { taskId: md["taskId"] } : {}),
      projectId: str(md["projectId"]),
      action: str(g?.["action"], approval.action),
      resource: str(g?.["resource"], str(md["resource"])),
      risk: str(g?.["risk"], "UNKNOWN"),
      reason: approval.reason,
      expectedImpact: str(g?.["impact"], "See the plan."),
      reversibility: str(g?.["reversibility"], "Unknown"),
      changes: str(g?.["changes"], ""),
      ...(typeof g?.["command"] === "string"
        ? { proposedCommand: g["command"] as string }
        : {}),
      ...(typeof md["agentId"] === "string" ? { agentId: md["agentId"] } : {}),
      ...(typeof md["modelId"] === "string" ? { modelId: md["modelId"] } : {}),
      ...(typeof g?.["environment"] === "string"
        ? {
            environment: g[
              "environment"
            ] as GovernanceApprovalView["environment"],
          }
        : {}),
      policies: Array.isArray(g?.["policies"])
        ? (g!["policies"] as string[])
        : [],
      requestedBy: approval.requestedBy,
      requestedAt: approval.requestedAt,
      ...(state !== "PENDING"
        ? {
            decision:
              state === "APPROVED"
                ? ("APPROVED" as const)
                : state === "DENIED"
                  ? ("DENIED" as const)
                  : state === "CANCELLED"
                    ? ("CANCELLED" as const)
                    : ("EXPIRED" as const),
          }
        : {}),
      ...(approval.decidedBy
        ? { decidedBy: approval.decidedBy }
        : m?.cancelledBy
          ? { decidedBy: m.cancelledBy }
          : {}),
      ...(approval.decidedAt
        ? { decidedAt: approval.decidedAt }
        : m?.cancelledAt
          ? { decidedAt: m.cancelledAt }
          : {}),
      ...(approval.expiresAt ? { expiresAt: approval.expiresAt } : {}),
    };
  }

  list(
    filter: { state?: GovApprovalState[]; projectId?: string } = {},
  ): GovernanceApprovalView[] {
    return this.approvals
      .list()
      .map((a) => this.view(a))
      .filter((v): v is GovernanceApprovalView => v !== undefined)
      .filter((v) => !filter.state || filter.state.includes(v.state))
      .filter((v) => !filter.projectId || v.projectId === filter.projectId)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  get(approvalId: string): GovernanceApprovalView | undefined {
    const a = this.approvals.get(approvalId);
    return a ? this.view(a) : undefined;
  }

  private mustPending(approvalId: string): {
    approval: Approval;
    view: GovernanceApprovalView;
  } {
    const a = this.approvals.get(approvalId);
    const v = a ? this.view(a) : undefined;
    if (!a || !v)
      throw new GovernanceApprovalError("not_found", "approval not found");
    if (v.state !== "PENDING")
      throw new GovernanceApprovalError(
        "invalid_state",
        `this approval is already ${v.state}`,
      );
    return { approval: a, view: v };
  }

  /** Only a signed-in human with approve rights (and project access) decides. */
  decide(
    approvalId: string,
    decision: "approve" | "deny",
    principal: OperatorPrincipal,
    note?: string,
  ): GovernanceApprovalView {
    if (!operatorCan(principal, "approve"))
      throw new GovernanceApprovalError(
        "forbidden",
        "you may not decide approvals",
      );
    const { view } = this.mustPending(approvalId);
    if (view.projectId && !operatorCanAccessProject(principal, view.projectId))
      throw new GovernanceApprovalError("not_found", "approval not found");
    if (view.requestedBy === principal.id && principal.role !== "admin")
      throw new GovernanceApprovalError(
        "forbidden",
        "you cannot approve your own request",
      );
    if (decision === "approve" && view.risk === "CRITICAL") {
      if (principal.role !== "admin")
        throw new GovernanceApprovalError(
          "forbidden",
          "CRITICAL actions need an administrator",
        );
      if (!note?.trim())
        throw new GovernanceApprovalError(
          "invalid_request",
          "approving a CRITICAL action needs a written reason",
        );
    }
    this.approvals.decide(
      approvalId,
      decision === "approve" ? "approved" : "rejected",
      principal.id,
      note ? { note: maskSecrets(note).slice(0, 300) } : {},
    );
    this.ledger.record(
      decision === "approve" ? "approval.approved" : "approval.denied",
      {
        actor: principal.id,
        projectId: view.projectId || undefined,
        agentId: view.agentId,
        taskId: view.taskId,
        executionId: view.executionId,
        action: String(view.action),
        resource: view.resource,
        risk: String(view.risk),
        result: decision === "approve" ? "APPROVED" : "DENIED",
        detail: { approvalId, ...(note ? { note } : {}) },
      },
    );
    return this.get(approvalId)!;
  }

  cancel(
    approvalId: string,
    principal: OperatorPrincipal,
  ): GovernanceApprovalView {
    if (
      !operatorCan(principal, "approve") &&
      !operatorCan(principal, "manage_security")
    )
      throw new GovernanceApprovalError(
        "forbidden",
        "you may not cancel approvals",
      );
    const { view } = this.mustPending(approvalId);
    if (view.projectId && !operatorCanAccessProject(principal, view.projectId))
      throw new GovernanceApprovalError("not_found", "approval not found");
    this.approvals.decide(approvalId, "rejected", principal.id, {
      cancelled: true,
    });
    const m = this.meta.findById(approvalId);
    this.meta.upsert({
      ...(m ?? { id: approvalId, fingerprint: "" }),
      cancelledBy: principal.id,
      cancelledAt: this.clock(),
    });
    this.ledger.record("approval.cancelled", {
      actor: principal.id,
      projectId: view.projectId || undefined,
      action: String(view.action),
      resource: view.resource,
      risk: String(view.risk),
      result: "CANCELLED",
      detail: { approvalId },
    });
    return this.get(approvalId)!;
  }

  expireStale(): number {
    const expired = this.approvals.expireStale(this.clock());
    for (const a of expired) {
      const v = this.view(a);
      if (v)
        this.ledger.record("approval.expired", {
          actor: "system",
          projectId: v.projectId || undefined,
          result: "EXPIRED",
          detail: { approvalId: a.id },
        });
    }
    return expired.length;
  }
}
