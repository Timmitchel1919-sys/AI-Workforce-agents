import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test/renderWithProviders";
import type { ApiClient } from "../../../api";
import { ApiError } from "../../../api";
import type { AgentView, ApprovalView } from "../../../api/contracts";
import { AgentGovernanceCard } from "../components/AgentGovernanceCard";
import { toAgentListItem } from "../agentsView";

const NO_PENDING_TEXT = "No approval pending for this agent’s current task.";

function mkAgent(over: Partial<AgentView> = {}): AgentView {
  return {
    agentId: "a1",
    name: "Research Agent",
    role: "research",
    capabilities: [],
    status: "available",
    enabled: true,
    allowedProjects: ["*"],
    currentTaskId: "t-9",
    stats: {
      taskCount: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      successRate: null,
    },
    ...over,
  };
}

function approval(over: Partial<ApprovalView> = {}): ApprovalView {
  return {
    approvalId: "ap-1",
    status: "requested",
    action: "resume_task",
    risk: "high",
    requestedBy: "orchestrator:a1",
    reason: "approval policy requires a decision",
    requestedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function makeApi(options: {
  approvals?: ApprovalView[];
  error?: ApiError;
}): ApiClient {
  const get = vi.fn(async (path: string) => {
    if (path === "/approvals") {
      if (options.error) throw options.error;
      return {
        data: options.approvals ?? [],
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

describe("AgentGovernanceCard", () => {
  it("shows the real access level and real, backend-mirrored permissions", async () => {
    const client = makeApi({ approvals: [] });
    renderWithProviders(
      <AgentGovernanceCard agent={toAgentListItem(mkAgent())} />,
      { apiClient: client, auth: { role: "operator" } },
    );
    expect(screen.getByText("Operator")).toBeInTheDocument();

    // operator lacks disable_agent/enable_agent on the real backend
    const disableRow = screen.getByText("Disable agent").closest(".ui-inline");
    expect(disableRow).toHaveTextContent("Not granted");
    const viewRow = screen
      .getByText("View agent & executions")
      .closest(".ui-inline");
    expect(viewRow).toHaveTextContent("Granted");

    expect(await screen.findByText(NO_PENDING_TEXT)).toBeInTheDocument();
  });

  it("surfaces a pending approval correlated to the agent's current task", async () => {
    const client = makeApi({
      approvals: [approval({ taskId: "t-9" })],
    });
    renderWithProviders(
      <AgentGovernanceCard
        agent={toAgentListItem(mkAgent({ currentTaskId: "t-9" }))}
      />,
      { apiClient: client, auth: { role: "admin" } },
    );
    expect(await screen.findByText("Approval required")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View approval" })).toHaveAttribute(
      "href",
      "/approvals",
    );
    expect(screen.getByText("orchestrator:a1")).toBeInTheDocument();
  });

  it("does not claim a pending approval when the approval belongs to a different task", async () => {
    const client = makeApi({
      approvals: [approval({ taskId: "some-other-task" })],
    });
    renderWithProviders(
      <AgentGovernanceCard
        agent={toAgentListItem(mkAgent({ currentTaskId: "t-9" }))}
      />,
      { apiClient: client, auth: { role: "admin" } },
    );
    expect(await screen.findByText(NO_PENDING_TEXT)).toBeInTheDocument();
  });

  it("fails only the approval-status section on a governance data error, not the whole card", async () => {
    const client = makeApi({
      error: new ApiError({ kind: "server_error", message: "boom" }),
    });
    renderWithProviders(
      <AgentGovernanceCard agent={toAgentListItem(mkAgent())} />,
      { apiClient: client, auth: { role: "admin" } },
    );
    expect(
      await screen.findByText("Approval status is unavailable right now."),
    ).toBeInTheDocument();
    // the rest of the card (access level, permissions) still rendered
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("View agent & executions")).toBeInTheDocument();
  });

  it("never fabricates environment, owner, or policy data", () => {
    const client = makeApi({ approvals: [] });
    renderWithProviders(
      <AgentGovernanceCard agent={toAgentListItem(mkAgent())} />,
      { apiClient: client, auth: { role: "admin" } },
    );
    expect(
      screen.getByText(/not yet exposed by the Control Plane for agents/i),
    ).toBeInTheDocument();
  });
});
