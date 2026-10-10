import type { AgentAdministrativeStatus, AgentInstanceState, AgentListItem, AgentStatus } from "../../../features/agents";

/**
 * The two status axes, and how each maps onto a badge tone.
 *
 * They are kept as SEPARATE axes everywhere on purpose. Collapsing them into a
 * single "status" is what made a suspended agent look available and made an
 * agent with no instance look "idle" — both of which are false claims about
 * what can happen next.
 *
 * Kept free of components so fast refresh stays correct.
 */

export type AgentBadgeStatus =
  | "online"
  | "offline"
  | "idle"
  | "active"
  | "running"
  | "pending"
  | "completed"
  | "failed"
  | "paused"
  | "blocked";

/** Operational axis: what the instance is doing. */
export function mapOperationalStateToBadge(state: AgentInstanceState | AgentStatus): AgentBadgeStatus {
  switch (state) {
    case "available":
    case "idle":
      return "idle";
    case "active":
    case "busy":
      return "active";
    case "assigned":
      return "running";
    case "waiting":
    case "provisioning":
      return "pending";
    case "blocked":
    case "error":
      return "blocked";
    case "offline":
      return "offline";
    default:
      return "offline";
  }
}

/** Administrative axis: whether new work may be assigned at all. */
export function mapAdministrativeStatusToBadge(status: AgentAdministrativeStatus): AgentBadgeStatus {
  switch (status) {
    case "active":
      return "active";
    case "draft":
      return "pending";
    case "suspended":
      return "paused";
    case "disabled":
    case "retired":
      return "blocked";
    default:
      return "offline";
  }
}

/** The operational axis a row shows: the instance state when there is one. */
export function resolveOperationalState(agent: AgentListItem): AgentInstanceState | AgentStatus {
  return agent.specialist ? agent.specialist.operationalState : agent.status;
}

/** Can this agent be given new work right now? Deliberately not "available". */
export function isAcceptingWork(agent: AgentListItem): boolean {
  if (!agent.enabled) return false;
  return agent.specialist === undefined || agent.specialist.administrativeStatus === "active";
}
