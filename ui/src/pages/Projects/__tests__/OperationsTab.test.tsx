import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
const ADMIN = [...OPERATOR, "kill_execution"];
const VIEWER = ["view"];
const SECRET = "sk-live-abcdefghijklmnop1234";

const SESSION = {
  sessionId: "exs_1",
  projectId: "alpha",
  plan: { planId: "plan-1", version: 2, executionPlanId: "plan-1@v2" },
  stageId: "build:web",
  stageKind: "build",
  operationId: "node.build",
  status: "running",
  agentId: "web-agent",
  environmentInstanceId: "web-1",
  runner: { providerId: "workspace-build-runner", kind: "local_restricted_process" },
  workspaceId: "ews_1",
  approvalIds: [],
  reasonCodes: [],
  attempts: 1,
  createdAt: "2026-09-24T10:00:00.000Z",
  startedAt: "2026-09-24T10:00:01.000Z",
};

function detail(overrides: Record<string, unknown> = {}) {
  return {
    session: { ...SESSION, reasons: [], risk: "medium", policy: { policyId: "p", version: 1 }, workspace: { workspaceId: "ews_1", mode: "read_write", status: "prepared" }, grants: [] },
    agent: { agentId: "web-agent", name: "Marcus", capabilities: ["web_development"], enabled: true },
    model: { provider: "openai", model: "gpt-model" },
    environment: { environmentInstanceId: "web-1", name: "web-1", environmentType: "web_build", availability: "available", toolchains: [{ kind: "node", version: "20.11.1" }] },
    changeSet: { changeSetId: "chg_1", status: "verified", baseRevision: "a".repeat(40), baselineCount: 0, entries: [{ path: "src/a.ts", change: "created", risk: "normal", sizeDelta: 10 }], updatedAt: "2026-09-24T10:01:00.000Z" },
    verifications: [
      { verificationId: "vrf_1", projectId: "alpha", plan: { planId: "plan-1", version: 2 }, sourceSessionId: "exs_1", changeSetId: "chg_1", sourceFingerprint: "f", status: "passed", stages: [{ stageId: "build:web", stageKind: "build", required: true, status: "passed", attempts: 1, artifactIds: [], log: { text: `built ok ${SECRET}`, truncated: false } }], reasons: [], unverifiedStageIds: [], isolation: { filesystem: false, network: false }, createdAt: "2026-09-24T10:02:00.000Z", sourceCurrent: false },
    ],
    receipts: [],
    timeline: {
      items: [
        { id: "ev1", timestamp: "2026-09-24T10:00:00.000Z", action: "session_created", actor: "op-1", data: { stageId: "build:web" } },
        { id: "ev2", timestamp: "2026-09-24T10:00:02.000Z", action: "operation_started", data: { note: `token ${SECRET}` } },
      ],
      total: 2,
      limit: 50,
      offset: 0,
    },
    ...overrides,
  };
}

interface Api {
  sessions?: unknown[];
  detail?: unknown;
  releases?: unknown;
  verifications?: unknown;
  commandStatus?: number;
  commandBody?: unknown;
}

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockApi(api: Api = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (method === "POST") return respond(api.commandStatus ?? 200, api.commandBody ?? { outcome: "executed", details: { outcome: "cancelled" } });
      if (url === "/api/projects/alpha") return respond(200, PROJECT);
      if (url.startsWith("/api/projects/alpha/execution-overview")) {
        return respond(200, { projectId: "alpha", sessions: { total: (api.sessions ?? []).length, byStatus: {}, awaitingApproval: 0 }, verifications: { configured: false }, releases: { configured: false } });
      }
      if (url.startsWith("/api/projects/alpha/executions/")) return respond(200, api.detail ?? detail());
      if (url.startsWith("/api/projects/alpha/executions")) {
        const items = api.sessions ?? [];
        return respond(200, { items, total: items.length, limit: 25, offset: 0 });
      }
      if (url.startsWith("/api/projects/alpha/verifications")) return respond(200, api.verifications ?? { configured: false, items: [] });
      if (url.startsWith("/api/projects/alpha/releases")) return respond(200, api.releases ?? { sourceControl: { configured: false }, deployments: { configured: false } });
      if (url === "/api/execution/environments") {
        return respond(200, { configured: true, families: [{ family: "macos", adapters: [{ adapterId: "macos-xcode", version: "1.0.0" }], status: "not_configured", realRunners: 0, simulatedRunners: 0 }] });
      }
      return respond(404, { error: { message: "not found" } });
    }),
  );
  return calls;
}

