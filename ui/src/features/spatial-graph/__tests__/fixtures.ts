import type { SpatialGraphViewProps } from "../components/SpatialGraphView";
import type {
  GraphOperationalState,
  WorkforceGraphEdge,
  WorkforceGraphNode,
  WorkforceGraphNodeType,
  WorkforceGraphProjection,
} from "../../../../../contracts/graph";

export function node(
  id: string,
  type: WorkforceGraphNodeType,
  label: string,
  state: GraphOperationalState = "active",
  metadata?: WorkforceGraphNode["metadata"],
  status = state,
): WorkforceGraphNode {
  return { id, type, label, state, status, projectId: "p1", referenceId: id.replace(/^[a-z]+-/, ""), metadata };
}

export function edge(source: string, target: string, type: WorkforceGraphEdge["type"]): WorkforceGraphEdge {
  return { id: `${type}:${source}:${target}`, source, target, type };
}

export function makeProjection(overrides: Partial<WorkforceGraphProjection> = {}): WorkforceGraphProjection {
  return {
    projectId: "p1",
    mode: "WORKFORCE",
    revision: 1,
    generatedAt: "2026-09-26T00:00:00.000Z",
    truncated: false,
    appliedLimits: { depth: 3, maxNodes: 250, maxEdges: 1500 },
    nodes: [
      node("project-p1", "PROJECT", "Apollo"),
      node("agent-a1", "AGENT", "Builder", "active", { role: "Builds features" }),
      node("agent-a2", "AGENT", "Reviewer", "offline"),
      node("task-t1", "TASK", "Write API", "running"),
      node("task-t2", "TASK", "Write UI", "blocked", { priority: "high" }),
      node("task-t3", "TASK", "Docs", "completed"),
      node("program-g1", "PROGRAM", "Launch", "queued"),
      node("env-e1", "ENVIRONMENT", "Node runner", "unavailable"),
    ],
    edges: [
      edge("project-p1", "agent-a1", "CONTAINS"),
      edge("project-p1", "agent-a2", "CONTAINS"),
      edge("project-p1", "task-t1", "HAS_TASK"),
      edge("project-p1", "task-t2", "HAS_TASK"),
      edge("project-p1", "task-t3", "HAS_TASK"),
      edge("project-p1", "program-g1", "CONTAINS"),
      edge("agent-a1", "task-t1", "ASSIGNED_TO"),
      edge("task-t2", "task-t1", "DEPENDS_ON"),
    ],
    ...overrides,
  };
}

/** Captures the props the (mocked) 3D view receives, so tests can assert what would be rendered. */
export const viewHarness: { props: SpatialGraphViewProps } = { props: undefined as unknown as SpatialGraphViewProps };
