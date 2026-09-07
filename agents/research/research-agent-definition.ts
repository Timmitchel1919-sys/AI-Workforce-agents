/**
 * Declarative definition, permission grants, and approval policy for the
 * Research Agent. No agent behaviour here — this is the metadata the
 * `AgentRegistry`, `PermissionSystem`, and orchestrator consume.
 */
import {
  type Agent,
  type AgentLimits,
  type ApprovalPolicy,
  type ModelPolicy,
  type PermissionAction,
  type PermissionGrant,
  DEFAULT_AGENT_LIMITS,
} from "../../contracts/index.js";

export const RESEARCH_AGENT_ID = "research-agent";
export const RESEARCH_TOOL_SEARCH = "research.search";
export const RESEARCH_TOOL_FETCH = "research.fetch";

export const RESEARCH_AGENT_LIMITS: AgentLimits = {
  ...DEFAULT_AGENT_LIMITS,
  maxIterations: 3,
  maxToolCalls: 8,
  maxModelCalls: 4,
  timeoutMs: 60_000,
};

const RISKY_ACTIONS: readonly PermissionAction[] = [
  "write",
  "deploy",
  "external_communication",
  "secret_access",
];

/**
 * Least-privilege grants for the Research Agent: it may only run the two
 * approved read-only research tools, and is explicitly denied every
 * state-changing / outbound capability.
 */
export function researchAgentGrants(
  agentId: string = RESEARCH_AGENT_ID,
): PermissionGrant[] {
  return [
    {
      effect: "allow",
      action: "execute",
      agentId,
      toolId: RESEARCH_TOOL_SEARCH,
      reason: "run an approved research search",
    },
    {
      effect: "allow",
      action: "read",
      agentId,
      toolId: RESEARCH_TOOL_FETCH,
      reason: "read an approved research source",
    },
    ...RISKY_ACTIONS.map((action): PermissionGrant => ({
      effect: "deny",
      action,
      agentId,
      reason: `research agent is read-only (${action} denied)`,
    })),
  ];
}

export interface ResearchAgentDefinitionOptions {
  /** Projects this agent may be routed to. Empty = never eligible. */
  allowedProjects: readonly string[];
  /** Optional provider/model hint for the wiring layer. */
  modelPolicy?: ModelPolicy;
}

export function makeResearchAgentDefinition(
  options: ResearchAgentDefinitionOptions,
): Agent {
  return {
    id: RESEARCH_AGENT_ID,
    name: "Research Agent",
    description:
      "Reusable general agent that runs a bounded, source-grounded research " +
      "workflow and returns a structured ResearchResult.",
    capabilities: [
      "web_research",
      "information_analysis",
      "source_evaluation",
      "summarization",
      "evidence_synthesis",
    ],
    allowedTools: [RESEARCH_TOOL_SEARCH, RESEARCH_TOOL_FETCH],
    allowedProjects: [...options.allowedProjects],
    supportedTaskTypes: ["research"],
    permissions: researchAgentGrants(),
    modelPolicy: options.modelPolicy,
    metadata: {
      role: "researcher",
      successCriteria: [
        "output validates against the ResearchResult contract",
        "every fact/claim finding cites at least one verified collected source",
        "confidence is computed from evidence quality and completeness, not model wording",
      ],
      errorBehavior:
        "fail closed with a structured AgentExecutionError (reason + details); " +
        "never return a partial or unstructured result",
      limits: RESEARCH_AGENT_LIMITS,
    },
  };
}

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
export const researchApprovalPolicy: ApprovalPolicy = {
  evaluate: (task) => {
    if (task.type !== "research") return { required: false };
    const risky = task.requiredPermissions
      .map((p) => p.action)
      .filter((action) => RISKY_ACTIONS.includes(action));
    if (risky.length === 0) return { required: false };
    return {
      required: true,
      action: `research:${[...new Set(risky)].join("+")}`,
      reason:
        "research task requests a state-changing or outbound capability and " +
        "needs a human decision",
    };
  },
};
