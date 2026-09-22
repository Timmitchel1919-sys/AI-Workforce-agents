/**
 * Declarative definition and permission grants for the Developer Agent.
 * No behaviour here — see `developer-agent.ts`.
 */
import { type Agent, type AgentLimits, type ModelPolicy, type PermissionGrant } from "../../contracts/index.js";
export declare const DEVELOPER_AGENT_ID = "developer-agent";
export declare const DEVELOPER_TASK_TYPE = "development";
export declare const DEVELOPER_AGENT_LIMITS: AgentLimits;
/**
 * Phase 5's Developer Agent is planning/review-oriented: no repository, shell,
 * or filesystem access exists to grant. Every risky action is explicitly
 * denied as defence in depth; a real "apply this change" capability is a
 * later, approval-gated addition (see docs/workflows.md §"Known limitations").
 */
export declare function developerGrants(agentId?: string, extra?: readonly PermissionGrant[]): PermissionGrant[];
export interface DeveloperAgentDefinitionOptions {
    allowedProjects: readonly string[];
    modelPolicy?: ModelPolicy;
    /**
     * Additional read-only tool ids this agent may use beyond code planning —
     * e.g. a project adapter's inspect/read-file/test tools. Empty by default;
     * additive only, never grants write/shell/filesystem access.
     */
    extraAllowedTools?: readonly string[];
    extraGrants?: readonly PermissionGrant[];
}
export declare function makeDeveloperAgentDefinition(options: DeveloperAgentDefinitionOptions): Agent;
