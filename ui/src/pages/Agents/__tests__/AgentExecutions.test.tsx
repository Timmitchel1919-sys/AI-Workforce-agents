import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../test/renderWithProviders";
import type { ApiClient } from "../../../api";
import { ApiError } from "../../../api";
import type { AuditEventView, TaskView } from "../../../api/contracts";
import { AgentExecutions } from "../components/AgentExecutions";

function ev(over: Partial<AuditEventView>): AuditEventView {
  return {
    id: "e0",
    timestamp: "2026-01-01T00:00:00.000Z",
    type: "task_completed",
    data: {},
    ...over,
  };
}

function mkTask(over: Partial<TaskView> = {}): TaskView {
  return {
    taskId: "t-1",
    type: "research",
    description: "Summarize market trends",
    projectId: "money-mind",
    status: "completed",
    priority: "normal",
    dependsOn: [],
    retryCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:05.000Z",
    workflowId: "wf-1",
    ...over,
  };
}

function makeApi(options: {
  events?: AuditEventView[];
  nextCursor?: string | null;
  auditError?: ApiError;
  task?: TaskView;
}): { client: ApiClient; get: ReturnType<typeof vi.fn> } {
  const get = vi.fn(async (path: string) => {
    if (path === "/audit") {
      if (options.auditError) throw options.auditError;
      return {
        data: {
          items: options.events ?? [],
          total: (options.events ?? []).length,
          nextCursor: options.nextCursor ?? null,
        },
        status: 200,
        correlationId: "t",
      };
    }
    if (path.startsWith("/tasks/")) {
      return {
        data: options.task ?? mkTask(),
        status: 200,
        correlationId: "t",
      };
    }
    return { data: undefined, status: 200, correlationId: "t" };
  });
  const client = {
    get,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as ApiClient;
  return { client, get };
}

const PAIR = [
  ev({
    id: "s1",
    type: "agent_executed",
    taskId: "t-1",
    timestamp: "2026-01-01T00:00:00.000Z",
  }),
  ev({
    id: "c1",
    type: "task_completed",
    taskId: "t-1",
    timestamp: "2026-01-01T00:00:42.000Z",
  }),
];

describe("AgentExecutions", () => {
  it("shows the summary and an execution card (narrow viewport)", async () => {
    const { client } = makeApi({ events: PAIR });
    renderWithProviders(<AgentExecutions agentId="a1" />, {
      apiClient: client,
    });

    expect(await screen.findByText("t-1")).toBeInTheDocument();
    expect(
      screen.getByText("Completed", { selector: ".ui-status-badge" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Duration: 42\.0s/)).toBeInTheDocument();

    // activity summary is windowed and derived, not fabricated
    const completedMetric = screen
      .getByText("Completed", {
        selector: ".ui-metric__label",
      })
      .closest(".ui-metric");
    expect(completedMetric).toHaveTextContent("1");
    const activeMetric = screen.getByText("Active").closest(".ui-metric");
    expect(activeMetric).toHaveTextContent("0");
  });

  it("distinguishes 'no executions yet' from a filtered empty result", async () => {
    const { client } = makeApi({ events: [] });
    renderWithProviders(<AgentExecutions agentId="a1" />, {
      apiClient: client,
    });
    expect(await screen.findByText("No executions yet")).toBeInTheDocument();
  });

  it("filtering to a status with no matches shows the filtered-empty state, distinct from 'no executions yet'", async () => {
    const { client } = makeApi({ events: PAIR });
    renderWithProviders(<AgentExecutions agentId="a1" />, {
      apiClient: client,
    });
    await screen.findByText("t-1");

    await userEvent.selectOptions(screen.getByLabelText("Status"), "failed");
    expect(
      await screen.findByText("No executions match your filters"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No executions yet")).not.toBeInTheDocument();
  });

  it("shows a distinct message on unauthorized access", async () => {
    const { client } = makeApi({
      auditError: new ApiError({
        kind: "forbidden",
        message: "no",
        status: 403,
      }),
    });
    renderWithProviders(<AgentExecutions agentId="a1" />, {
      apiClient: client,
    });
    expect(await screen.findByText("Access restricted")).toBeInTheDocument();
  });

  it("shows a retryable error state on a server failure, and Retry refetches", async () => {
    const { client, get } = makeApi({
      auditError: new ApiError({
        kind: "server_error",
        message: "boom",
        status: 500,
      }),
    });
    renderWithProviders(<AgentExecutions agentId="a1" />, {
      apiClient: client,
    });
    expect(
      await screen.findByText("Unable to load agent activity"),
    ).toBeInTheDocument();
    const before = get.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before));
  });

  it("opens the execution detail drawer and lazily loads the associated task for Workflow/Project linking", async () => {
    const { client, get } = makeApi({ events: PAIR, task: mkTask() });
    renderWithProviders(<AgentExecutions agentId="a1" />, {
      apiClient: client,
    });
    await screen.findByText("t-1");

    // no task fetch yet — lazy loading, not fetched per row
    expect(get.mock.calls.some((c) => String(c[0]).startsWith("/tasks/"))).toBe(
      false,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /view execution/i }),
    );
    const dialog = await screen.findByRole("dialog");

    await waitFor(() =>
      expect(
        get.mock.calls.some((c) => String(c[0]).startsWith("/tasks/")),
      ).toBe(true),
    );
    expect(
      await within(dialog).findByRole("link", { name: "wf-1" }),
    ).toHaveAttribute("href", "/workflows/wf-1");
    expect(
      within(dialog).getByText("Summarize market trends"),
    ).toBeInTheDocument();
  });
});
