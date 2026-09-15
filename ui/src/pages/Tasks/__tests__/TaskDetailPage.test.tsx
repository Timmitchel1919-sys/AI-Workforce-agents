import { screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../api";
import { ApiError } from "../../../api";
import type {
  ApprovalView,
  AuditEventView,
  TaskView,
} from "../../../api/contracts";
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
    type: "agent_executed",
    taskId: "task-1",
    agentId: "research-agent",
    timestamp: "2026-09-01T10:01:00.000Z",
    data: {},
  },
  {
    id: "event-3",
    type: "task_completed",
    taskId: "task-1",
    timestamp: task.updatedAt,
    outcome: "completed",
    data: {},
  },
];

const approval: ApprovalView = {
  approvalId: "approval-1",
  status: "requested",
  action: "write",
  risk: "high",
  requestedBy: "project-manager-agent",
  reason: "A controlled repository change requires review.",
  taskId: task.taskId,
  projectId: task.projectId,
  requestedAt: "2026-09-01T10:05:00.000Z",
};

function makeApi(
  options: {
    task?: TaskView;
    taskError?: ApiError;
    auditError?: ApiError;
    approvals?: ApprovalView[];
    approvalError?: ApiError;
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
    if (path === "/approvals") {
      if (options.approvalError) throw options.approvalError;
      return {
        data: options.approvals ?? [],
        status: 200,
        correlationId: "approvals",
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
    const agentLinks = screen.getAllByRole("link", {
      name: "research-agent",
    });
    expect(agentLinks).toHaveLength(2);
    expect(agentLinks[1]).toHaveAttribute("href", "/agents/research-agent");
    const projectLinks = screen.getAllByRole("link", { name: "money-mind" });
    expect(projectLinks).toHaveLength(2);
    expect(projectLinks[1]).toHaveAttribute("href", "/projects/money-mind");
    expect(screen.getByText("workflow-1")).toHaveAttribute(
      "href",
      "/workflows/workflow-1",
    );
    expect(
      screen.getByRole("list", { name: "Task lifecycle timeline" }),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("list", { name: "Task lifecycle timeline" }),
      ).getByText("Task completed"),
    ).toBeInTheDocument();
    expect(screen.getByText("task-0")).toBeInTheDocument();
    expect(screen.getByText("Runtime intelligence")).toBeInTheDocument();
    expect(screen.getByText("Current execution")).toBeInTheDocument();
    expect(screen.getByText("9m")).toBeInTheDocument();
    expect(screen.getByText("Task governance")).toBeInTheDocument();
    expect(await screen.findByText("No approval linked")).toBeInTheDocument();
    expect(screen.getByText("Governance audit")).toBeInTheDocument();
  });

  it("renders the task's real approval summary and valid navigation", async () => {
    const { client } = makeApi({
      task: {
        ...task,
        approvalId: approval.approvalId,
        approvalState: "requested",
      },
      approvals: [approval],
    });
    renderWithProviders(detailRoute, {
      route: "/tasks/task-1",
      apiClient: client,
    });

    expect(await screen.findByText("Approval ID")).toBeInTheDocument();
    expect(screen.getByText("project-manager-agent")).toBeInTheDocument();
    expect(screen.getByText("Open Approvals")).toHaveAttribute(
      "href",
      "/approvals",
    );
    expect(screen.getByText("Open Audit Log")).toHaveAttribute(
      "href",
      "/audit",
    );
  });

  it("keeps task detail usable when approval data is restricted", async () => {
    const { client } = makeApi({
      approvalError: new ApiError({
        kind: "forbidden",
        message: "private approval details",
        status: 403,
      }),
    });
    renderWithProviders(detailRoute, {
      route: "/tasks/task-1",
      apiClient: client,
    });

    expect(
      await screen.findByRole("heading", { name: task.description }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Approval information restricted"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("private approval details"),
    ).not.toBeInTheDocument();
  });

  it("shows an honest empty runtime state before execution begins", async () => {
    const { client } = makeApi();
    const get = client.get as ReturnType<typeof vi.fn>;
    get.mockImplementation(async (path: string) => {
      if (path === "/tasks/task-1") {
        return { data: task, status: 200, correlationId: "task" };
      }
      if (path === "/audit") {
        return {
          data: { items: [audit[0]], total: 1, nextCursor: null },
          status: 200,
          correlationId: "audit",
        };
      }
      return { data: { status: "ok" }, status: 200, correlationId: "other" };
    });
    renderWithProviders(detailRoute, {
      route: "/tasks/task-1",
      apiClient: client,
    });

    expect(await screen.findByText("No execution yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Runtime details will appear when this task begins execution.",
      ),
    ).toBeInTheDocument();
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
    expect(
      screen.getByText("Runtime intelligence temporarily unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText("Audit summary unavailable")).toBeInTheDocument();
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
