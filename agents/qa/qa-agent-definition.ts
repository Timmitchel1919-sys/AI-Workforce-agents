/**
 * Declarative definition and permission grants for the QA Agent.
 * No behaviour here — see `qa-agent.ts`.
 */
import {
  type Agent,
  type AgentLimits,
  type ModelPolicy,
  type PermissionAction,
  type PermissionGrant,
  DEFAULT_AGENT_LIMITS,
} from "../../contracts/index.js";

export const QA_AGENT_ID = "qa-agent";
export const QA_TASK_TYPE = "qa";

export const QA_AGENT_LIMITS: AgentLimits = {
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

export function qaGrants(
  agentId: string = QA_AGENT_ID,
  extra: readonly PermissionGrant[] = [],
): PermissionGrant[] {
  return [
    ...extra,
    ...RISKY_ACTIONS.map((action): PermissionGrant => ({
      effect: "deny",
      action,
      agentId,
      reason: `qa agent only evaluates and reports (${action} denied)`,
    })),
  ];
}

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

export function makeQaAgentDefinition(
  options: QaAgentDefinitionOptions,
): Agent {
  return {
    id: QA_AGENT_ID,
    name: "QA Agent",
    description:
      "Evaluates a prior task's output against explicit acceptance criteria " +
      "and returns a structured pass/fail/blocked verdict with evidence and " +
      "defects. Cannot approve its own work without evidence — the result " +
      'contract itself rejects a "pass" verdict unless every acceptance ' +
      "criterion has a satisfied finding.",
    capabilities: [
      "quality_assurance",
      "acceptance_testing",
      "defect_analysis",
    ],
    allowedTools: [...(options.extraAllowedTools ?? [])],
    allowedProjects: [...options.allowedProjects],
    supportedTaskTypes: [QA_TASK_TYPE],
    permissions: qaGrants(QA_AGENT_ID, options.extraGrants ?? []),
    modelPolicy: options.modelPolicy,
    metadata: {
      role: "qa",
      successCriteria: [
        "output validates against the QAResult contract",
        'a "pass" verdict is always backed by a satisfied finding per acceptance criterion',
      ],
      errorBehavior:
        "fail closed with a structured AgentExecutionError; never silently " +
        "approve",
      limits: QA_AGENT_LIMITS,
    },
  };
}
