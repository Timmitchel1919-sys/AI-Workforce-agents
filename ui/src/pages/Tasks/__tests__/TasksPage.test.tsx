import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApiClient } from "../../../api";
import { ApiError } from "../../../api";
import type { TaskView } from "../../../api/contracts";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { TasksPage } from "../TasksPage";

function task(overrides: Partial<TaskView> = {}): TaskView {
  return {
    taskId: "task-1",
    type: "research",
    description: "Inspect Money Mind architecture",
    projectId: "money-mind",
    status: "running",
    priority: "high",
    assignedAgentId: "research-agent",
    dependsOn: [],
    retryCount: 0,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:05:00.000Z",
    ...overrides,
  };
}

function makeApi(value: TaskView[] | ApiError) {
  const get = vi.fn(async (path: string) => {
    if (path === "/tasks") {
      if (value instanceof ApiError) throw value;
      return {
        data: { items: value, total: value.length, nextCursor: null },
        status: 200,
        correlationId: "task-test",
      };
    }
    return { data: { status: "ok" }, status: 200, correlationId: "test" };
  });
  return {
    client: {
      get,
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    } as unknown as ApiClient,
    get,
  };
}

describe("TasksPage", () => {
  it("shows a structured loading state first", () => {
    const { client } = makeApi([task()]);
    renderWithProviders(<TasksPage />, { route: "/tasks", apiClient: client });
    expect(screen.getByText(/loading the task registry/i)).toBeInTheDocument();
  });

  it("renders a data-derived summary and responsive task registry", async () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: true,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    const { client } = makeApi([
      task(),
      task({
        taskId: "task-2",
        description: "Review the report",
        status: "failed",
        priority: "normal",
      }),
    ]);
    renderWithProviders(<TasksPage />, { route: "/tasks", apiClient: client });

    const table = await screen.findByRole("table", { name: "Task registry" });
    expect(
      within(table).getByRole("link", { name: /Inspect Money Mind/ }),
    ).toHaveAttribute("href", "/tasks/task-1");
    expect(within(table).getByText("Review the report")).toBeInTheDocument();
    expect(
      screen.getByText("Total tasks").closest(".ui-metric"),
    ).toHaveTextContent("2");
    expect(
      screen.getByText("Needs attention").closest(".ui-metric"),
    ).toHaveTextContent("1");
    vi.unstubAllGlobals();
  });

  it("renders the empty state", async () => {
    const { client } = makeApi([]);
    renderWithProviders(<TasksPage />, { route: "/tasks", apiClient: client });
    expect(await screen.findByText("No tasks found")).toBeInTheDocument();
  });

  it("refreshes the registry on request", async () => {
    const { client, get } = makeApi([task()]);
    renderWithProviders(<TasksPage />, { route: "/tasks", apiClient: client });
    await screen.findByText("Inspect Money Mind architecture");
    const before = get.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before));
  });

  it("renders safe general and forbidden error states", async () => {
    const network = makeApi(
      new ApiError({
        kind: "network",
        message: "private",
        correlationId: "c1",
      }),
    );
    const view = renderWithProviders(<TasksPage />, {
      route: "/tasks",
      apiClient: network.client,
    });
    expect(await screen.findByText("Unable to load tasks")).toBeInTheDocument();
    expect(screen.queryByText("private")).not.toBeInTheDocument();
    view.unmount();

    const forbidden = makeApi(
      new ApiError({ kind: "forbidden", message: "no", status: 403 }),
    );
    renderWithProviders(<TasksPage />, {
      route: "/tasks",
      apiClient: forbidden.client,
    });
    expect(
      await screen.findByText(/don't have access to the task registry/i),
    ).toBeInTheDocument();
  });
});
