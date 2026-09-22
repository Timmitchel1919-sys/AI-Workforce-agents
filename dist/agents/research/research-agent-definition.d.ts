/**
 * Declarative definition, permission grants, and approval policy for the
 * Research Agent. No agent behaviour here — this is the metadata the
 * `AgentRegistry`, `PermissionSystem`, and orchestrator consume.
 */
import { type Agent, type AgentLimits, type ApprovalPolicy, type ModelPolicy, type PermissionGrant, type ToolDefinition } from "../../contracts/index.js";
export declare const RESEARCH_AGENT_ID = "research-agent";
export declare const RESEARCH_TOOL_SEARCH = "research.search";
export declare const RESEARCH_TOOL_FETCH = "research.fetch";
/**
 * Canonical policy metadata for the two research tools. The handlers live in
 * adapters (`mockResearchTools`, or a vetted provider); the security policy —
 * who / where / how often / which permission — lives here with the agent
 * domain. Both are read-only: no `approvalPolicy`.
 */
export declare const researchSearchToolDefinition: ToolDefinition;
export declare const researchFetchToolDefinition: ToolDefinition;
export declare const researchToolDefinitions: {
    readonly search: ToolDefinition;
    readonly fetch: ToolDefinition;
};
export declare const RESEARCH_AGENT_LIMITS: AgentLimits;
/**
 * Least-privilege grants for the Research Agent: it may only run the two
 * approved read-only research tools, and is explicitly denied every
 * state-changing / outbound capability.
 */
export declare function researchAgentGrants(agentId?: string, extra?: readonly PermissionGrant[]): PermissionGrant[];
export interface ResearchAgentDefinitionOptions {
    /** Projects this agent may be routed to. Empty = never eligible. */
    allowedProjects: readonly string[];
    /** Optional provider/model hint for the wiring layer. */
    modelPolicy?: ModelPolicy;
    /**
     * Additional tool ids this agent may use beyond the two core research
     * tools — e.g. a project adapter's read-only tools (see
     * `adapters/projects/money-mind/money-mind-tools.ts`). Empty by default;
     * additive only, never replaces `allowedTools`/`permissions`.
     */
    extraAllowedTools?: readonly string[];
    /** Grants paired with `extraAllowedTools` (still subject to the same deny-list below). */
    extraGrants?: readonly PermissionGrant[];
}
export declare function makeResearchAgentDefinition(options: ResearchAgentDefinitionOptions): Agent;
/**
 * Approval policy for research tasks:
 *
 * - read-only research (search + fetch) → **no** human approval
 * - a research task that also declares a `write` / `deploy` /
 *   `external_communication` / `secret_access` requirement → **approval-gated**
 *
 * Pass to `OrchestratorOptions.approvalPolicy`. Non-research tasks are left
 * to whatever other policy is in effect (this returns `{ required: false }`).
 */
export declare const researchApprovalPolicy: ApprovalPolicy;
