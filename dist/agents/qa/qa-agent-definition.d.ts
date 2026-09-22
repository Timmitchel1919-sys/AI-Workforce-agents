/**
 * Declarative definition and permission grants for the QA Agent.
 * No behaviour here — see `qa-agent.ts`.
 */
import { type Agent, type AgentLimits, type ModelPolicy, type PermissionGrant } from "../../contracts/index.js";
export declare const QA_AGENT_ID = "qa-agent";
export declare const QA_TASK_TYPE = "qa";
export declare const QA_AGENT_LIMITS: AgentLimits;
export declare function qaGrants(agentId?: string, extra?: readonly PermissionGrant[]): PermissionGrant[];
export interface QaAgentDefinitionOptions {
    allowedProjects: readonly string[];
    modelPolicy?: ModelPolicy;
    /**
     * Additional read-only tool ids this agent may use beyond evaluating a
     * given artifact — e.g. a project adapter's inspect/read-file/test tools.
     * Empty by default; additive only.
     */
    extraAllowedTools?: readonly string[];
    extraGrants?: readonly PermissionGrant[];
}
export declare function makeQaAgentDefinition(options: QaAgentDefinitionOptions): Agent;
