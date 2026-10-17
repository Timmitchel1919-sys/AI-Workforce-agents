import type { GraphOperationalState, WorkforceGraphProjection } from "../../../../../contracts/graph";

export interface SpatialOperationalSummary {
  total: number;
  healthy: number;
  attention: number;
  activeExecutions: number;
}

const attentionStates = new Set<GraphOperationalState>(["blocked", "failed", "degraded", "offline", "cancelled", "rolled_back"]);
const healthyStates = new Set<GraphOperationalState>(["active", "completed", "deployed"]);
const executionTypes = new Set(["EXECUTION_PLAN", "EXECUTION_SESSION", "CHANGESET", "VERIFICATION", "REVIEW", "APPROVAL", "DEPLOYMENT"]);

/** Read-only Layer 3 integration over the existing projection. It never invents or persists state. */
export function summarizeSpatialOperations(graph: WorkforceGraphProjection): SpatialOperationalSummary {
  return graph.nodes.reduce<SpatialOperationalSummary>((summary, node) => {
    summary.total += 1;
    if (healthyStates.has(node.state)) summary.healthy += 1;
    if (attentionStates.has(node.state)) summary.attention += 1;
    if (executionTypes.has(node.type) && ["running", "queued", "awaiting_review", "awaiting_approval", "deploying"].includes(node.state)) {
      summary.activeExecutions += 1;
    }
    return summary;
  }, { total: 0, healthy: 0, attention: 0, activeExecutions: 0 });
}

