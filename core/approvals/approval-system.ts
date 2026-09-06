import {
  type Approval,
  type ApprovalRequestDraft,
  type Repository,
  NotFoundError,
  StateTransitionError,
  validateApprovalRequest,
} from "../../contracts/index.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import { createId, now } from "../shared.js";

/**
 * Human approval records.
 *
 *   requested ─▶ approved
 *             ├▶ rejected
 *             └▶ expired
 *
 * This system only records decisions; it never grants tool or project access
 * by itself and never auto-approves. A UI or API layer drives `decide` /
 * `expire`. State is held in the injected {@link Repository} (in-memory by
 * default).
 */
export class ApprovalSystem {
  constructor(
    private readonly repo: Repository<Approval> = new InMemoryRepository<Approval>(),
  ) {}

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
    this.repo.upsert(approval);
    return approval;
  }

  get(id: string): Approval | undefined {
    return this.repo.findById(id);
  }

  require(id: string): Approval {
    const approval = this.repo.findById(id);
    if (!approval) throw new NotFoundError(`unknown approval: ${id}`);
    return approval;
  }

  list(): Approval[] {
    return this.repo.list();
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
    this.repo.upsert(next);
    return next;
  }

  expire(id: string): Approval {
    const approval = this.mustBePending(id);
    const next: Approval = { ...approval, status: "expired", decidedAt: now() };
    this.repo.upsert(next);
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
