import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskView } from "../../../../api/contracts";
import type { AgentExecutionView } from "../../../Agents/executions";
import { renderWithProviders } from "../../../../test/renderWithProviders";
import { TaskRuntimeCard } from "../TaskRuntimeCard";

const task: TaskView = {
  taskId: "task-runtime-1",
  type: "research",
  description: "Inspect the current runtime state",
  projectId: "money-mind",
  status: "running",
  priority: "normal",
  assignedAgentId: "research-agent",
  dependsOn: [],
  retryCount: 0,
  createdAt: "2026-09-14T10:00:00.000Z",
  updatedAt: "2026-09-14T10:00:00.000Z",
};

function renderCard(execution: AgentExecutionView | null) {
  return renderWithProviders(
    <TaskRuntimeCard
      task={task}
      execution={execution}
      isPending={false}
      isError={false}
      error={null}
      onRetry={vi.fn()}
    />,
  );
}

describe("TaskRuntimeCard", () => {
  it("labels a running execution with elapsed time and links to the actual agent", () => {
    renderCard({
      id: "audit-dispatch-1",
      taskId: task.taskId,
      agentId: "research-agent",
      status: "running",
      startedAt: "2026-09-14T10:00:00.000Z",
      durationMs: null,
    });

    expect(screen.getByText("Elapsed")).toBeInTheDocument();
    expect(screen.getByText(/elapsed$/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "research-agent" }),
    ).toHaveAttribute("href", "/agents/research-agent");
  });

  it("uses the backend-redacted failure summary when an execution fails", () => {
    renderCard({
      id: "audit-dispatch-2",
      taskId: task.taskId,
      agentId: "research-agent",
      status: "failed",
      startedAt: "2026-09-14T10:00:00.000Z",
      completedAt: "2026-09-14T10:02:00.000Z",
      durationMs: 120_000,
      error: "Permission denied by the governed tool policy.",
    });

    expect(screen.getByText("Execution failed")).toBeInTheDocument();
    expect(
      screen.getByText("Permission denied by the governed tool policy."),
    ).toBeInTheDocument();
  });
});
