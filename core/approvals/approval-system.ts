import {
  type Approval,
  type ApprovalRequestDraft,
  NotFoundError,
  StateTransitionError,
  validateApprovalRequest,
} from "../../contracts/index.js";
import { createId, now } from "../shared.js";

/**
 * Human approval records.
 *
 *   requested ─▶ approved
 *             ├▶ rejected
 *             └▶ expired
 *
 * This system only records decisions; it never grants tool or project access
 * by itself. A UI or API layer can later drive `decide` / `expire`.
 */
export class ApprovalSystem {
  private readonly approvals = new Map<string, Approval>();

  request(draft: ApprovalRequestDraft): Approval {
    validateApprovalRequest(draft);
    const approval: Approval = {
      id: createId("approval"),
      action: draft.action,
      requestedBy: draft.requestedBy,
      reason: draft.reason,
      status: "requested",
      requestedAt: now(),
      expiresAt: draft.expiresAt,
      decisionMetadata: { ...(draft.metadata ?? {}) },
    };
    this.approvals.set(approval.id, approval);
    return approval;
  }

  get(id: string): Approval | undefined {
    return this.approvals.get(id);
  }

  require(id: string): Approval {
    const approval = this.approvals.get(id);
    if (!approval) throw new NotFoundError(`unknown approval: ${id}`);
    return approval;
  }

  list(): Approval[] {
    return [...this.approvals.values()];
  }

  pending(): Approval[] {
    return this.list().filter((approval) => approval.status === "requested");
  }

  decide(
    id: string,
    decision: "approved" | "rejected",
    decidedBy: string,
    metadata: Record<string, unknown> = {},
  ): Approval {
    const approval = this.mustBePending(id);
    const next: Approval = {
      ...approval,
      status: decision,
      decidedBy,
      decidedAt: now(),
      decisionMetadata: { ...approval.decisionMetadata, ...metadata },
    };
    this.approvals.set(id, next);
    return next;
  }

  expire(id: string): Approval {
    const approval = this.mustBePending(id);
    const next: Approval = { ...approval, status: "expired", decidedAt: now() };
    this.approvals.set(id, next);
    return next;
  }

  /** Expire every pending approval whose expiry is at or before `asOf`. */
  expireStale(asOf: string = now()): Approval[] {
    return this.pending()
      .filter((a) => a.expiresAt !== undefined && a.expiresAt <= asOf)
      .map((a) => this.expire(a.id));
  }

  private mustBePending(id: string): Approval {
    const approval = this.require(id);
    if (approval.status !== "requested") {
      throw new StateTransitionError(
        `approval ${id} is not pending (status: ${approval.status})`,
      );
    }
    return approval;
  }
}
