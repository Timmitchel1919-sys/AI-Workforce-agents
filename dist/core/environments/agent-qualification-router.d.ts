/**
 * AgentQualificationRouter — the ONE qualification router, intentionally
 * SEPARATED from environment routing.
 *
 *   CAPABILITY     answers "what does this agent generally do?"
 *   QUALIFICATION  answers "is this agent suitable for THIS task under THESE
 *                             constraints?"
 *   ENVIRONMENT    answers "is a real, usable environment installed?"
 *   GOVERNANCE     answers "is this agent allowed to do it at all?"
 *
 * The two routers must not blur: a qualified agent with no environment is
 * `REQUIRES_PROVISIONING`, never a fabricated success, and an unqualified agent
 * is rejected even when an environment is available.
 *
 * This is STRICT by design. There is no wildcard, no nearest match, and no
 * "everyone is a little bit of everything" fallback:
 *
 *   NO QUALIFIED AGENT  ->  task BLOCKED with `NO_QUALIFIED_AGENT`
 *   NEVER               ->  pick a random available agent
 *
 * AVAILABLE != QUALIFIED. Being free does not make an agent suitable, and being
 * suitable does not mean the agent is free.
 */
import { type Agent, type AgentCandidateEvidence, type AgentQualificationResult, type AgentRouteResult, type Assignment, type EnvironmentRequirement, type TaskRequirements, capabilitySatisfies, type AgentDescriptor } from "../../contracts/index.js";
import { EnvironmentRegistry } from "./environment-registry.js";
/** The honest answer when a task cannot be staffed. */
export declare const NO_QUALIFIED_AGENT: "NO_QUALIFIED_AGENT";
export interface QualificationOutcome {
    readonly outcome: "QUALIFIED" | typeof NO_QUALIFIED_AGENT;
    /** Qualified candidates, most specific first, then by id. */
    readonly candidates: readonly AgentDescriptor[];
    /** Every candidate considered, including the rejected ones and why. */
    readonly evidence: readonly AgentCandidateEvidence[];
}
export declare class AgentQualificationRouter {
    private readonly router;
    constructor(registry: EnvironmentRegistry);
    /**
     * Qualify a single descriptor against one task.
     *
     * Returns structured evidence either way. There is no "close enough": a
     * single unmet constraint disqualifies the agent, and the reason code says
     * which one.
     */
    qualifyDescriptor(descriptor: AgentDescriptor, requirements: TaskRequirements, context?: {
        isEnabled?: (agentId: string, projectId: string) => boolean;
    }): AgentCandidateEvidence;
    /**
     * Qualify every candidate against a task's full requirements.
     *
     * Deterministic: qualified agents first, then by id. Ties are broken by
     * specificity — an agent that covers MORE of the required capabilities is
     * ranked ahead of a generalist — then alphabetically, so the same inputs
     * always produce the same order and a routing decision is reproducible.
     */
    qualify(requirements: TaskRequirements, descriptors: readonly AgentDescriptor[], context?: {
        isEnabled?: (agentId: string, projectId: string) => boolean;
    }): QualificationOutcome;
    /**
     * Pick ONE agent, and return the assignment evidence that goes with it.
     *
     * This is the only path that may produce an {@link Assignment}. It is
     * strictly derived from `qualify`, so an assignment can never exist without
     * the qualification evidence that justifies it.
     */
    selectAssignment(requirements: TaskRequirements, descriptors: readonly AgentDescriptor[], options: {
        assignmentId: string;
        taskId: string;
        assignedBy: string;
        correlationId?: string;
        /** Do not return an agent that already holds this task (idempotent retry). */
        excludeAgentIds?: readonly string[];
        now: string;
        isEnabled?: (agentId: string, projectId: string) => boolean;
    }): {
        assignment: Assignment;
    } | {
        blocked: typeof NO_QUALIFIED_AGENT;
        evidence: readonly AgentCandidateEvidence[];
    };
    /**
     * Legacy capability-only qualification against an environment requirement.
     * Retained because the environment router and planning pipeline call it; the
     * strict descriptor-aware path above is what assignment uses.
     */
    qualifyLegacy(agent: Agent, requirement: EnvironmentRequirement): AgentQualificationResult;
    /**
     * Planning-time evaluation (EO-3.1) over the legacy flat `Agent` shape.
     *
     * Retained unchanged for the planning pipeline, which operates on agents
     * that predate specialist descriptors. It stays strict: no wildcard, no
     * nearest match.
     */
    evaluateCandidates(agents: readonly Agent[], requirement: {
        projectId: string;
        requiredCapabilities: readonly string[];
    }, isEnabled?: (agentId: string, projectId: string) => boolean): AgentCandidateEvidence[];
    route(agent: Agent, requirement: EnvironmentRequirement): AgentRouteResult;
}
/** Re-exported so callers can express hierarchy without a second import. */
export { capabilitySatisfies };
