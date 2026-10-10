import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AccessState, AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import ProjectDetailPage from "../ProjectDetailPage";

const PROJECT = { projectId: "alpha", displayName: "Alpha Portal", status: "available", adapterStatus: "healthy", capabilities: [], connectedAgents: [], activeWorkflows: 0 };
const OPERATOR = ["view", "cancel_execution", "prepare_execution"];

interface Api {
  list?: unknown;
  decisions?: Record<string, unknown>;
}

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockApi(api: Api = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      void init;
      if (url === "/api/projects/alpha") return respond(200, PROJECT);
      if (url === "/api/projects/alpha/routing-decisions") return respond(200, api.list ?? { configured: false });
      const decisionMatch = url.match(/^\/api\/projects\/alpha\/routing-decisions\/(.+)$/);
      if (decisionMatch) {
        const id = decisionMatch[1]!;
        const body = api.decisions?.[id];
        if (!body) return respond(404, { error: { message: "not found" } });
        return respond(200, body);
      }
      return respond(404, { error: { message: "not found" } });
    }),
  );
}

function authValue(): AuthContextValue {
  return {
    user: { id: "u1", email: "op@example.test", displayName: "Op" },
    loading: false,
    accessToken: "token",
    configured: true,
    access: "granted" as AccessState,
    accessDetails: { role: "operator", capabilities: OPERATOR },
    signIn: vi.fn(),
    signUp: vi.fn(),
    sendPasswordReset: vi.fn(),
    refreshAccess: vi.fn(),
    getPasswordPolicy: vi.fn(),
    signOut: vi.fn(),
  };
}

function renderPage(path: string, language: Language = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage={language}>
        <authContext.Provider value={authValue()}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
                <Route path="/projects/:projectId/model-routing" element={<ProjectDetailPage />} />
                <Route path="/projects/:projectId/model-routing/:routingDecisionId" element={<ProjectDetailPage />} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </authContext.Provider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("Model Routing tab (EO-7, read-only)", () => {
  it("shows an honest not-configured state — no write form", async () => {
    mockApi();
    renderPage("/projects/alpha/model-routing");
    expect(await screen.findByText("The Model Router is not configured for this deployment.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /override|save/i })).toBeNull();
    expect(screen.getByRole("link", { name: "Model Routing" })).toHaveAttribute("aria-current", "page");
  });

  it("shows a neutral empty state when configured but nothing has been routed yet", async () => {
    mockApi({ list: { configured: true, decisions: [] } });
    renderPage("/projects/alpha/model-routing");
    expect(await screen.findByText("No routing decisions have been recorded for this project yet.")).toBeInTheDocument();
  });

  it("lists a decision row: agent, whether a model was selected, and why not — as text, never colour-only", async () => {
    mockApi({
      list: {
        configured: true,
        decisions: [
          {
            routingDecisionId: "dec-1",
            projectId: "alpha",
            agentId: "agent-1",
            requirements: { requiredCapabilities: ["reasoning"] },
            candidateModels: [],
            rejectedCandidates: [],
            reasonCodes: ["MODEL_UNAVAILABLE", "BUDGET_EXCEEDED"],
            fallbackPolicy: "none",
            fallbackUsed: false,
            createdAt: "2026-09-27T10:00:00.000Z",
          },
        ],
      },
    });
    renderPage("/projects/alpha/model-routing");
    const table = await screen.findByRole("table");
    expect(within(table).getByText("No model selected")).toBeInTheDocument();
    expect(within(table).getByText("Model unavailable")).toBeInTheDocument();
    expect(within(table).getByText("Budget exceeded")).toBeInTheDocument();
    expect(within(table).getByText("agent-1")).toBeInTheDocument();
  });

  it("shows the full inspector for a decision — candidates, rejected candidates, policy and cost never fabricated", async () => {
    mockApi({
      list: {
        configured: true,
        decisions: [
          {
            routingDecisionId: "dec-2",
            projectId: "alpha",
            agentId: "agent-2",
            requirements: { requiredCapabilities: ["coding"] },
            candidateModels: [{ profileId: "p1", providerId: "anthropic", model: "claude-sonnet-5", status: "available" }],
            rejectedCandidates: [{ profileId: "p2", providerId: "openai", model: "gpt-x", reasonCode: "CONTEXT_REQUIREMENT_NOT_MET", detail: "context window too small" }],
            selectedProvider: "anthropic",
            selectedModel: "claude-sonnet-5",
            reasonCodes: [],
            costEstimate: { priced: false, reason: 'no price entry for model "claude-sonnet-5"' },
            policyDecision: { decision: "approved", detail: "within allowed providers" },
            fallbackPolicy: "governed",
            fallbackUsed: true,
            fallbackOf: "dec-1",
            createdAt: "2026-09-27T10:05:00.000Z",
          },
        ],
      },
      decisions: {
        "dec-2": {
          configured: true,
          decision: {
            routingDecisionId: "dec-2",
            projectId: "alpha",
            agentId: "agent-2",
            requirements: { requiredCapabilities: ["coding"] },
            candidateModels: [{ profileId: "p1", providerId: "anthropic", model: "claude-sonnet-5", status: "available" }],
            rejectedCandidates: [{ profileId: "p2", providerId: "openai", model: "gpt-x", reasonCode: "CONTEXT_REQUIREMENT_NOT_MET", detail: "context window too small" }],
            selectedProvider: "anthropic",
            selectedModel: "claude-sonnet-5",
            reasonCodes: [],
            costEstimate: { priced: false, reason: 'no price entry for model "claude-sonnet-5"' },
            policyDecision: { decision: "approved", detail: "within allowed providers" },
            fallbackPolicy: "governed",
            fallbackUsed: true,
            fallbackOf: "dec-1",
            createdAt: "2026-09-27T10:05:00.000Z",
          },
        },
      },
    });
    renderPage("/projects/alpha/model-routing/dec-2");

    expect(await screen.findByText("Context requirement not met", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("context window too small")).toBeInTheDocument();
    expect(screen.getByText("cost unknown")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("Yes — this decision is a fallback")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View original decision" })).toHaveAttribute("href", "/projects/alpha/model-routing/dec-1");
  });

  it("shows an honest 'not found' state for a decision that does not exist", async () => {
    mockApi({ list: { configured: true, decisions: [] } });
    renderPage("/projects/alpha/model-routing/missing");
    expect(await screen.findByText("This routing decision does not exist, or you do not have access to it.")).toBeInTheDocument();
  });

  it.each([
    ["dark", "en", "Model Routing"],
    ["dark", "nl", "Modelroutering"],
    ["light", "en", "Model Routing"],
    ["light", "nl", "Modelroutering"],
  ] as const)("renders in %s theme + %s language", async (theme, language, heading) => {
    window.localStorage.setItem("aiw.theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
    mockApi();
    renderPage("/projects/alpha/model-routing", language);
    expect(await screen.findByRole("link", { name: heading })).toBeInTheDocument();
  });
});
