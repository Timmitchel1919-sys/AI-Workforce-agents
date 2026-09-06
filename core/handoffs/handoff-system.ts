import {
  type Handoff,
  type HandoffDraft,
  type Repository,
  NotFoundError,
  StateTransitionError,
  validateHandoffDraft,
} from "../../contracts/index.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import { createId, now } from "../shared.js";

/**
 * Structured agent-to-agent handoffs.
 *
 * A handoff is created in the `proposed` state after structural validation,
 * then explicitly `accept`ed (re-validated) or `reject`ed. Nothing is
 * considered transferred until it is accepted. State is held in the injected
 * {@link Repository} (in-memory by default).
 */
export class HandoffSystem {
  constructor(
    private readonly repo: Repository<Handoff> = new InMemoryRepository<Handoff>(),
  ) {}

  propose(draft: HandoffDraft): Handoff {
    validateHandoffDraft(draft);
    const handoff: Handoff = {
      id: createId("handoff"),
      taskId: draft.taskId,
      sourceAgentId: draft.sourceAgentId,
      destinationAgentId: draft.destinationAgentId,
      status: "proposed",
      context: { ...(draft.context ?? {}) },
      completedWork: draft.completedWork,
      remainingWork: draft.remainingWork,
      acceptanceCriteria: [...draft.acceptanceCriteria],
      artifacts: [...(draft.artifacts ?? [])],
      risks: [...(draft.risks ?? [])],
      createdAt: now(),
    };
    this.repo.upsert(handoff);
    return handoff;
  }

  get(id: string): Handoff | undefined {
    return this.repo.findById(id);
  }

  require(id: string): Handoff {
    const handoff = this.repo.findById(id);
    if (!handoff) throw new NotFoundError(`unknown handoff: ${id}`);
    return handoff;
  }

  accept(id: string): Handoff {
    const handoff = this.mustBeProposed(id);
    validateHandoffDraft(handoff);
    const next: Handoff = { ...handoff, status: "accepted", resolvedAt: now() };
    this.repo.upsert(next);
    return next;
  }

  reject(id: string, reason: string): Handoff {
    const handoff = this.mustBeProposed(id);
    const next: Handoff = {
      ...handoff,
      status: "rejected",
      resolvedAt: now(),
      resolution: reason,
    };
    this.repo.upsert(next);
    return next;
  }

  forTask(taskId: string): Handoff[] {
    return this.repo.list().filter((handoff) => handoff.taskId === taskId);
  }

  list(): Handoff[] {
    return this.repo.list();
  }

  private mustBeProposed(id: string): Handoff {
    const handoff = this.require(id);
    if (handoff.status !== "proposed") {
      throw new StateTransitionError(
        `handoff ${id} is not proposed (status: ${handoff.status})`,
      );
    }
    return handoff;
  }
}
