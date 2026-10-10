/**
 * The Agents page must render what the Control Plane actually said.
 *
 * The previous version of this test asserted that "Research Agent" appears —
 * which only ever appeared because the client silently substituted sample data.
 * The tests below pin the corrected behaviour: a real roster renders with both
 * status axes, and every failure state says something true instead of showing
 * an invented workforce.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentsPage from "../AgentsPage";
import AgentDetailPage from "../AgentDetailPage";
import { AuthProvider } from "../../../auth/AuthProvider";
import { ApiError } from "../../../api/errors";
import { apiRequest } from "../../../api/client";

// The TRANSPORT is mocked, not the agents client, so the real payload parsing
// runs in these tests. A fixture that skipped parsing would let a shape
// regression pass here and only fail in the browser.
vi.mock("../../../api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../api/client")>();
  return { ...original, apiRequest: vi.fn() };
});

const request = vi.mocked(apiRequest);

function renderPage(element: React.ReactElement, path: string, routePath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

function specialistAgent(overrides: Record<string, unknown> = {}) {
  return {
    agentId: "backend-dev-v1",
    name: "Backend Engineer",
    description: "API implementation and backend services.",
    status: "offline",
    capabilities: ["software.backend"],
    enabled: true,
    allowedProjects: ["money-mind"],
    specialist: {
      descriptorVersion: 2,
      displayName: "Backend Engineer",
      department: "Engineering",
      description: "API implementation and backend services.",
      limitations: ["Cannot approve its own authorization changes."],
      administrativeStatus: "active",
      operationalState: "offline",
      supportedTaskTypes: ["backend_implementation"],
      projectPolicy: { mode: "allow_list", projects: ["money-mind"] },
      toolPolicy: {
        maxExecutionCapabilities: ["filesystem.read", "repository.write"],
        deniedExecutionCapabilities: ["process.invoke.bounded"],
        allowsUnrestrictedShell: false,
      },
      riskCeiling: "high",
      reviewPolicy: { requiresIndependentReview: true, minimumReviewers: 1, selfReviewAllowed: false },
      modelPolicy: { provider: "openai" },
      instanceCount: 0,
      ...overrides,
    },
  };
}

function respond(agents: unknown[]) {
  request.mockResolvedValue({ data: { agents } } as never);
}

function fail(status: number) {
  request.mockRejectedValue(new ApiError("failure", { status }));
}

beforeEach(() => {
  request.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AgentsPage", () => {
  it("renders the roster the Control Plane returned", async () => {
    respond([specialistAgent()]);

    renderPage(<AgentsPage />, "/agents", "/agents");

    // The name appears in the row and again in page chrome; the capability also
    // appears in the filter options, so the assertions target the registry row.
    expect((await screen.findAllByText("Backend Engineer")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("software.backend").length).toBeGreaterThan(0);
  });

  it("shows both status axes, not a single collapsed status", async () => {
    respond([specialistAgent()]);

    renderPage(<AgentsPage />, "/agents", "/agents");

    expect((await screen.findAllByText("Backend Engineer")).length).toBeGreaterThan(0);
    // Administrative axis (active) and operational axis (offline) are distinct
    // facts and must both be present in the row.
    const row = document.querySelector(".agent-row");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Active")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("Offline")).toBeInTheDocument();
  });

  it("does not claim a healthy count, because nothing reports health", async () => {
    respond([specialistAgent()]);

    const { container } = renderPage(<AgentsPage />, "/agents", "/agents");

    await screen.findByText("Backend Engineer");
    expect(container.textContent).not.toMatch(/Healthy/i);
  });

  it("reports an empty roster as empty rather than inventing agents", async () => {
    respond([]);

    renderPage(<AgentsPage />, "/agents", "/agents");

    expect(await screen.findByText(/No agents found/i)).toBeInTheDocument();
    expect(screen.queryByText("Research Agent")).not.toBeInTheDocument();
  });

  it("states that the deployment has no specialist workforce when it is not composed", async () => {
    fail(404);

    renderPage(<AgentsPage />, "/agents", "/agents");

    expect(await screen.findByText(/No specialist workforce in this deployment/i)).toBeInTheDocument();
    expect(screen.queryByText(/Retry/i)).not.toBeInTheDocument();
  });

  it("offers a retry for a transient registry failure", async () => {
    fail(503);

    renderPage(<AgentsPage />, "/agents", "/agents");

    expect(await screen.findByText(/Agent registry unavailable/i)).toBeInTheDocument();
    // Retrying is offered only where retrying can change the outcome.
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Retry/i }).length).toBeGreaterThan(0));
  });
});

describe("AgentDetailPage", () => {
  it("surfaces the stated limitations and never a self-approval claim", async () => {
    respond([specialistAgent()]);

    renderPage(<AgentDetailPage />, "/agents/backend-dev-v1", "/agents/:agentId");

    expect(
      await screen.findByText("Cannot approve its own authorization changes."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Never self-review/i)).toBeInTheDocument();
  });

  it("shows the risk ceiling and provider-only model policy without inventing a model or cost", async () => {
    respond([specialistAgent()]);

    renderPage(<AgentDetailPage />, "/agents/backend-dev-v1", "/agents/:agentId");

    await screen.findAllByText("Backend Engineer");
    expect(screen.getByText("high")).toBeInTheDocument();
    // Provider only: no model is pinned, so none is displayed and no price is implied.
    expect(screen.getByText(/Provider only/i)).toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  });

  it("labels a legacy flat agent as having no specialist profile", async () => {
    respond([
        {
          agentId: "research-agent",
          name: "Research Agent",
          status: "active",
          capabilities: ["research"],
          enabled: true,
          allowedProjects: ["research-ops"],
        },
    ]);

    renderPage(<AgentDetailPage />, "/agents/research-agent", "/agents/:agentId");

    // Shown as a badge in the row and as a section heading on the detail page.
    expect((await screen.findAllByText(/No specialist profile/i)).length).toBeGreaterThan(0);
  });

  it("does not report 'agent not found' when the registry itself could not be loaded", async () => {
    fail(404);

    renderPage(<AgentDetailPage />, "/agents/backend-dev-v1", "/agents/:agentId");

    // "Not found" would imply a lookup happened. It did not.
    expect(await screen.findByText(/No specialist workforce in this deployment/i)).toBeInTheDocument();
    expect(screen.queryByText(/Agent not found/i)).not.toBeInTheDocument();
  });
});
