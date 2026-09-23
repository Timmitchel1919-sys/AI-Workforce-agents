/**
 * AgentQualificationRouter — intentionally SEPARATED from environment routing.
 *
 * Qualification asks "does this agent DECLARE the capability to do the task?";
 * environment placement asks "is a real, usable environment installed?". The
 * two must not blur: a qualified agent with no environment is
 * `REQUIRES_PROVISIONING`, never a fabricated success, and an unqualified
 * agent is rejected even when an environment is available.
 */
import { type Agent, type AgentQualificationResult, type AgentRouteResult, type EnvironmentRequirement } from "../../contracts/index.js";
import { EnvironmentRegistry } from "./environment-registry.js";
export declare class AgentQualificationRouter {
    private readonly router;
    constructor(registry: EnvironmentRegistry);
    qualify(agent: Agent, requirement: EnvironmentRequirement): AgentQualificationResult;
    route(agent: Agent, requirement: EnvironmentRequirement): AgentRouteResult;
}
