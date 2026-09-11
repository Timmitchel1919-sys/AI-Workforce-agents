import { describe, expect, it, vi } from "vitest";
import { Routes, Route } from "react-router-dom";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../test/renderWithProviders";
import type { ApiClient } from "../../../api";
import { ApiError } from "../../../api";
import type { AgentView, AuditEventView } from "../../../api/contracts";
import { AgentDetailPage } from "../AgentDetailPage";

function mkAgent(over: Partial<AgentView> = {}): AgentView {
  return {
    agentId: "a1",
    name: "Research Agent",
    role: "research",
    capabilities: ["web_search", "summarize"],
    status: "available",
    enabled: true,
    allowedProjects: ["money-mind"],
    currentTaskId: "t-42",
    currentProjectId: "money-mind",
    lastActivityAt: "2026-09-01T10:00:00.000Z",
    stats: {
      taskCount: 12,
      completed: 10,
      failed: 2,
      cancelled: 0,
      successRate: 0.83,
    },
    ...over,
  };
}

function makeApi(
  agents: AgentView[] | ApiError,
  audit: AuditEventView[] = [],
): ApiClient {
  const get = vi.fn(async (path: string) => {
    if (path.startsWith("/agents/")) {
      if (agents instanceof ApiError) throw agents;
      const id = decodeURIComponent(path.slice("/agents/".length));
      const found = agents.find((a) => a.agentId === id);
      if (!found) {
        throw new ApiError({
          kind: "not_found",
          message: "no such agent",
          status: 404,
        });
      }
      return { data: found, status: 200, correlationId: "t" };
    }
    if (path === "/audit") {
      return {
        data: { items: audit, total: audit.length, nextCursor: null },
        status: 200,
        correlationId: "t",
      };
    }
    return { data: undefined, status: 200, correlationId: "t" };
  });
  return {
    get,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as ApiClient;
}

function renderDetail(client: ApiClient, route: string, authRole = "operator") {
  return renderWithProviders(
    <Routes>
      <Route path="/agents/:agentId" element={<AgentDetailPage />} />
    </Routes>,
    { route, apiClient: client, auth: { role: authRole as never } },
  );
}

describe("AgentDetailPage", () => {
  it("renders the header, capabilities, workload and a health boundary", async () => {
    renderDetail(makeApi([mkAgent()]), "/agents/a1");

    expect(
      await screen.findByRole("heading", { name: "Research Agent" }),
    ).toBeInTheDocument();

    // header: status, id, project link, quick facts
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "money-mind" })).toHaveAttribute(
      "href",
      "/projects/money-mind",
    );
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);

    const caps = screen.getByRole("heading", { name: "Capabilities" });
    const capsSection = caps.closest("section") as HTMLElement;
    expect(within(capsSection).getByText("web_search")).toBeInTheDocument();
    expect(within(capsSection).getByText("summarize")).toBeInTheDocument();

    // workload from real stats
    const workload = screen
      .getByRole("heading", { name: "Workload" })
      .closest("section") as HTMLElement;
    expect(
      within(workload).getByText("Success rate").closest(".ui-metric"),
    ).toHaveTextContent("83%");
    expect(
      within(workload).getByRole("link", { name: "t-42" }),
    ).toHaveAttribute("href", "/tasks/t-42");

    // health is an explicit unavailable boundary, not fabricated data
    const health = screen
      .getByRole("heading", { name: "Health" })
      .closest("section") as HTMLElement;
    expect(
      within(health).getByText("Health data unavailable"),
    ).toBeInTheDocument();
  });

  it("shows recent executions derived from the audit feed (UI-5D)", async () => {
    const audit: AuditEventView[] = [
      {
        id: "e1",
        timestamp: "2026-09-01T09:00:00.000Z",
        type: "task_completed",
        agentId: "a1",
        taskId: "t-42",
        outcome: "completed",
        data: {},
      },
    ];
    renderDetail(makeApi([mkAgent()], audit), "/agents/a1");
    await screen.findByRole("heading", { name: "Research Agent" });
    const executions = screen
      .getByRole("heading", { name: "Recent executions" })
      .closest("section") as HTMLElement;
    // narrow (jsdom default) viewport renders execution cards
    expect(await within(executions).findByText("t-42")).toBeInTheDocument();
    expect(
      within(executions).getByText("Completed", {
        selector: ".ui-status-badge",
      }),
    ).toBeInTheDocument();
  });

  it("shows a 'no executions yet' state when the agent has no audit events", async () => {
    renderDetail(makeApi([mkAgent()], []), "/agents/a1");
    await screen.findByRole("heading", { name: "Research Agent" });
    expect(await screen.findByText("No executions yet")).toBeInTheDocument();
  });

  it("renders a not-found state for an unknown agent id", async () => {
    renderDetail(makeApi([mkAgent()]), "/agents/ghost");
    expect(await screen.findByText("Agent not found")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The requested agent does not exist or is no longer available.",
      ),
    ).toBeInTheDocument();
  });

  it("renders an access-restricted state on 403, distinct from not-found", async () => {
    renderDetail(
      makeApi(new ApiError({ kind: "forbidden", message: "no", status: 403 })),
      "/agents/a1",
    );
    expect(await screen.findByText("Access restricted")).toBeInTheDocument();
    expect(
      screen.getByText("You do not have permission to view this agent."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Agent not found")).not.toBeInTheDocument();
  });

  it("renders a retryable error state for a server failure", async () => {
    const error = new ApiError({
      kind: "server_error",
      message: "boom",
      status: 500,
    });
    renderDetail(makeApi(error), "/agents/a1");
    expect(
      await screen.findByText("Unable to load this agent"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("offers the disable action only to permitted roles", async () => {
    // viewer: no control capability → the action stays visible but disabled
    // (read-only mode, UI-5E), never hidden
    const { unmount } = renderDetail(
      makeApi([mkAgent()]),
      "/agents/a1",
      "viewer",
    );
    await screen.findByRole("heading", { name: "Research Agent" });
    expect(
      screen.getByRole("button", { name: /disable agent/i }),
    ).toHaveAttribute("aria-disabled", "true");
    unmount();

    // admin: disable action present, opens a confirmation dialog
    renderDetail(makeApi([mkAgent()]), "/agents/a1", "admin");
    await screen.findByRole("heading", { name: "Research Agent" });
    await userEvent.click(
      screen.getByRole("button", { name: /disable agent/i }),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      /Disable Research Agent\?/i,
    );
  });
});
