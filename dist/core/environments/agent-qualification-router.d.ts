/**
 * AgentQualificationRouter — intentionally SEPARATED from environment routing.
 *
 * Qualification asks "does this agent DECLARE the capability to do the task?";
 * environment placement asks "is a real, usable environment installed?". The
 * two must not blur: a qualified agent with no environment is
 * `REQUIRES_PROVISIONING`, never a fabricated success, and an unqualified
 * agent is rejected even when an environment is available.
 */
import { type Agent, type AgentCandidateEvidence, type AgentQualificationResult, type AgentRouteResult, type EnvironmentRequirement } from "../../contracts/index.js";
import { EnvironmentRegistry } from "./environment-registry.js";
export declare class AgentQualificationRouter {
    private readonly router;
    constructor(registry: EnvironmentRegistry);
    qualify(agent: Agent, requirement: EnvironmentRequirement): AgentQualificationResult;
    /**
     * Planning-time qualification (EO-3.1): evaluate EVERY registered agent
     * against the capabilities a piece of work requires, with structured
     * evidence. Strict by design — no `"*"` wildcard, no nearest match: an agent
     * qualifies only when it is enabled, may work on the project, and declares
     * every required capability. Qualified agents come back first, then by id.
     *
     * AVAILABLE AGENT ≠ QUALIFIED AGENT.
     */
    evaluateCandidates(agents: readonly Agent[], requirement: {
        projectId: string;
        requiredCapabilities: readonly string[];
    }, isEnabled?: (agentId: string) => boolean): AgentCandidateEvidence[];
    route(agent: Agent, requirement: EnvironmentRequirement): AgentRouteResult;
}
