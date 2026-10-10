import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
import fixtures from "./fixtures/plans.json";

/** Fixtures are produced by the REAL planner (scripts/generate-ui-plan-fixtures.mjs). */
type Fixture = (typeof fixtures)["ready"];

const PROJECT = {
  projectId: "alpha",
  displayName: "Alpha Portal",
  status: "available",
  adapterStatus: "healthy",
  capabilities: [],
  connectedAgents: ["web-agent"],
  activeWorkflows: 0,
};
const OPERATOR = ["view", "approve", "reject", "create_execution_plan", "replan_execution_plan", "submit_execution_plan"];
const VIEWER = ["view"];

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface Api {
  current?: Fixture | null;
  currentStatus?: number;
  versions?: Record<number, Fixture>;
  history?: Fixture[];
  commandStatus?: number;
  preflight?: unknown;
}

function mockApi(api: Api) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (method === "POST" && url === "/api/execution/preflight") return respond(200, api.preflight);
      if (method === "POST") return respond(api.commandStatus ?? 200, { ok: api.commandStatus === undefined, reason: "x" });
      if (url === "/api/projects/alpha") return respond(200, PROJECT);
      if (url === "/api/agents") return respond(200, [{ agentId: "web-agent", name: "Web Builder" }]);
      if (url === "/api/planning/technologies") {
        return respond(200, [{ id: "react_typescript", label: "React + TypeScript", componentKinds: ["web_frontend"], platforms: ["web"] }]);
      }
      if (url.endsWith("/execution-plans/current")) {
        return api.currentStatus ? respond(api.currentStatus, { error: { message: "x" } }) : respond(200, { plan: api.current ?? null });
      }
      const version = /version=(\d+)/.exec(url);
      if (version) {
        const plan = api.versions?.[Number(version[1])];
        return plan ? respond(200, plan) : respond(404, { error: { message: "resource not found" } });
      }
      if (url.includes("/execution-plans?")) {
        const items = (api.history ?? []).map((p) => ({
          id: p.id,
          planId: p.planId,
          version: p.version,
          status: p.status,
          current: p.current,
          title: p.request.title,
          blockerCodes: p.blockers.map((b) => b.code),
          approvalState: p.approval.state,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        }));
        return respond(200, { items, total: items.length, nextCursor: null });
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
                <Route path="/projects/:projectId/execution-plan" element={<ProjectDetailPage />} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </authContext.Provider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

const PLAN_PATH = "/projects/alpha/execution-plan";

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

describe("Project Detail → Execution Plan", () => {
  it("renders a READY plan with every section, planned (never executed) language and no execute control", async () => {
    mockApi({ current: fixtures.ready, history: [fixtures.ready] });
    renderPage(PLAN_PATH);

    expect(await screen.findByRole("heading", { name: "Customer portal" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Execution plan" })).toHaveAttribute("aria-current", "page");
    for (const section of ["Architecture", "Technologies", "Environments", "Agents", "Dependencies", "Build plan", "Test plan", "Security", "Deployment", "Approvals", "Planning pipeline", "Plan history"]) {
      expect(screen.getByRole("heading", { name: new RegExp(`^${section}`) })).toBeInTheDocument();
    }
    expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);
    expect(screen.getByText("Nothing blocks this plan.")).toBeInTheDocument();
    expect(screen.getAllByText("Planned").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Required").length).toBeGreaterThan(0);
    expect(screen.getByText(/Selected agent: Web Builder/)).toBeInTheDocument();
    expect(screen.getByText(/Planning only: nothing in this plan has been executed/)).toBeInTheDocument();
    // Governance actions only — no run/execute/deploy.
    expect(screen.getByRole("button", { name: /Re-evaluate plan/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Request approval/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /deploy|execute|run/i })).toBeNull();
    // Plan content (everything except the explicit "nothing executed" notice)
    // never claims an execution result.
    const content = [...document.querySelectorAll(".plan-section, .plan-summary")]
      .map((el) => el.textContent)
      .join(" ");
    expect(content).not.toMatch(/\b(passed|succeeded|success|deployed|completed)\b/i);
  });

  it("execution readiness: a pre-flight sends references only and shows the denial — nothing executes", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      current: fixtures.ready,
      history: [fixtures.ready],
      preflight: {
        decision: "DENIED",
        reasons: [
          { code: "POLICY_DENIED", detail: "no policy rule permits this operation (deny by default)" },
          { code: "SANDBOX_UNAVAILABLE", detail: "no sandbox" },
        ],
        stageId: "build:web",
        policy: { policyId: "baseline-deny-all", version: 1 },
        requiredApprovals: [],
        executionAvailable: false,
      },
    });
    renderPage(PLAN_PATH, [...OPERATOR, "prepare_execution"]);

    const readiness = await screen.findByRole("region", { name: "Execution readiness" });
    const buttons = within(readiness).getAllByRole("button", { name: /Check readiness/ });
    await user.click(buttons[0]!);
    expect(await within(readiness).findByText("Denied")).toBeInTheDocument();
    expect(within(readiness).getByText(/No execution policy permits this operation/)).toBeInTheDocument();
    expect(within(readiness).getByText(/No sandbox can isolate and bound/)).toBeInTheDocument();
    expect(within(readiness).getByText("Policy baseline-deny-all v1")).toBeInTheDocument();
    const post = calls.find((c) => c.url === "/api/execution/preflight");
    expect(Object.keys(post?.body as object).sort()).toEqual(["planId", "planVersion", "projectId", "stageId"]);
    // Still no execute / run / deploy control anywhere.
    expect(screen.queryByRole("button", { name: /deploy|execute|run/i })).toBeNull();
    expect(within(readiness).getByText(/Controlled execution is not available yet/)).toBeInTheDocument();
  });

  it("execution readiness: without prepare_execution there is no check control", async () => {
    mockApi({ current: fixtures.ready, history: [fixtures.ready] });
    renderPage(PLAN_PATH, VIEWER);
    const readiness = await screen.findByRole("region", { name: "Execution readiness" });
    expect(within(readiness).queryByRole("button")).toBeNull();
    expect(within(readiness).getByText("Your role cannot run readiness checks.")).toBeInTheDocument();
  });

  it("missing Xcode: required, unavailable and blocked — never 'Xcode available'", async () => {
    mockApi({ current: fixtures.blockedIos, history: [fixtures.blockedIos] });
    renderPage(PLAN_PATH);

    const blockers = await screen.findByRole("region", { name: /Blockers/ });
    expect(within(blockers).getByText("Missing environment")).toBeInTheDocument();
    expect(within(blockers).getByText(/No registered, available environment satisfies/)).toBeInTheDocument();
    expect(within(blockers).getByText(/Register or provision a compatible environment/)).toBeInTheDocument();
    expect(within(blockers).getByText(/swift_xcode:ios_sdk/)).toBeInTheDocument();
    expect(screen.getByText("Required environment unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Environment type is supported — this is not a machine/)).toBeInTheDocument();
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/xcode available/i);
    // No approval request on a blocked plan.
    expect(screen.queryByRole("button", { name: /Request approval/ })).toBeNull();
  });

  it("no qualified agent: required capability, no candidate, blocker — and no bypass", async () => {
    mockApi({ current: fixtures.noAgent, history: [fixtures.noAgent] });
    renderPage(PLAN_PATH);

    const blockers = await screen.findByRole("region", { name: /Blockers/ });
    expect(within(blockers).getByText("No qualified agent")).toBeInTheDocument();
    expect(within(blockers).getByText(/Provision or authorize an agent/)).toBeInTheDocument();
    const agents = screen.getByRole("region", { name: /^Agents/ });
    expect(within(agents).getByText("web_development")).toBeInTheDocument();
    expect(within(agents).getByText("No qualified agent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /assign/i })).toBeNull();
  });

  it("multi-environment: every environment requirement is shown separately", async () => {
    mockApi({ current: fixtures.multi, history: [fixtures.multi] });
    renderPage(PLAN_PATH);

    const envs = await screen.findByRole("region", { name: /^Environments/ });
    for (const component of ["frontend", "backend", "mobile"]) {
      expect(within(envs).getByText(`For: ${component}`)).toBeInTheDocument();
    }
    expect(within(envs).getAllByText("Required environment unavailable")).toHaveLength(3);
  });

  it("history: the current revision and historical revisions cannot be confused", async () => {
    const { v3, v2, v1 } = fixtures.history;
    mockApi({ current: v3, versions: { 1: v1, 2: v2, 3: v3 }, history: [v3, v2, v1] });
    renderPage(PLAN_PATH);

    const history = await screen.findByRole("region", { name: "Plan history" });
    const items = await within(history).findAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText(/Current/)).toBeInTheDocument();
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(within(items[1]!).getByText(/Historical/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Changes since version 2/ })).toBeInTheDocument();
  });

  it("a historical revision shows a banner and offers no actions", async () => {
    const { v3, v2, v1 } = fixtures.history;
    mockApi({ current: v3, versions: { 1: v1, 2: v2, 3: v3 }, history: [v3, v2, v1] });
    renderPage(`${PLAN_PATH}?plan=${v2.planId}&version=2`);

    expect(await screen.findByText(/Historical plan — superseded by version 3/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View current plan" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Re-evaluate plan|Request approval|Approve plan/ })).toBeNull();
  });

  it("replan: confirms, sends the reviewed version, refetches — nothing executes", async () => {
    const user = userEvent.setup();
    const calls = mockApi({ current: fixtures.blockedIos, history: [fixtures.blockedIos] });
    renderPage(PLAN_PATH);

    await user.click(await screen.findByRole("button", { name: /Re-evaluate plan/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/A new revision may be created; version 1 stays available/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/Done — the plan has been refreshed/)).toBeInTheDocument();
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("/api/commands/replan-execution-plan");
    expect(post?.body).toEqual({ planId: fixtures.blockedIos.planId, expectedVersion: 1 });
    expect(calls.filter((c) => c.url.endsWith("/current")).length).toBeGreaterThan(1);
    for (const call of calls) expect(call.url).toMatch(/^\/api\//);
  });

  it("stale revision: a 409 is reported as a conflict, not applied to the newer plan", async () => {
    const user = userEvent.setup();
    mockApi({ current: fixtures.ready, history: [fixtures.ready], commandStatus: 409 });
    renderPage(PLAN_PATH);

    await user.click(await screen.findByRole("button", { name: /Request approval/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/version 1 of this plan in project Alpha Portal/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Production deployment/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/This plan changed in the meantime/)).toBeInTheDocument();
  });

  it("no plan: authorized users can create one; viewers cannot", async () => {
    mockApi({ current: null });
    const { unmount } = renderPage(PLAN_PATH);
    expect(await screen.findByText("No execution plan yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create execution plan/ })).toBeInTheDocument();
    unmount();

    mockApi({ current: null });
    renderPage(PLAN_PATH, VIEWER);
    expect(await screen.findByText("No execution plan yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create execution plan/ })).toBeNull();
  });

  it("create: sends a planning REQUEST built from the real catalog; the server plans it", async () => {
    const user = userEvent.setup();
    const calls = mockApi({ current: null });
    renderPage(PLAN_PATH);

    await user.click(await screen.findByRole("button", { name: /Create execution plan/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Plan title"), "Portal");
    await user.type(within(dialog).getByLabelText(/^Component name/), "web");
    await user.click(within(dialog).getByRole("checkbox", { name: "Web" }));
    await user.click(await within(dialog).findByRole("checkbox", { name: "React + TypeScript" }));
    await user.click(within(dialog).getByRole("button", { name: "Create plan" }));

    await vi.waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("/api/commands/create-execution-plan");
    expect(post?.body).toEqual({
      projectId: "alpha",
      title: "Portal",
      components: [{ id: "web", kind: "web_frontend", platforms: ["web"], technologies: ["react_typescript"] }],
      deployments: [],
    });
  });

  it.each([
    [403, "Access denied"],
    [401, "Sign-in required"],
    [409, "The plan changed"],
    [500, "Unable to load the execution plan"],
  ])("distinguishes HTTP %s (never an empty state)", async (status, title) => {
    mockApi({ currentStatus: status });
    renderPage(PLAN_PATH);
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.queryByText("No execution plan yet")).toBeNull();
  });

  it("renders in Dutch + dark theme without untranslated labels", async () => {
    window.localStorage.setItem("ai-workforce-theme", "dark");
    mockApi({ current: fixtures.blockedIos, history: [fixtures.blockedIos] });
    renderPage(PLAN_PATH, OPERATOR, "nl");

    expect(await screen.findByRole("region", { name: /Blokkades/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Uitvoeringsplan" })).toBeInTheDocument();
    expect(screen.getByText("Vereiste omgeving niet beschikbaar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Plan opnieuw berekenen/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plangeschiedenis" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bplans\.[a-zA-Z]+/);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("light theme + English is the default", async () => {
    window.localStorage.setItem("ai-workforce-theme", "light");
    mockApi({ current: fixtures.ready, history: [fixtures.ready] });
    renderPage(PLAN_PATH);
    expect(await screen.findByRole("heading", { name: "Customer portal" })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.body.textContent).not.toMatch(/\bplans\.[a-zA-Z]+/);
  });

  it("the Execution Plan tab is hidden without the view capability", async () => {
    mockApi({ current: fixtures.ready });
    renderPage("/projects/alpha", []);
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Execution plan" })).toBeNull();
  });
});

describe("Execution plan data path", () => {
  it("never touches Firestore directly — the UI only calls the Control Plane", () => {
    const root = join(process.cwd(), "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry) && !path.includes("__tests__")) files.push(path);
      }
    };
    walk(join(root, "features", "executionPlans"));
    walk(join(root, "pages", "Projects"));
    expect(files.length).toBeGreaterThan(8);
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toMatch(/firebase\/firestore|getFirestore|collection\(|localStorage/);
    }
  });
});
