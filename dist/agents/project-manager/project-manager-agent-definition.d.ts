/**
 * Declarative definition and permission grants for the Project Manager Agent.
 * No behaviour here — see `project-manager-agent.ts`.
 */
import { type Agent, type AgentLimits, type ModelPolicy, type PermissionGrant } from "../../contracts/index.js";
export declare const PROJECT_MANAGER_AGENT_ID = "project-manager-agent";
export declare const PROJECT_MANAGER_PLAN_TASK_TYPE = "project-manager-plan";
export declare const PROJECT_MANAGER_AGENT_LIMITS: AgentLimits;
/**
 * The Project Manager has no tools and needs no `allow` grants — it produces a
 * decomposition/summary decision only. Deny grants are explicit anyway, as
 * defence in depth if a future revision ever adds a capability.
 */
export declare function projectManagerGrants(agentId?: string, extra?: readonly PermissionGrant[]): PermissionGrant[];
export interface ProjectManagerAgentDefinitionOptions {
    allowedProjects: readonly string[];
    modelPolicy?: ModelPolicy;
    /**
     * Additional read-only tool ids this agent may use beyond its own planning
     * — e.g. a project adapter's status tool. Empty by default; additive only.
     */
    extraAllowedTools?: readonly string[];
    extraGrants?: readonly PermissionGrant[];
}
export declare function makeProjectManagerAgentDefinition(options: ProjectManagerAgentDefinitionOptions): Agent;
