import { type AgentDescriptor, type Handoff, type HandoffDraft, type Repository } from "../../contracts/index.js";
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
    /**
     * Persist a handoff record. Exposed so that a policy layer can enrich a
     * handoff (adding qualification evidence, an acceptor) without reaching
     * into the repository or re-implementing the state machine.
     */
    save(handoff: Handoff): Handoff;
    forTask(taskId: string): Handoff[];
    list(): Handoff[];
    private mustBeProposed;
}
/**
 * {@link SpecialistHandoffService} adds the two things a generic handoff record
 * cannot decide for itself:
 *
 *  1. IS THE DESTINATION QUALIFIED? A handoff that names an agent which cannot
 *     do the remaining work is a routing error, not a transfer. It is refused
 *     at proposal time with the qualification evidence attached.
 *
 *  2. IS THE DESTINATION STILL QUALIFIED AT ACCEPTANCE TIME? Eligibility can
 *     lapse between proposal and acceptance — the destination may be suspended,
 *     disabled, or lose project access. Acceptance RE-VERIFIES and fails closed.
 *
 * It also requires explicit acceptance (`requiresDestinationAcceptance`), so
 * work never moves silently, and carries the project id so a handoff can never
 * cross a project boundary.
 *
 * The generic {@link HandoffSystem} is left intact underneath: this composes it
 * rather than reimplementing storage or the state machine.
 */
export declare class SpecialistHandoffService {
    private readonly descriptors;
    private readonly isEnabled;
    private readonly clock;
    private readonly inner;
    constructor(descriptors: () => readonly AgentDescriptor[], isEnabled?: (agentId: string, projectId: string) => boolean, repo?: Repository<Handoff>, clock?: () => string);
    /**
     * Propose a transfer. The destination is qualified against the REMAINING
     * work's capabilities in the owning project.
     *
     * @throws ValidationError when the destination does not qualify — the
     * caller must not retry with a different agent silently; it must surface the
     * `NO_QUALIFIED_AGENT` outcome to the task.
     */
    propose(input: {
        draft: HandoffDraft;
        sourceAssignmentId?: string;
    }): Handoff;
    /**
     * Accept a transfer — after RE-VERIFYING that the destination is still
     * qualified. A destination that was suspended in the meantime cannot take
     * the work, and the handoff stays `proposed` so the orchestrator can route
     * it elsewhere.
     */
    accept(id: string, acceptedBy: string): Handoff;
    reject(id: string, reason: string): Handoff;
    get(id: string): Handoff | undefined;
    require(id: string): Handoff;
    forTask(taskId: string): readonly Handoff[];
    list(): readonly Handoff[];
}
