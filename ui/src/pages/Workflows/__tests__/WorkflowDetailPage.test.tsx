import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApiClient } from "../../../api";
import { ApiError } from "../../../api";
import type {
  AuditEventView,
  TaskView,
  WorkflowView,
} from "../../../api/contracts";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { WorkflowDetailPage } from "../WorkflowDetailPage";

function makeWorkflow(overrides: Partial<WorkflowView> = {}): WorkflowView {
  return {
    workflowId: "workflow-1",
    name: "Money Mind review",
    description: "Review the current financial model.",
    projectId: "money-mind",
    status: "running",
    paused: false,
    progress: {
      completed: 1,
      total: 3,
      failed: 0,
      blocked: 0,
      fraction: 1 / 3,
    },
    currentSpecId: "analysis",
    pendingApprovals: 1,
    participatingAgents: ["research-agent", "qa-agent"],
    stages: [
      {
        specId: "research",
        type: "research",
        description: "Collect evidence",
        status: "completed",
        retryCount: 0,
      },
      {
        specId: "analysis",
        type: "analysis",
        description: "Evaluate evidence",
        status: "running",
        retryCount: 0,
      },
    ],
    startedAt: "2026-09-14T09:00:00.000Z",
    updatedAt: "2026-09-14T10:00:00.000Z",
    ...overrides,
  };
}

function makeTasks(): TaskView[] {
  return [
    {
      taskId: "task-research",
      workflowId: "workflow-1",
      workflowSpecId: "research",
      type: "research",
      description: "Collect evidence",
      projectId: "money-mind",
      status: "completed",
      priority: "normal",
      assignedAgentId: "research-agent",
      dependsOn: [],
      retryCount: 0,
      createdAt: "2026-09-14T09:00:00.000Z",
      updatedAt: "2026-09-14T09:30:00.000Z",
    },
    {
      taskId: "task-analysis",
      workflowId: "workflow-1",
      workflowSpecId: "analysis",
      type: "analysis",
      description: "Evaluate evidence",
      projectId: "money-mind",
      status: "running",
      priority: "normal",
      assignedAgentId: "qa-agent",
      dependsOn: ["task-research"],
      retryCount: 0,
      createdAt: "2026-09-14T09:30:00.000Z",
      updatedAt: "2026-09-14T10:00:00.000Z",
    },
  ];
}

function makeAuditEvents(): AuditEventView[] {
  return [
    {
      id: "event-start",
      type: "agent_executed",
      timestamp: "2026-09-14T09:30:00.000Z",
      workflowId: "workflow-1",
      taskId: "task-analysis",
      agentId: "qa-agent",
      data: {},
    },
    {
      id: "event-complete",
      type: "task_completed",
      timestamp: "2026-09-14T09:45:00.000Z",
      workflowId: "workflow-1",
      taskId: "task-research",
      agentId: "research-agent",
      outcome: "completed",
      data: {},
    },
  ];
}

