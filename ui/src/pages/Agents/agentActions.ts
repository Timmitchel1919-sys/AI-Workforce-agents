/**
 * Agent operations — action model (UI-5C).
 *
 * Operation matrix, verified against the actual Control Plane
 * (`contracts/control.ts` → `CONTROL_COMMANDS`, `control/services/
 * workforce-command-service.ts`):
 *
 *   | Operation | Exists? | Command          | Approval required? |
 *   |-----------|---------|------------------|---------------------|
 *   | Activate  | No      | —                | —                   |
 *   | Pause     | No      | —                | —                   |
 *   | Resume    | No      | —                | —                   |
 *   | Restart   | No      | —                | —                   |
 *   | Configure | No      | —                | —                   |
 *   | Delete    | No      | —                | —                   |
 *   | Disable   | Yes     | `disable_agent`  | No (never gated)    |
 *   | Enable    | Yes     | `enable_agent`   | No (never gated)    |
 *
 * Only `disable` / `enable` are modeled — nothing else exists to expose.
 * Extend `AgentAction` (re-exported from `features/agents`) only once the
 * Control Plane adds the corresponding command + `ControlCapability`.
 */
import type { OperatorRole } from "../../api/contracts";
import type { UiCapability } from "../../auth/permissions";
import { can } from "../../auth/permissions";
import type { AgentAction } from "../../features/agents";
import type { AgentListItem } from "./agentsView";

export type { AgentAction };

interface AgentActionSpec {
  action: AgentAction;
  capability: UiCapability;
  label: string;
  dialogTitle: (agent: AgentListItem) => string;
  /** Real lifecycle consequence — never invented copy. */
  consequence: (agent: AgentListItem) => string;
  /** True when this action is the agent's current lifecycle direction. */
  appliesTo: (agent: AgentListItem) => boolean;
}

const ACTION_SPECS: readonly AgentActionSpec[] = [
  {
    action: "disable",
    capability: "disable_agent",
    label: "Disable agent",
    dialogTitle: (agent) => `Disable ${agent.name}?`,
    consequence: (agent) =>
      `"${agent.name}" will stop being assigned new work. Running tasks are unaffected. You can re-enable it later.`,
    appliesTo: (agent) => agent.enabled,
  },
  {
    action: "enable",
    capability: "enable_agent",
    label: "Enable agent",
    dialogTitle: (agent) => `Enable ${agent.name}?`,
    consequence: (agent) =>
      `"${agent.name}" will become eligible for task assignment again.`,
    appliesTo: (agent) => !agent.enabled,
  },
];

function specFor(action: AgentAction): AgentActionSpec {
  const spec = ACTION_SPECS.find((s) => s.action === action);
  if (!spec) throw new Error(`unknown agent action: ${action}`);
  return spec;
}

/**
 * The action(s) that make sense for this agent's *current* status, filtered
 * by what the signed-in operator's role may do. This is UX only — the
 * Control Plane re-validates and re-authorizes every request regardless of
 * what the frontend decided to show. An agent is either enabled (offer
 * Disable) or disabled (offer Enable); never both, never neither unless the
 * operator lacks the capability.
 */
export function availableAgentActions(
  agent: AgentListItem,
  role: OperatorRole | null | undefined,
): AgentAction[] {
  return ACTION_SPECS.filter(
    (spec) => spec.appliesTo(agent) && can(role, spec.capability),
  ).map((spec) => spec.action);
}

export function agentActionLabel(action: AgentAction): string {
  return specFor(action).label;
}

export function agentActionDialogTitle(
  action: AgentAction,
  agent: AgentListItem,
): string {
  return specFor(action).dialogTitle(agent);
}

export function agentActionConsequence(
  action: AgentAction,
  agent: AgentListItem,
): string {
  return specFor(action).consequence(agent);
}
