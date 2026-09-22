import { type Handoff, type HandoffDraft, type Repository } from "../../contracts/index.js";
/**
 * Structured agent-to-agent handoffs.
 *
 * A handoff is created in the `proposed` state after structural validation,
 * then explicitly `accept`ed (re-validated) or `reject`ed. Nothing is
 * considered transferred until it is accepted. State is held in the injected
 * {@link Repository} (in-memory by default).
 */
export declare class HandoffSystem {
    private readonly repo;
    constructor(repo?: Repository<Handoff>);
    propose(draft: HandoffDraft): Handoff;
    get(id: string): Handoff | undefined;
    require(id: string): Handoff;
    accept(id: string): Handoff;
    reject(id: string, reason: string): Handoff;
    forTask(taskId: string): Handoff[];
    list(): Handoff[];
    private mustBeProposed;
}