function makeApi(
  workflows: WorkflowView[] | ApiError,
  tasks: TaskView[] | ApiError = makeTasks(),
  auditEvents: AuditEventView[] | ApiError = makeAuditEvents(),
): ApiClient {
  const get = vi.fn(async (path: string) => {
    if (path.startsWith("/workflows/")) {
      if (workflows instanceof ApiError) throw workflows;
      const id = decodeURIComponent(path.slice("/workflows/".length));
      const workflow = workflows.find((item) => item.workflowId === id);
      if (!workflow) {
        throw new ApiError({
          kind: "not_found",
          message: "missing",
          status: 404,
        });
      }
      return { data: workflow, status: 200, correlationId: "workflow-detail" };
    }
    if (path === "/tasks") {
      if (tasks instanceof ApiError) throw tasks;
      return {
        data: { items: tasks, total: tasks.length, nextCursor: null },
        status: 200,
        correlationId: "workflow-tasks",
      };
    }
    if (path === "/audit") {
      if (auditEvents instanceof ApiError) throw auditEvents;
      return {
        data: {
          items: auditEvents,
          total: auditEvents.length,
          nextCursor: null,
        },
        status: 200,
        correlationId: "workflow-audit",
      };
    }
    return { data: { status: "ok" }, status: 200, correlationId: "other" };
  });
  return {
    get,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as ApiClient;
}

function renderDetail(client: ApiClient, route = "/workflows/workflow-1") {
  return renderWithProviders(
    <Routes>
      <Route path="/workflows/:workflowId" element={<WorkflowDetailPage />} />
    </Routes>,
    { route, apiClient: client },
  );
}

describe("WorkflowDetailPage", () => {
  it("renders actual workflow intelligence, relationships, and valid links", async () => {
    renderDetail(makeApi([makeWorkflow()]));

    expect(
      await screen.findByRole("heading", { name: "Money Mind review" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("workflow-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Collect evidence").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Evaluate evidence").length).toBeGreaterThan(0);
    expect(screen.getByText("Trigger unavailable")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Workflow steps and dependencies" }),
    ).toBeInTheDocument();
    expect(screen.getByText("research → analysis")).toBeInTheDocument();
    expect(
      screen.getAllByText("Not exposed by the Control Plane").length,
    ).toBeGreaterThan(0);

    const participants = screen
      .getByRole("heading", { name: "Participants" })
      .closest("section") as HTMLElement;
    expect(
      within(participants).getByRole("link", { name: "research-agent" }),
    ).toHaveAttribute("href", "/agents/research-agent");
    expect(
      within(participants).getByRole("link", { name: "qa-agent" }),
    ).toHaveAttribute("href", "/agents/qa-agent");
  });

  it("shows a genuine not-found state for an unknown workflow id", async () => {
    renderDetail(makeApi([makeWorkflow()]), "/workflows/missing");
    expect(await screen.findByText("Workflow not found")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The requested workflow does not exist or is no longer available.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps restricted access distinct from not-found", async () => {
    renderDetail(
      makeApi(
        new ApiError({ kind: "forbidden", message: "restricted", status: 403 }),
      ),
    );
    expect(await screen.findByText("Access restricted")).toBeInTheDocument();
    expect(screen.queryByText("Workflow not found")).not.toBeInTheDocument();
  });

  it("shows a retryable error state for a server failure", async () => {
    renderDetail(
      makeApi(
        new ApiError({ kind: "server_error", message: "offline", status: 500 }),
      ),
    );
    expect(
      await screen.findByText("Unable to load this workflow"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("surfaces actual pause and workflow error metadata", async () => {
    renderDetail(
      makeApi([
        makeWorkflow({
          paused: true,
          pauseReason: "Waiting for legal review",
          error: "A dependent task failed.",
        }),
      ]),
    );
    expect(await screen.findByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("Waiting for legal review")).toBeInTheDocument();
    expect(screen.getByText("Latest workflow error")).toBeInTheDocument();
  });

  it("uses real task dependencies and provides keyboard-safe node selection", async () => {
    const user = userEvent.setup();
    renderDetail(makeApi([makeWorkflow()]));

    const stageMap = await screen.findByRole("list", {
      name: "Workflow steps",
    });
    const analysisNode = within(stageMap).getByRole("button", {
      name: /Evaluate evidence\. running\. Current step/i,
    });
    expect(analysisNode).toHaveAttribute("aria-pressed", "true");

    await user.click(
      within(stageMap).getByRole("button", {
        name: /Collect evidence\. completed/i,
      }),
    );
    const detail = screen
      .getByRole("heading", { name: "Selected step" })
      .closest("section") as HTMLElement;
    expect(within(detail).getByText("task-research")).toBeInTheDocument();
    expect(within(detail).getByText("research-agent")).toHaveAttribute(
      "href",
      "/agents/research-agent",
    );
  });

  it("keeps stage order distinct from an unavailable dependency relationship", async () => {
    renderDetail(makeApi([makeWorkflow()], []));
    expect(
      await screen.findByText("Dependency graph unavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByText("research → analysis")).not.toBeInTheDocument();
  });

  it("isolates a task relationship error to the graph section", async () => {
    renderDetail(
      makeApi(
        [makeWorkflow()],
        new ApiError({ kind: "forbidden", message: "restricted", status: 403 }),
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "Money Mind review" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Access restricted").length).toBeGreaterThan(0);
  });

  it("renders no fake steps when the workflow has no stages", async () => {
    renderDetail(makeApi([makeWorkflow({ stages: [] })], []));
    expect(
      await screen.findByText("No workflow steps available"),
    ).toBeInTheDocument();
  });

  it("renders a running workflow runtime with real task and agent references", async () => {
    renderDetail(makeApi([makeWorkflow()]));
    expect(
      await screen.findByRole("heading", { name: "Runtime intelligence" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Current workflow runtime")).toBeInTheDocument();
    expect(screen.getAllByText("Current step").length).toBeGreaterThan(0);
    expect(screen.getByText("Authoritative progress")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Step executions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Runtime events" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("agent executed").length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", { name: "task-analysis" })[0],
    ).toHaveAttribute("href", "/tasks/task-analysis");
    expect(
      screen.getByRole("heading", { name: "Workflow governance" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Workflow provenance" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Operational permission hints"),
    ).toBeInTheDocument();
  });

  it("shows a safe completed outcome without inventing a result summary", async () => {
    renderDetail(
      makeApi([
        makeWorkflow({
          status: "completed",
          currentSpecId: undefined,
          completedAt: "2026-09-14T11:00:00.000Z",
        }),
      ]),
    );
    expect(await screen.findByText("Workflow completed")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The Control Plane reports this workflow as completed. A result summary is not exposed.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a local restricted runtime state without removing workflow detail", async () => {
    renderDetail(
      makeApi(
        [makeWorkflow()],
        makeTasks(),
        new ApiError({ kind: "forbidden", message: "restricted", status: 403 }),
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "Money Mind review" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Runtime details restricted").length,
    ).toBeGreaterThan(0);
  });
});
