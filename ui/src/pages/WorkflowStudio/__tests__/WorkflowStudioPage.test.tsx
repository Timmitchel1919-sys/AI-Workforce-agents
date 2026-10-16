import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import {
  addNode,
  autoLayout,
  clientValidate,
  commit,
  connect,
  diffGraphs,
  emptyGraph,
  historyOf,
  outlineOrder,
  redo,
  removeNodes,
  undo,
} from "../../../features/workflowStudio/graphModel";
import WorkflowStudioPage from "../WorkflowStudioPage";

const PROJECTS = [{ projectId: "alpha", displayName: "Alpha", status: "active" }];

const CATALOG = {
  projectId: "alpha",
  nodeKinds: [
    { kind: "trigger", backing: "Manual start" },
    { kind: "agent_task", backing: "Agent Registry" },
    { kind: "approval", backing: "Approval System" },
    { kind: "terminal", backing: "Workflow completion" },
  ],
  unavailableNodeKinds: [{ kind: "model", reason: "Models are reached only through agents." }],
  agents: [
    { agentId: "dev-agent", name: "Developer", capabilities: ["code"], supportedTaskTypes: ["development"], allowedTools: [], usableOnProject: true },
  ],
  tools: [],
  modes: {
    dryRun: { available: false, reason: "no side-effect-free path" },
    liveExecution: { available: false, reason: "run state not durable" },
  },
};

const DEF = {
  definitionId: "wf_1",
  projectId: "alpha",
  name: "Feature pipeline",
  description: "",
  status: "published",
  draft: {
    nodes: [
      { id: "start", kind: "trigger", label: "Start", config: {}, position: { x: 0, y: 0 } },
      { id: "end", kind: "terminal", label: "Done", config: {}, position: { x: 240, y: 0 } },
    ],
    edges: [{ id: "e1", from: "start", to: "end" }],
  },
  draftRevision: 2,
  lastValidation: { valid: true, issues: [], draftRevision: 2, validatedAt: "2026-10-15T10:00:00.000Z" },
  latestPublishedVersion: 1,
  createdAt: "2026-10-15T09:00:00.000Z",
  createdBy: "op-1",
  updatedAt: "2026-10-15T10:00:00.000Z",
  updatedBy: "op-1",
};

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockApi() {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      if (url === "/api/projects") return respond(200, PROJECTS);
      if (url.endsWith("/workflow-studio/catalog")) return respond(200, CATALOG);
      if (url.endsWith("/workflow-definitions")) return respond(200, { items: [DEF], total: 1 });
      if (url.includes("/simulation")) {
        return respond(200, {
          mode: "simulation",
          sideEffectFree: true,
          source: "draft",
          valid: true,
          steps: [
            { order: 1, nodeId: "start", kind: "trigger", outcome: "would_start", detail: "" },
            { order: 2, nodeId: "end", kind: "terminal", outcome: "would_complete", detail: "" },
          ],
          issues: [],
          simulatedAt: "2026-10-15T10:00:00.000Z",
        });
      }
      if (url.endsWith("/workflow-definitions/wf_1")) return respond(200, { definition: DEF, versions: [] });
      if (url.startsWith("/api/commands/")) {
        return respond(200, { ok: true, reason: "workflow draft saved (revision 3)", resourceId: "wf_1", details: { draftRevision: 3 } });
      }
      return respond(404, { error: { message: "not found" } });
    }),
  );
  return calls;
}

function authWith(capabilities: string[]): AuthContextValue {
  return {
    user: { id: "op-1", email: "op@example.test", displayName: "Op" },
    loading: false,
    accessToken: "token",
    configured: true,
    access: "granted",
    accessDetails: { role: "operator", capabilities },
    signIn: vi.fn(),
    signUp: vi.fn(),
    sendPasswordReset: vi.fn(),
    refreshAccess: vi.fn(),
    getPasswordPolicy: vi.fn(),
    signOut: vi.fn(),
  } as unknown as AuthContextValue;
}

