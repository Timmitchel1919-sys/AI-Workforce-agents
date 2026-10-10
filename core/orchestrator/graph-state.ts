import type { GraphOperationalState } from "../../contracts/graph.js";

/**
 * The single place raw authoritative statuses are mapped to the graph's
 * normalised operational vocabulary. Unknown input maps to "unavailable" —
 * a state is never invented.
 */
const STATE_BY_STATUS: Readonly<Record<string, GraphOperationalState>> = {
  // tasks
  created: "queued",
  queued: "queued",
  pending: "queued",
  ready: "queued",
  planned: "queued",
  running: "running",
  dispatched: "running",
  blocked: "blocked",
  awaiting_approval: "blocked",
  paused: "blocked",
  completed: "completed",
  skipped: "completed",
  failed: "failed",
  // registries / environments
  active: "active",
  available: "active",
  degraded: "blocked",
  unavailable: "offline",
  disabled: "offline",
  offline: "offline",
  cancelled: "unavailable",
  // environment routing
  routed: "active",
  requires_provisioning: "blocked",
  no_environment: "offline",
  unsupported: "unavailable",
};

export function toGraphState(
  status: string | undefined,
): GraphOperationalState {
  if (!status) return "unavailable";
  return STATE_BY_STATUS[status] ?? "unavailable";
}
