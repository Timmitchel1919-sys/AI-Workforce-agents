import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../api";
import { ApiError } from "../../../api";
import type { AuditEventView, TaskView } from "../../../api/contracts";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { TaskDetailPage } from "../TaskDetailPage";

const task: TaskView = {
  taskId: "task-1",
  type: "research",
  description: "Inspect Money Mind architecture",
  projectId: "money-mind",
  status: "completed",
  priority: "high",
  assignedAgentId: "research-agent",
  workflowId: "workflow-1",
  workflowSpecId: "research",
  dependsOn: ["task-0"],
  retryCount: 1,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:10:00.000Z",
};

const audit: AuditEventView[] = [
  {
    id: "event-1",
    type: "task_created",
    taskId: "task-1",
    timestamp: task.createdAt,
    data: {},
  },
  {
    id: "event-2",
    type: "task_completed",
    taskId: "task-1",
    timestamp: task.updatedAt,
    outcome: "completed",
    data: {},
  },
];

function makeApi(
  options: {
    task?: TaskView;
    taskError?: ApiError;
    auditError?: ApiError;
  } = {},
) {
  const get = vi.fn(async (path: string) => {
    if (path === "/tasks/task-1") {
      if (options.taskError) throw options.taskError;
      return { data: options.task ?? task, status: 200, correlationId: "task" };
    }
    if (path === "/audit") {
      if (options.auditError) throw options.auditError;
      return {
        data: { items: audit, total: audit.length, nextCursor: null },
        status: 200,
        correlationId: "audit",
      };
    }
    return { data: { status: "ok" }, status: 200, correlationId: "other" };
  });
  return {
    get,
    client: {
      get,
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    } as unknown as ApiClient,
  };
}

describe("TaskDetailPage", () => {
  const detailRoute = (
    <Routes>
      <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
    </Routes>
  );

  it("renders task relationships and its audit-backed lifecycle", async () => {
    const { client } = makeApi();
    renderWithProviders(detailRoute, {
      route: "/tasks/task-1",
      apiClient: client,
    });

    expect(
      await screen.findByRole("heading", { name: task.description }),
    ).toBeInTheDocument();
    expect(screen.getByText("research-agent")).toHaveAttribute(
      "href",
      "/agents/research-agent",
    );
    expect(screen.getByText("money-mind")).toHaveAttribute(
      "href",
      "/projects/money-mind",
    );
    expect(screen.getByText("workflow-1")).toHaveAttribute(
      "href",
      "/workflows/workflow-1",
    );
    expect(
      screen.getByRole("list", { name: "Task lifecycle timeline" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Task completed")).toBeInTheDocument();
    expect(screen.getByText("task-0")).toBeInTheDocument();
  });

  it("keeps task detail usable when only the audit feed fails", async () => {
    const { client } = makeApi({
      auditError: new ApiError({ kind: "network", message: "offline" }),
    });
    renderWithProviders(detailRoute, {
      route: "/tasks/task-1",
      apiClient: client,
    });
    expect(
      await screen.findByRole("heading", { name: task.description }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Timeline temporarily unavailable"),
    ).toBeInTheDocument();
  });

  it("renders a safe not-found state", async () => {
    const { client } = makeApi({
      taskError: new ApiError({
        kind: "not_found",
        message: "private",
        status: 404,
      }),
    });
    renderWithProviders(detailRoute, {
      route: "/tasks/task-1",
      apiClient: client,
    });
    expect(await screen.findByText("Task not found")).toBeInTheDocument();
    expect(screen.queryByText("private")).not.toBeInTheDocument();
  });
});