function authValue(capabilities: readonly string[]): AuthContextValue {
  return {
    user: { id: "u1", email: "op@example.test", displayName: "Op" },
    loading: false,
    accessToken: "token",
    configured: true,
    access: "granted" as AccessState,
    accessDetails: { role: "operator", capabilities },
    signIn: vi.fn(),
    signUp: vi.fn(),
    sendPasswordReset: vi.fn(),
    refreshAccess: vi.fn(),
    getPasswordPolicy: vi.fn(),
    signOut: vi.fn(),
  };
}

function renderPage(path: string, capabilities: readonly string[] = OPERATOR, language: Language = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage={language}>
        <authContext.Provider value={authValue(capabilities)}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
                <Route path="/projects/:projectId/operations" element={<ProjectDetailPage />} />
                <Route path="/projects/:projectId/operations/:sessionId" element={<ProjectDetailPage />} />
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

describe("Execution Control Center (EO-4.7)", () => {
  it("shows honest empty/not-configured states and never offers a generic execute control", async () => {
    const calls = mockApi();
    renderPage("/projects/alpha/operations");
    expect(await screen.findByText("No execution sessions yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Operations" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText("macos")).toBeInTheDocument();
    expect(screen.getAllByText("Not configured").length).toBeGreaterThan(0);
    expect(await screen.findByText("Governed source control is not configured for this project.")).toBeInTheDocument();
    expect(screen.getByText("No deployment targets are configured for this project.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /execute|run|deploy/i })).toBeNull();
    // Only same-origin Control Plane calls; bounded session page.
    expect(calls.every((c) => c.url.startsWith("/api/"))).toBe(true);
    expect(calls.some((c) => /executions\?.*limit=25/.test(c.url))).toBe(true);
  });

  it("lists sessions with status text and links to the session detail", async () => {
    mockApi({ sessions: [SESSION, { ...SESSION, sessionId: "exs_2", status: "failed" }] });
    renderPage("/projects/alpha/operations");
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Running")).toBeInTheDocument();
    expect(within(table).getByText("Failed")).toBeInTheDocument();
    expect(within(table).getByRole("link", { name: "exs_1" })).toHaveAttribute("href", "/projects/alpha/operations/exs_1");
  });

  it("session detail separates agent/model/environment, shows stale verification, redacts secrets and shows only real events", async () => {
    mockApi();
    const { container } = renderPage("/projects/alpha/operations/exs_1");
    expect(await screen.findByRole("heading", { name: /Session exs_1/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agent" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Model" })).toBeInTheDocument();
    expect(screen.getByText("Marcus (web-agent)")).toBeInTheDocument();
    expect(screen.getByText("gpt-model")).toBeInTheDocument();
    expect(screen.getByText(/Working ChangeSet — a ChangeSet is not a commit/)).toBeInTheDocument();
    expect(screen.getAllByText(/Reverification required/).length).toBeGreaterThan(0);
    expect(screen.getByText("session_created")).toBeInTheDocument();
    expect(screen.queryByText("operation_completed")).toBeNull();
    expect(container.textContent).not.toContain(SECRET);
    // Source control not configured → commit/push/deploy steps are not applicable, never "completed".
    const pipeline = screen.getByRole("heading", { name: "Execution pipeline" }).parentElement!;
    expect(within(pipeline).getAllByText("Not applicable").length).toBe(6);
  });

  it("cancel requires a reason, calls the typed command and re-reads state; 409 is reported as a conflict", async () => {
    const calls = mockApi({ commandStatus: 409, commandBody: { error: { message: "changed" } } });
    const user = userEvent.setup();
    renderPage("/projects/alpha/operations/exs_1");
    await user.click(await screen.findByRole("button", { name: "Cancel this session" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Cancel session" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox"), "no longer needed");
    await user.click(confirm);
    expect(await screen.findByText("The session changed meanwhile — showing its current state.")).toBeInTheDocument();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/commands/cancel-execution");
    expect(post.body).toEqual({ sessionId: "exs_1", reason: "no longer needed" });
    expect(screen.queryByRole("button", { name: "Emergency stop this session" })).toBeNull();
  });

  it("role-based controls: viewers are view-only; administrators also get a scoped emergency stop; ended sessions offer nothing", async () => {
    mockApi();
    const viewer = renderPage("/projects/alpha/operations/exs_1", VIEWER);
    expect(await screen.findByText("You can view this session but not control it.")).toBeInTheDocument();
    viewer.unmount();
    mockApi();
    const admin = renderPage("/projects/alpha/operations/exs_1", ADMIN);
    expect(await screen.findByRole("button", { name: "Emergency stop this session" })).toBeInTheDocument();
    admin.unmount();
    mockApi({ detail: detail({ session: { ...detail().session, status: "succeeded" } }) });
    renderPage("/projects/alpha/operations/exs_1", ADMIN);
    expect(await screen.findByText("This session has ended; there is nothing to cancel.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancel this session|Emergency stop/ })).toBeNull();
  });

  it("PUSHED is not DEPLOYED; DEGRADED is never shown as healthy; production is labelled in text", async () => {
    const commitSha = "c".repeat(40);
    const releases = {
      sourceControl: {
        configured: true,
        reviews: [{ reviewId: "rev_1", status: "approved", reviewerId: "review-agent", reviewerKind: "agent", changeSetId: "chg_1", createdAt: "2026-09-24T10:03:00.000Z" }],
        stageSets: [],
        commits: [{ receiptId: "cmr_1", commitSha, branch: "main", changeSetId: "chg_1", message: "feat: x", createdAt: "2026-09-24T10:04:00.000Z" }],
        pushes: [{ receiptId: "psr_1", commitSha, branch: "main", result: "pushed", pullRequestRequired: false, createdAt: "2026-09-24T10:05:00.000Z" }],
        pullRequests: [],
      },
      deployments: { configured: true, releases: [], targets: [] },
    };
    mockApi({ releases, detail: detail({ verifications: [{ ...detail().verifications[0], sourceCurrent: true }] }) });
    renderPage("/projects/alpha/operations/exs_1");
    const pipeline = (await screen.findByRole("heading", { name: "Execution pipeline" })).parentElement!;
    const step = (name: string) => within(pipeline).getByText(name).parentElement!;
    expect(await within(step("Push")).findByText("Completed")).toBeInTheDocument();
    expect(within(step("Deploy")).getByText("Pending")).toBeInTheDocument();
    expect(within(step("Verify release")).getByText("Pending")).toBeInTheDocument();

    mockApi({
      releases: {
        ...releases,
        deployments: {
          configured: true,
          targets: [],
          releases: [{ releaseId: "rel_1", candidateId: "dcn_1", commitSha, targetId: "alpha-prod", targetClass: "production", adapterId: "x", status: "degraded", reasons: [], simulated: true, startedAt: "2026-09-24T10:06:00.000Z" }],
        },
      },
    });
    renderPage("/projects/alpha/operations");
    expect(await screen.findByText("PRODUCTION")).toBeInTheDocument();
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.queryByText(/Healthy/)).toBeNull();
  });

  it("shows recovery states honestly: partial deployment and failed rollback are never shown as healthy", async () => {
    const commitSha = "d".repeat(40);
    const release = (over: Record<string, unknown>) => ({
      candidateId: "dcn_1",
      commitSha,
      targetId: "alpha-preview",
      targetClass: "preview",
      adapterId: "x",
      reasons: [],
      simulated: true,
      startedAt: "2026-09-24T10:06:00.000Z",
      ...over,
    });
    mockApi({
      releases: {
        sourceControl: { configured: false },
        deployments: {
          configured: true,
          targets: [],
          releases: [
            release({ releaseId: "rel_partial", status: "failed", resources: { completed: ["hosting"], failed: ["functions"] } }),
            release({ releaseId: "rel_rb", status: "degraded", reasons: [{ code: "ROLLBACK_FAILED", detail: "x" }] }),
          ],
        },
      },
    });
    renderPage("/projects/alpha/operations");
    expect(await screen.findByText(/Partial deployment — failed: functions/)).toBeInTheDocument();
    expect(screen.getByText("Rollback failed — the target was NOT restored.")).toBeInTheDocument();
    expect(screen.queryByText(/Healthy/)).toBeNull();
    expect(screen.queryByText(/Rolled back/)).toBeNull();
  });

  it.each([
    ["dark", "en", "Execution sessions"],
    ["dark", "nl", "Uitvoeringssessies"],
    ["light", "en", "Execution sessions"],
    ["light", "nl", "Uitvoeringssessies"],
  ] as const)("renders in %s theme + %s", async (theme, language, heading) => {
    window.localStorage.setItem("aiw.theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
    mockApi();
    renderPage("/projects/alpha/operations", OPERATOR, language);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: language === "nl" ? "Uitvoering" : "Operations" })).toBeInTheDocument();
  });
});
