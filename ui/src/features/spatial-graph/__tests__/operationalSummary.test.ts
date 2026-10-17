import { describe, expect, it } from "vitest";
import type { WorkforceGraphProjection } from "../../../../../contracts/graph";
import { summarizeSpatialOperations } from "../lib/operationalSummary";
import { node } from "./fixtures";

describe("Layer 3 spatial operations bridge", () => {
  it("summarizes only authoritative nodes in the existing projection", () => {
    const graph = {
      projectId: "p1", mode: "EXECUTION", revision: 1, generatedAt: "2026-10-16T00:00:00Z",
      nodes: [node("task", "TASK", "Blocked", "blocked"), node("session", "EXECUTION_SESSION", "Run", "running"), node("project", "PROJECT", "Project", "active")],
      edges: [], truncated: false, appliedLimits: { depth: 3, maxNodes: 250, maxEdges: 1500 },
    } satisfies WorkforceGraphProjection;
    expect(summarizeSpatialOperations(graph)).toEqual({ total: 3, healthy: 1, attention: 1, activeExecutions: 1 });
  });
});