function renderPage(capabilities: string[], language: Language = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage={language}>
        <authContext.Provider value={authWith(capabilities)}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={["/workflow-studio?project=alpha"]}>
              <Routes>
                <Route path="/workflow-studio" element={<WorkflowStudioPage />} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </authContext.Provider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("graph model", () => {
  it("connects nodes, refuses self-loops, duplicates and cycles", () => {
    let g = emptyGraph();
    const added = addNode(g, "agent_task", "Build");
    g = added.graph;
    const a = connect(g, "start", added.id);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = connect(a.graph, added.id, "end");
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(connect(b.graph, "end", "end")).toEqual({ ok: false, reason: "self" });
    expect(connect(b.graph, "start", added.id)).toEqual({ ok: false, reason: "duplicate" });
    expect(connect(b.graph, "end", "start")).toEqual({ ok: false, reason: "cycle" });
    expect(outlineOrder(b.graph).map((n) => n.id)).toEqual(["start", added.id, "end"]);
    const removed = removeNodes(b.graph, new Set([added.id]));
    expect(removed.edges).toHaveLength(0);
  });

  it("undo/redo restores exact snapshots; layout is deterministic", () => {
    const g0 = emptyGraph();
    const g1 = addNode(g0, "approval", "Gate").graph;
    let h = commit(historyOf(g0), g1);
    h = undo(h);
    expect(h.present).toBe(g0);
    h = redo(h);
    expect(h.present).toBe(g1);
    expect(autoLayout(g1)).toEqual(autoLayout(g1));
  });

  it("client hints flag missing configuration but never claim validity", () => {
    const g = addNode(emptyGraph(), "agent_task", "Build").graph;
    const codes = clientValidate(g).map((i) => i.code);
    expect(codes).toContain("MISSING_TASK_TYPE");
    expect(codes).toContain("UNREACHABLE");
  });

  it("diff ignores positions", () => {
    const g = emptyGraph();
    const moved = { ...g, nodes: g.nodes.map((n) => ({ ...n, position: { x: 999, y: 999 } })) };
    expect(diffGraphs(g, moved)).toEqual({ added: [], removed: [], changed: [], edgesAdded: 0, edgesRemoved: 0 });
  });
});

describe("WorkflowStudioPage", () => {
  it("shows live execution and dry run as unavailable, and lists real definitions", async () => {
    mockApi();
    renderPage(["view", "author_workflow"]);
    expect(await screen.findByText("Feature pipeline")).toBeInTheDocument();
    expect(screen.getByText("Live execution: unavailable")).toBeInTheDocument();
    expect(screen.getByText("Dry run: unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /publish version/i })).not.toBeInTheDocument();
  });

  it("is read-only without the author capability", async () => {
    mockApi();
    renderPage(["view"]);
    expect(await screen.findByText("Read-only: your role cannot edit workflows.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add agent task/i })).toBeDisabled();
  });

  it("opens a definition, simulates it without side effects, and saves through a command", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderPage(["view", "author_workflow", "publish_workflow"]);
    await user.click(await screen.findByRole("button", { name: /feature pipeline/i }));
    await waitFor(() => expect(screen.getByDisplayValue("Feature pipeline")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Simulate" }));
    expect(await screen.findByText(/no agent, model, tool or approval was called/i)).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("/simulation") && (c.init.method ?? "GET") === "GET")).toBe(true);

    await user.click(screen.getByRole("button", { name: /add approval/i }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/commands/save-workflow-draft")).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.url === "/api/commands/save-workflow-draft")!.init.body));
    expect(body).toMatchObject({ projectId: "alpha", definitionId: "wf_1", expectedRevision: 2 });
    expect(body.graph.nodes.some((n: { kind: string }) => n.kind === "approval")).toBe(true);
  });

  it("renders in Dutch", async () => {
    mockApi();
    renderPage(["view"], "nl");
    expect(await screen.findByText("Live uitvoering: niet beschikbaar")).toBeInTheDocument();
  });
});
