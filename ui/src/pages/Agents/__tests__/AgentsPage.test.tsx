import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../test/renderWithProviders";
import type { ApiClient } from "../../../api";
import { ApiError } from "../../../api";
import type { AgentView } from "../../../api/contracts";
import { AgentsPage } from "../AgentsPage";

function mkAgent(over: Partial<AgentView> = {}): AgentView {
  return {
    agentId: "a1",
    name: "Research Agent",
    role: "research",
    capabilities: ["web_search"],
    status: "available",
    enabled: true,
    allowedProjects: ["money-mind"],
    lastActivityAt: "2026-09-01T10:00:00.000Z",
    stats: {
      taskCount: 4,
      completed: 3,
      failed: 1,
      cancelled: 0,
      successRate: 0.75,
    },
    ...over,
  };
}

function makeApi(agentsOrError: AgentView[] | ApiError): {
  client: ApiClient;
  get: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn(async (path: string) => {
    if (path === "/agents") {
      if (agentsOrError instanceof ApiError) throw agentsOrError;
      return { data: agentsOrError, status: 200, correlationId: "t" };
    }
    if (path === "/audit") {
      return {
        data: { items: [], total: 0, nextCursor: null },
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

const TWO = [
  mkAgent({ agentId: "a1", name: "Research Agent", status: "available" }),
  mkAgent({
    agentId: "a2",
    name: "Finance Agent",
    role: "finance",
    status: "failed",
    capabilities: ["ledger"],
  }),
];

describe("AgentsPage", () => {
  it("shows a structured loading state first", () => {
    const { client } = makeApi(TWO);
    renderWithProviders(<AgentsPage />, {
      route: "/agents",
      apiClient: client,
    });
    expect(screen.getByText(/loading the agent registry/i)).toBeInTheDocument();
  });

  it("renders the registry and a data-derived summary when ready", async () => {
    const { client } = makeApi(TWO);
    renderWithProviders(<AgentsPage />, {
      route: "/agents",
      apiClient: client,
    });

    expect(
      await screen.findByRole("link", { name: "Research Agent" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Finance Agent" }),
    ).toBeInTheDocument();

    // summary derived from the two agents (1 available, 1 failed → attention)
    const total = screen.getByText("Total agents").closest(".ui-metric");
    expect(total).toHaveTextContent("2");
    const attention = screen.getByText("Needs attention").closest(".ui-metric");
    expect(attention).toHaveTextContent("1");

    // heading is exactly "Agents" (shell/route contract)
    expect(
      screen.getByRole("heading", { name: /^Agents$/ }),
    ).toBeInTheDocument();
  });

  it("shows the 'no agents' empty state for an empty registry", async () => {
    const { client } = makeApi([]);
    renderWithProviders(<AgentsPage />, {
      route: "/agents",
      apiClient: client,
    });
    expect(await screen.findByText("No agents found")).toBeInTheDocument();
  });

  it("client-side search narrows the registry, with a filtered empty state", async () => {
    const { client } = makeApi(TWO);
    renderWithProviders(<AgentsPage />, {
      route: "/agents",
      apiClient: client,
    });
    await screen.findByRole("link", { name: "Research Agent" });

    const search = screen.getByLabelText("Search agents");
    await userEvent.type(search, "finance");
    expect(
      screen.getByRole("link", { name: "Finance Agent" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Research Agent" }),
    ).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, "nothing-matches");
    expect(
      await screen.findByText("No agents match these filters"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Clear filters" }),
    );
    expect(
      await screen.findByRole("link", { name: "Research Agent" }),
    ).toBeInTheDocument();
  });

  it("status filter uses real operational statuses", async () => {
    const { client } = makeApi(TWO);
    renderWithProviders(<AgentsPage />, {
      route: "/agents",
      apiClient: client,
    });
    await screen.findByRole("link", { name: "Research Agent" });

    await userEvent.selectOptions(screen.getByLabelText("Status"), "failed");
    expect(
      screen.getByRole("link", { name: "Finance Agent" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Research Agent" }),
    ).not.toBeInTheDocument();
  });

  it("refresh triggers a refetch via the query", async () => {
    const { client, get } = makeApi(TWO);
    renderWithProviders(<AgentsPage />, {
      route: "/agents",
      apiClient: client,
    });
    await screen.findByRole("link", { name: "Research Agent" });

    const before = get.mock.calls.filter((c) => c[0] === "/agents").length;
    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() =>
      expect(
        get.mock.calls.filter((c) => c[0] === "/agents").length,
      ).toBeGreaterThan(before),
    );
  });

  it("renders a safe error state with a retry that refetches", async () => {
    const { client, get } = makeApi(
      new ApiError({
        kind: "network",
        message: "boom",
        correlationId: "cid-1",
      }),
    );
    renderWithProviders(<AgentsPage />, {
      route: "/agents",
      apiClient: client,
    });

    expect(
      await screen.findByText("Unable to load agents"),
    ).toBeInTheDocument();
    // no raw exception text
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();

    const before = get.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before));
  });

  it("renders an access-restricted state on 403", async () => {
    const { client } = makeApi(
      new ApiError({ kind: "forbidden", message: "no", status: 403 }),
    );
    renderWithProviders(<AgentsPage />, {
      route: "/agents",
      apiClient: client,
    });
    expect(
      await screen.findByText(/don't have access to the agent registry/i),
    ).toBeInTheDocument();
  });

  it("exposes the registry as a table when the viewport supports it", async () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    const { client } = makeApi(TWO);
    renderWithProviders(<AgentsPage />, {
      route: "/agents",
      apiClient: client,
    });

    const table = await screen.findByRole("table", { name: /agent registry/i });
    expect(
      within(table).getByRole("columnheader", { name: /Agent/ }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: /Status/ }),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
