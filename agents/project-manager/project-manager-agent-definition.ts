/**
 * Declarative definition and permission grants for the Project Manager Agent.
 * No behaviour here — see `project-manager-agent.ts`.
 */
import {
  type Agent,
  type AgentLimits,
  type ModelPolicy,
  type PermissionAction,
  type PermissionGrant,
  DEFAULT_AGENT_LIMITS,
} from "../../contracts/index.js";

export const PROJECT_MANAGER_AGENT_ID = "project-manager-agent";
export const PROJECT_MANAGER_PLAN_TASK_TYPE = "project-manager-plan";

export const PROJECT_MANAGER_AGENT_LIMITS: AgentLimits = {
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
 * The Project Manager has no tools and needs no `allow` grants — it produces a
 * decomposition/summary decision only. Deny grants are explicit anyway, as
 * defence in depth if a future revision ever adds a capability.
 */
export function projectManagerGrants(
  agentId: string = PROJECT_MANAGER_AGENT_ID,
): PermissionGrant[] {
  return RISKY_ACTIONS.map((action) => ({
    effect: "deny",
    action,
    agentId,
    reason: `project manager does not act directly (${action} denied)`,
  }));
}

export interface ProjectManagerAgentDefinitionOptions {
  allowedProjects: readonly string[];
  modelPolicy?: ModelPolicy;
}

export function makeProjectManagerAgentDefinition(
  options: ProjectManagerAgentDefinitionOptions,
): Agent {
  return {
    id: PROJECT_MANAGER_AGENT_ID,
    name: "Project Manager Agent",
    description:
      "Decomposes a high-level objective into a structured, dependency-ordered " +
      "subtask plan, and summarizes a completed workflow. Never executes a tool " +
      "or dispatches a task itself — the WorkflowEngine validates and executes " +
      "every recommendation.",
    capabilities: [
      "task_decomposition",
      "workflow_planning",
      "workflow_summary",
    ],
    allowedTools: [],
    allowedProjects: [...options.allowedProjects],
    supportedTaskTypes: [PROJECT_MANAGER_PLAN_TASK_TYPE],
    permissions: projectManagerGrants(),
    modelPolicy: options.modelPolicy,
    metadata: {
      role: "project-manager",
      successCriteria: [
        "output validates against the ProjectManagerDecision contract",
        "every recommended subtask/agent is re-validated by the WorkflowEngine before any task is created",
      ],
      errorBehavior:
        "fail closed with a structured AgentExecutionError; never create a " +
        "task or assign an agent itself",
      limits: PROJECT_MANAGER_AGENT_LIMITS,
    },
  };
}
