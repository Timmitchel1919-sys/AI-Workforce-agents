/**
 * Authoritative non-secret production capability declaration.
 *
 * Each capability is a trusted compiled binding. It contains no API key and
 * cannot load a module by name at runtime; OpenAI configuration is resolved
 * server-side only when the executor is invoked.
 */
import type {
  Agent,
  PermissionAction,
  PermissionGrant,
} from "../contracts/index.js";
import {
  CONTROL_PLANE_ANALYSIS_AGENT_ID,
  CONTROL_PLANE_ANALYSIS_TASK_TYPE,
  createProductionOpenAIAgentExecutor,
} from "../agents/control-plane-analysis/index.js";
import type { ProductionWorkforceConfiguration } from "./production-workforce-bootstrap.js";

const DENIED_ACTIONS: readonly PermissionAction[] = [
  "write",
  "deploy",
  "external_communication",
  "secret_access",
];

export const CONTROL_PLANE_ANALYSIS_AGENT: Agent = Object.freeze({
  id: CONTROL_PLANE_ANALYSIS_AGENT_ID,
  name: "Control Plane Analysis Agent",
  description:
    "Produces bounded, read-only structured analysis of an explicitly supplied Workforce task context.",
  capabilities: ["control_plane_analysis", "software_analysis"],
  allowedTools: [],
  allowedProjects: ["money-mind"],
  supportedTaskTypes: [CONTROL_PLANE_ANALYSIS_TASK_TYPE],
  permissions: DENIED_ACTIONS.map((action): PermissionGrant => ({
    effect: "deny",
    action,
    agentId: CONTROL_PLANE_ANALYSIS_AGENT_ID,
    reason: `read-only analysis agent: ${action} is denied`,
  })),
  modelPolicy: { provider: "openai" },
  metadata: Object.freeze({
    role: "control_plane_analyst",
    readOnly: true,
    toolAccess: "none",
  }),
});

export const PRODUCTION_WORKFORCE_CONFIGURATION: ProductionWorkforceConfiguration =
  Object.freeze({
    agents: Object.freeze([
      Object.freeze({
        definition: CONTROL_PLANE_ANALYSIS_AGENT,
        executorKey: "openai-control-plane-analysis",
      }),
    ]),
    executorBindings: Object.freeze({
      "openai-control-plane-analysis": createProductionOpenAIAgentExecutor,
    }),
    tools: Object.freeze([]),
    toolHandlerBindings: Object.freeze({}),
    projectAdapters: Object.freeze([]),
    permissionGrants: Object.freeze([]),
  });
