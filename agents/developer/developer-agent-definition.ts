/**
 * Declarative definition and permission grants for the Developer Agent.
 * No behaviour here — see `developer-agent.ts`.
 */
import {
  type Agent,
  type AgentLimits,
  type ModelPolicy,
  type PermissionAction,
  type PermissionGrant,
  DEFAULT_AGENT_LIMITS,
} from "../../contracts/index.js";

export const DEVELOPER_AGENT_ID = "developer-agent";
export const DEVELOPER_TASK_TYPE = "development";

export const DEVELOPER_AGENT_LIMITS: AgentLimits = {
  ...DEFAULT_AGENT_LIMITS,
  maxIterations: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  timeoutMs: 60_000,
};

const RISKY_ACTIONS: readonly PermissionAction[] = [
  "write",
  "deploy",
  "external_communication",
  "secret_access",
];

/**
 * Phase 5's Developer Agent is planning/review-oriented: no repository, shell,
 * or filesystem access exists to grant. Every risky action is explicitly
 * denied as defence in depth; a real "apply this change" capability is a
 * later, approval-gated addition (see docs/workflows.md §"Known limitations").
 */
export function developerGrants(
  agentId: string = DEVELOPER_AGENT_ID,
  extra: readonly PermissionGrant[] = [],
): PermissionGrant[] {
  return [
    ...extra,
    ...RISKY_ACTIONS.map((action): PermissionGrant => ({
      effect: "deny",
      action,
      agentId,
      reason: `developer agent proposes changes only (${action} denied)`,
    })),
  ];
}

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

export function makeDeveloperAgentDefinition(
  options: DeveloperAgentDefinitionOptions,
): Agent {
  return {
    id: DEVELOPER_AGENT_ID,
    name: "Developer Agent",
    description:
      "Produces an implementation plan and a set of proposed, described code " +
      "changes with rationale and risk level. Never writes to a repository, " +
      "runs a shell command, or touches the filesystem directly itself.",
    capabilities: [
      "code_analysis",
      "implementation_planning",
      "code_generation",
      "code_review",
      "debugging_analysis",
    ],
    allowedTools: [...(options.extraAllowedTools ?? [])],
    allowedProjects: [...options.allowedProjects],
    supportedTaskTypes: [DEVELOPER_TASK_TYPE],
    permissions: developerGrants(DEVELOPER_AGENT_ID, options.extraGrants ?? []),
    modelPolicy: options.modelPolicy,
    metadata: {
      role: "developer",
      successCriteria: [
        "output validates against the DeveloperResult contract",
        "every proposed change carries a rationale and an explicit risk level",
      ],
      errorBehavior:
        "fail closed with a structured AgentExecutionError; never apply a " +
        "change, only propose one",
      limits: DEVELOPER_AGENT_LIMITS,
    },
  };
}
