import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../test/renderWithProviders";
import type { ApiClient } from "../../../api";
import { ApiError } from "../../../api";
import type { AuditEventView } from "../../../api/contracts";
import { AgentAuditSummary } from "../components/AgentAuditSummary";

function ev(over: Partial<AuditEventView>): AuditEventView {
  return {
    id: "e0",
    timestamp: "2026-01-01T00:00:00.000Z",
    type: "control_command",
    data: {},
    ...over,
  };
}

function makeApi(options: { events?: AuditEventView[]; error?: ApiError }): {
  client: ApiClient;
  get: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn(async (path: string) => {
    if (path === "/audit") {
      if (options.error) throw options.error;
      const items = options.events ?? [];
      return {
        data: { items, total: items.length, nextCursor: null },
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

describe("AgentAuditSummary", () => {
  it("shows governance-relevant events (control_command / approval_requested / permission_decision)", async () => {
    const events = [
      ev({
        id: "e1",
        type: "control_command",
        actor: "admin-1",
        outcome: "executed",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    ];
    const { client } = makeApi({ events });
    renderWithProviders(<AgentAuditSummary agentId="a1" />, {
      apiClient: client,
    });
    expect(await screen.findByText("Control Command")).toBeInTheDocument();
    expect(screen.getByText("by admin-1")).toBeInTheDocument();
  });

  it("filters out execution-shaped events — those belong to Recent Executions, not this summary", async () => {
    const events = [
      ev({ id: "e1", type: "task_completed" }),
      ev({ id: "e2", type: "agent_executed" }),
    ];
    const { client } = makeApi({ events });
    renderWithProviders(<AgentAuditSummary agentId="a1" />, {
      apiClient: client,
    });
    expect(
      await screen.findByText("No governance activity yet"),
    ).toBeInTheDocument();
  });

  it("links to the global Audit Log, not a duplicate implementation", async () => {
    const { client } = makeApi({ events: [] });
    renderWithProviders(<AgentAuditSummary agentId="a1" />, {
      apiClient: client,
    });
    expect(
      await screen.findByRole("link", { name: "Open Audit Log" }),
    ).toHaveAttribute("href", "/audit");
  });

  it("fails locally (only this section) on an audit error, with a working Retry", async () => {
    const { client, get } = makeApi({
      error: new ApiError({ kind: "server_error", message: "boom" }),
    });
    renderWithProviders(<AgentAuditSummary agentId="a1" />, {
      apiClient: client,
    });
    expect(
      await screen.findByText("Audit activity unavailable"),
    ).toBeInTheDocument();
    const before = get.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before));
  });
});
