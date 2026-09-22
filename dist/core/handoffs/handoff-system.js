import { NotFoundError, StateTransitionError, validateHandoffDraft, } from "../../contracts/index.js";
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
    repo;
    constructor(repo = new InMemoryRepository()) {
        this.repo = repo;
    }
    propose(draft) {
        validateHandoffDraft(draft);
        const handoff = {
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
    get(id) {
        return this.repo.findById(id);
    }
    require(id) {
        const handoff = this.repo.findById(id);
        if (!handoff)
            throw new NotFoundError(`unknown handoff: ${id}`);
        return handoff;
    }
    accept(id) {
        const handoff = this.mustBeProposed(id);
        validateHandoffDraft(handoff);
        const next = { ...handoff, status: "accepted", resolvedAt: now() };
        this.repo.upsert(next);
        return next;
    }
    reject(id, reason) {
        const handoff = this.mustBeProposed(id);
        const next = {
            ...handoff,
            status: "rejected",
            resolvedAt: now(),
            resolution: reason,
        };
        this.repo.upsert(next);
        return next;
    }
    forTask(taskId) {
        return this.repo.list().filter((handoff) => handoff.taskId === taskId);
    }
    list() {
        return this.repo.list();
    }
    mustBeProposed(id) {
        const handoff = this.require(id);
        if (handoff.status !== "proposed") {
            throw new StateTransitionError(`handoff ${id} is not proposed (status: ${handoff.status})`);
        }
        return handoff;
    }
}
