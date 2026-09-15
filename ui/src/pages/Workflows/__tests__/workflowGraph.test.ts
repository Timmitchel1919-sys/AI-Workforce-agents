import { describe, expect, it } from "vitest";
import type { TaskView, WorkflowView } from "../../../api/contracts";
import { toWorkflowGraph } from "../components";

const workflow: WorkflowView = {
  workflowId: "workflow-1",
  name: "Workflow",
  description: "Test workflow",
  projectId: "project-1",
  status: "running",
  paused: false,
  progress: { completed: 1, total: 3, failed: 0, blocked: 0, fraction: 1 / 3 },
  currentSpecId: "parallel-b",
  pendingApprovals: 0,
  participatingAgents: ["agent-a"],
  stages: [
    {
      specId: "source",
      type: "research",
      description: "Source",
      status: "completed",
      retryCount: 0,
    },
    {
      specId: "parallel-a",
      type: "analysis",
      description: "Parallel A",
      status: "ready",
      retryCount: 0,
    },
    {
      specId: "parallel-b",
      type: "analysis",
      description: "Parallel B",
      status: "running",
      retryCount: 0,
    },
  ],
  updatedAt: "2026-09-14T10:00:00.000Z",
};

function task(
  taskId: string,
  workflowSpecId: string,
  dependsOn: readonly string[],
): TaskView {
  return {
    taskId,
    workflowId: "workflow-1",
    workflowSpecId,
    type: "analysis",
    description: workflowSpecId,
    projectId: "project-1",
    status: "running",
    priority: "normal",
    assignedAgentId: "agent-a",
    dependsOn,
    retryCount: 0,
    createdAt: "2026-09-14T09:00:00.000Z",
    updatedAt: "2026-09-14T10:00:00.000Z",
  };
}

describe("toWorkflowGraph", () => {
  it("maps actual task dependencies without inferring sequential edges", () => {
    const graph = toWorkflowGraph(
      workflow,
      [
        task("task-source", "source", []),
        task("task-a", "parallel-a", ["task-source"]),
        task("task-b", "parallel-b", ["task-source"]),
      ],
      true,
    );

    expect(graph.nodes).toHaveLength(3);
    expect(
      graph.nodes.find((node) => node.id === "parallel-b")?.isCurrent,
    ).toBe(true);
    expect(graph.edges).toEqual([
      { source: "source", target: "parallel-a" },
      { source: "source", target: "parallel-b" },
    ]);
  });

  it("does not use stage array order as a dependency", () => {
    const graph = toWorkflowGraph(workflow, [], true);
    expect(graph.edges).toEqual([]);
    expect(graph.nodes.map((node) => node.id)).toEqual([
      "source",
      "parallel-a",
      "parallel-b",
    ]);
  });
});
