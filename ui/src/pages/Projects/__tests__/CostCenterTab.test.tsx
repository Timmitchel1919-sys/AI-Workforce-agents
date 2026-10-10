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
  cost?: unknown;
  findings?: unknown;
  governance?: unknown;
}

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockApi(api: Api = {}) {
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      if (url === "/api/projects/alpha") return respond(200, PROJECT);
      if (url === "/api/projects/alpha/cost") return respond(200, api.cost ?? { configured: false });
      if (url === "/api/projects/alpha/audit-findings") return respond(200, api.findings ?? { configured: false });
      if (url === "/api/projects/alpha/governance-policy") return respond(200, api.governance ?? { configured: false });
      return respond(404, { error: { message: "not found" } });
    }),
  );
  return calls;
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
                <Route path="/projects/:projectId/cost" element={<ProjectDetailPage />} />
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

describe("Cost Center + Auditor Findings tab (EO-6.2/6.3, read-only)", () => {
  it("shows honest not-configured states — never $0 or an unlimited budget, no write form", async () => {
    mockApi();
    renderPage("/projects/alpha/cost");
    expect(await screen.findByText("The AI Cost Center is not configured for this deployment.")).toBeInTheDocument();
    expect(screen.getByText("The Auditor is not configured for this deployment.")).toBeInTheDocument();
    expect(screen.getByText("Governance policy is not configured for this deployment.")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(screen.queryByText(/unlimited/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /save|set budget|set policy/i })).toBeNull();
    expect(screen.getByRole("link", { name: "Cost Center" })).toHaveAttribute("aria-current", "page");
  });

  it("shows budget status as text, never colour-only, and 'no budget configured' for not_configured", async () => {
    mockApi({
      cost: {
        configured: true,
        budgetPolicy: null,
        evaluation: { status: "not_configured", currency: "USD", detail: "no budget policy is configured for this project" },
        usage: [],
        capabilities: { enforcement: false, providerIds: [] },
      },
    });
    renderPage("/projects/alpha/cost");
    expect(await screen.findByText("No budget configured")).toBeInTheDocument();
    expect(screen.getByText("no budget policy is configured for this project")).toBeInTheDocument();
    expect(screen.getByText("No usage has been recorded for this project yet.")).toBeInTheDocument();
  });

  it("never shows $0.00 for unpriced usage — shows 'cost unknown' instead", async () => {
    mockApi({
      cost: {
        configured: true,
        budgetPolicy: null,
        evaluation: { status: "ok", currency: "USD", detail: "within all configured limits" },
        usage: [
          { usageId: "u1", projectId: "alpha", provider: "anthropic", model: "claude-sonnet-5", cost: { priced: true, amountUsd: 0.0042, pricingVersion: "2026-09-27" }, createdAt: "2026-09-27T10:00:00.000Z" },
          { usageId: "u2", projectId: "alpha", provider: "custom", model: "unlisted-model", cost: { priced: false, reason: 'no price entry for model "unlisted-model"' }, createdAt: "2026-09-27T10:01:00.000Z" },
        ],
        capabilities: { enforcement: true, providerIds: ["anthropic"] },
      },
    });
    renderPage("/projects/alpha/cost");
    const table = await screen.findByRole("table");
    expect(within(table).getByText("cost unknown")).toBeInTheDocument();
    expect(within(table).getByText("$0.0042")).toBeInTheDocument();
    expect(within(table).queryByText("$0.00")).toBeNull();
    expect(screen.getByText("Enforced by 1 registered model provider(s).")).toBeInTheDocument();
  });

  it("shows an honest inert notice when no model provider is registered, without hiding the panel", async () => {
    mockApi({
      cost: {
        configured: true,
        budgetPolicy: { projectId: "alpha", warningThresholdPercent: 80, hardStop: true, updatedAt: "2026-09-01T00:00:00.000Z", updatedBy: "admin" },
        evaluation: { status: "ok", currency: "USD", detail: "within all configured limits" },
        usage: [],
        capabilities: { enforcement: false, providerIds: [] },
      },
    });
    renderPage("/projects/alpha/cost");
    expect(await screen.findByText("No model provider is registered; nothing is being charged or enforced yet.")).toBeInTheDocument();
    expect(screen.getAllByText("No limit set")).toHaveLength(3); // dailyLimitUsd/monthlyLimitUsd/taskLimitUsd all absent
    expect(screen.getByText("Budget policy")).toBeInTheDocument();
  });

  it("frames an empty findings list positively when rules ran and found nothing", async () => {
    mockApi({ findings: { configured: true, projectId: "alpha", generatedAt: "2026-09-27T12:00:00.000Z", rulesRun: ["release_without_verification", "usage_unpriced"], findings: [] } });
    renderPage("/projects/alpha/cost");
    expect(await screen.findByText("The Auditor ran 2 check(s) and found nothing to flag.")).toBeInTheDocument();
  });

  it("lists findings with severity as text, the rule id, and the detail", async () => {
    mockApi({
      findings: {
        configured: true,
        projectId: "alpha",
        generatedAt: "2026-09-27T12:00:00.000Z",
        rulesRun: ["release_without_approval"],
        findings: [
          { findingId: "f1", projectId: "alpha", ruleId: "release_without_approval", severity: "critical", subjectType: "release", subjectId: "rel_1", detail: "Release rel_1 shipped without a recorded approval.", createdAt: "2026-09-27T11:00:00.000Z" },
        ],
      },
    });
    renderPage("/projects/alpha/cost");
    expect(await screen.findByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("release_without_approval", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Release rel_1 shipped without a recorded approval.")).toBeInTheDocument();
  });

  it("shows the governance policy read-only when configured", async () => {
    mockApi({
      governance: {
        configured: true,
        policy: { projectId: "alpha", allowedProviders: ["anthropic"], allowUnknownCost: false, requireApprovalAboveUsd: 5, updatedAt: "2026-09-01T00:00:00.000Z", updatedBy: "admin" },
      },
    });
    renderPage("/projects/alpha/cost");
    expect(await screen.findByText("anthropic")).toBeInTheDocument();
    expect(screen.getByText("$5.00")).toBeInTheDocument();
    expect(screen.getByText("Any (not restricted)")).toBeInTheDocument(); // allowedModels absent
    expect(screen.queryByRole("button", { name: /save|edit policy/i })).toBeNull();
  });

  it.each([
    ["dark", "en", "Cost Center"],
    ["dark", "nl", "Kostencentrum"],
    ["light", "en", "Cost Center"],
    ["light", "nl", "Kostencentrum"],
  ] as const)("renders in %s theme + %s language", async (theme, language, heading) => {
    window.localStorage.setItem("aiw.theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
    mockApi();
    renderPage("/projects/alpha/cost", language);
    expect(await screen.findByRole("link", { name: heading })).toBeInTheDocument();
  });
});
