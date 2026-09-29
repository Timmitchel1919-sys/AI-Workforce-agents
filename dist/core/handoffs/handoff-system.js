import { NotFoundError, StateTransitionError, ValidationError, acceptsNewAssignments, missingCapabilities, satisfiedCapabilities, validateHandoffDraft, } from "../../contracts/index.js";
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
            // Carried through rather than dropped: an enriched draft must not lose
            // the project it belongs to just because the record was persisted by the
            // generic system.
            ...(draft.projectId !== undefined ? { projectId: draft.projectId } : {}),
            sourceAgentId: draft.sourceAgentId,
            destinationAgentId: draft.destinationAgentId,
            status: "proposed",
            context: { ...(draft.context ?? {}) },
            completedWork: draft.completedWork,
            remainingWork: draft.remainingWork,
            acceptanceCriteria: [...draft.acceptanceCriteria],
            artifacts: [...(draft.artifacts ?? [])],
            risks: [...(draft.risks ?? [])],
            ...(draft.requiredCapabilities !== undefined
                ? { requiredCapabilities: [...draft.requiredCapabilities] }
                : {}),
            ...(draft.sourceAssignmentId !== undefined
                ? { sourceAssignmentId: draft.sourceAssignmentId }
                : {}),
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
    /**
     * Persist a handoff record. Exposed so that a policy layer can enrich a
     * handoff (adding qualification evidence, an acceptor) without reaching
     * into the repository or re-implementing the state machine.
     */
    save(handoff) {
        this.repo.upsert(handoff);
        return handoff;
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
/* ------------------------------------------------------------------ */
/* Specialist handoffs                                                */
/* ------------------------------------------------------------------ */
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
export class SpecialistHandoffService {
    descriptors;
    isEnabled;
    clock;
    inner;
    constructor(descriptors, isEnabled = () => true, repo = new InMemoryRepository(), clock = () => now()) {
        this.descriptors = descriptors;
        this.isEnabled = isEnabled;
        this.clock = clock;
        this.inner = new HandoffSystem(repo);
    }
    /**
     * Propose a transfer. The destination is qualified against the REMAINING
     * work's capabilities in the owning project.
     *
     * @throws ValidationError when the destination does not qualify — the
     * caller must not retry with a different agent silently; it must surface the
     * `NO_QUALIFIED_AGENT` outcome to the task.
     */
    propose(input) {
        const draft = input.draft;
        if (!draft.projectId) {
            throw new ValidationError("a specialist handoff must state the project that owns the work");
        }
        validateHandoffDraft(draft);
        const requiredCapabilities = draft.requiredCapabilities ?? [];
        const destination = this.descriptors().find((d) => d.id === draft.destinationAgentId);
        if (!destination) {
            throw new ValidationError(`handoff destination ${draft.destinationAgentId} is not a registered specialist descriptor`);
        }
        if (!this.isEnabled(destination.id, draft.projectId)) {
            throw new ValidationError(`handoff destination ${draft.destinationAgentId} is not enabled for project ${draft.projectId}`);
        }
        const evidence = evaluateDestination(destination, {
            projectId: draft.projectId,
            requiredCapabilities,
        });
        if (!evidence.qualified) {
            throw new ValidationError(`handoff destination ${draft.destinationAgentId} does not qualify for the remaining work: ${evidence.reasonCodes.join(", ")}`);
        }
        const handoff = this.inner.propose(draft);
        const withEvidence = {
            ...handoff,
            requiredCapabilities: [...requiredCapabilities],
            destinationQualification: {
                qualified: evidence.qualified,
                matchedCapabilities: evidence.matchedCapabilities,
                missingCapabilities: evidence.missingCapabilities,
                reasonCodes: evidence.reasonCodes,
                descriptorVersion: destination.version,
                evaluatedAt: this.clock(),
            },
            ...(input.sourceAssignmentId
                ? { sourceAssignmentId: input.sourceAssignmentId }
                : {}),
        };
        // `inner.propose` validated the draft; persist the enriched record so the
        // evidence travels with the handoff.
        this.inner.save(withEvidence);
        return withEvidence;
    }
    /**
     * Accept a transfer — after RE-VERIFYING that the destination is still
     * qualified. A destination that was suspended in the meantime cannot take
     * the work, and the handoff stays `proposed` so the orchestrator can route
     * it elsewhere.
     */
    accept(id, acceptedBy) {
        const handoff = this.inner.require(id);
        if (handoff.status !== "proposed") {
            throw new StateTransitionError(`handoff ${id} is not proposed (status: ${handoff.status})`);
        }
        if (!handoff.projectId) {
            throw new ValidationError("a specialist handoff must state the project that owns the work");
        }
        const destination = this.descriptors().find((d) => d.id === handoff.destinationAgentId);
        if (!destination) {
            throw new ValidationError(`handoff destination ${handoff.destinationAgentId} is no longer a registered specialist descriptor`);
        }
        if (!this.isEnabled(destination.id, handoff.projectId)) {
            throw new ValidationError(`handoff destination ${handoff.destinationAgentId} is no longer enabled for project ${handoff.projectId}`);
        }
        const evidence = evaluateDestination(destination, {
            projectId: handoff.projectId,
            requiredCapabilities: handoff.requiredCapabilities ?? [],
        });
        if (!evidence.qualified) {
            throw new ValidationError(`handoff ${id} destination no longer qualifies: ${evidence.reasonCodes.join(", ")}`);
        }
        const accepted = {
            ...handoff,
            status: "accepted",
            acceptedBy,
            resolvedAt: this.clock(),
            destinationQualification: {
                ...handoff.destinationQualification,
                qualified: true,
                matchedCapabilities: evidence.matchedCapabilities,
                missingCapabilities: evidence.missingCapabilities,
                reasonCodes: evidence.reasonCodes,
                descriptorVersion: destination.version,
                evaluatedAt: this.clock(),
            },
        };
        this.inner.save(accepted);
        return accepted;
    }
    reject(id, reason) {
        return this.inner.reject(id, reason);
    }
    get(id) {
        return this.inner.get(id);
    }
    require(id) {
        return this.inner.require(id);
    }
    forTask(taskId) {
        return this.inner.forTask(taskId);
    }
    list() {
        return this.inner.list();
    }
}
function evaluateDestination(destination, input) {
    const reasonCodes = [];
    if (!acceptsNewAssignments(destination.administrativeStatus)) {
        reasonCodes.push("administratively_inactive");
    }
    if (!destination.projectPolicy.projects.includes(input.projectId)) {
        reasonCodes.push("project_not_allowed");
    }
    const matched = satisfiedCapabilities(destination.capabilities, input.requiredCapabilities);
    const missing = missingCapabilities(destination.capabilities, input.requiredCapabilities);
    if (missing.length > 0)
        reasonCodes.push("missing_capability");
    return {
        qualified: reasonCodes.length === 0,
        matchedCapabilities: matched,
        missingCapabilities: missing,
        reasonCodes: [...new Set(reasonCodes)],
    };
}
