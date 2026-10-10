import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import type { SoftwareFactoryProgramDetail } from "../../../features/softwareFactory";
import SoftwareFactoryProgramPage from "../SoftwareFactoryProgramPage";

const DETAIL: SoftwareFactoryProgramDetail = {
  program: {
    schemaVersion: 1,
    id: "p-1",
    projectId: "p-1",
    name: "Web platform",
    objective: "Build and ship the web platform.",
    status: "active",
    workstreams: ["ws-1"],
    createdAt: "2026-09-25T09:00:00.000Z",
    updatedAt: "2026-09-25T10:00:00.000Z",
  },
  workstreams: [
    {
      schemaVersion: 1,
      id: "ws-1",
      projectId: "p-1",
      programId: "p-1",
      name: "Build pipeline",
      objective: "Compile, test, package.",
      status: "active",
      tasks: ["t-1", "t-2"],
      createdAt: "2026-09-25T09:00:00.000Z",
      updatedAt: "2026-09-25T10:00:00.000Z",
    },
  ],
  graph: {
    nodes: [
      {
        id: "t-1",
        status: "running",
        task: {
          id: "t-1",
          type: "build",
          description: "Compile",
          projectId: "p-1",
          programId: "p-1",
          workstreamId: "ws-1",
          priority: "high",
          status: "running",
          errors: [],
          requirements: [],
          dependencies: [],
          requiredCapabilities: [],
          environmentRequirements: [],
          completionCriteria: [],
          createdAt: "c",
          updatedAt: "u",
        },
      },
      {
        id: "t-2",
        status: "completed",
        task: {
          id: "t-2",
          type: "build",
          description: "Package",
          projectId: "p-1",
          programId: "p-1",
          workstreamId: "ws-1",
          priority: "high",
          status: "completed",
          errors: [],
          requirements: [],
          dependencies: ["t-1"],
          requiredCapabilities: [],
          environmentRequirements: [],
          completionCriteria: [],
          createdAt: "c",
          updatedAt: "u",
        },
      },
    ],
    edges: [{ from: "t-1", to: "t-2", type: "blocking" }],
  },
  routes: [{ taskId: "t-1", code: "docker", status: "routed", detail: "Routed to docker" }],
};

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockDetail(overrides: { status?: number; detail?: SoftwareFactoryProgramDetail } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    if (overrides.status) return respond(overrides.status, { error: { message: "x" } });
    if (url.startsWith("/api/software-factory/programs/")) {
      return respond(200, overrides.detail ?? DETAIL);
    }
    if (url.startsWith("/api/commands/")) {
      return respond(200, {
        ok: true,
        reason: "ok",
        resourceId: "p-1",
        correlationId: "c",
        auditEventId: "a",
        timestamp: "2026-09-25T10:00:00.000Z",
      });
    }
    return respond(404, { error: { message: "not found" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const auth = {
  user: { id: "op-1", email: "op@example.test", displayName: "Op" },
  loading: false,
  accessToken: "token",
  configured: true,
  access: "granted",
  accessDetails: {
    role: "operator",
    capabilities: ["view", "create_workstream", "add_task_to_workstream", "tick_software_factory"],
  },
  signIn: vi.fn(),
  signUp: vi.fn(),
  sendPasswordReset: vi.fn(),
  refreshAccess: vi.fn(),
  getPasswordPolicy: vi.fn(),
  signOut: vi.fn(),
} as unknown as AuthContextValue;

function renderAt(language: Language = "en", value: AuthContextValue = auth) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage={language}>
        <authContext.Provider value={value}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={["/software-factory/p-1/p-1"]}>
              <Routes>
                <Route path="/software-factory/:projectId/:programId" element={<SoftwareFactoryProgramPage />} />
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

describe("SoftwareFactoryProgramPage", () => {
  it("renders workstreams with tasks, blocking dependencies, routing and the DAG", async () => {
    mockDetail();
    renderAt();

    expect(await screen.findByRole("heading", { level: 1, name: "Web platform" })).toBeInTheDocument();
    expect(screen.getByText("Build pipeline")).toBeInTheDocument();

    const ws = screen.getByText("Build pipeline").closest("li") as HTMLElement;
    expect(ws).toContainHTML("Compile");
    expect(ws).toContainHTML("Package");
    expect(ws).toContainHTML("Running");
    expect(ws).toContainHTML("Completed");
    expect(screen.getByText(/depends on t-1/)).toBeInTheDocument();
    expect(screen.getAllByText("Routed")).toHaveLength(2);

    const graph = screen.getByRole("img", { name: "Task graph" });
    expect(graph).toHaveAttribute("width", "488");
    expect(graph).toHaveAttribute("height", "112");
    expect(screen.getByRole("region", { name: "Environment routing" })).toBeInTheDocument();
    expect(screen.getByText("Routed to docker")).toBeInTheDocument();
  });

  it("uses each backend-reported command capability for its action", async () => {
    const capabilityOnly = {
      ...auth,
      accessDetails: {
        role: undefined,
        capabilities: ["view", "create_workstream", "add_task_to_workstream", "tick_software_factory"],
      },
    } as unknown as AuthContextValue;
    mockDetail();
    renderAt("en", capabilityOnly);

    expect(await screen.findByRole("button", { name: "Add task" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New workstream" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dispatch now" })).toBeInTheDocument();
  });

  it("shows graph and routing empty states when there is nothing to show", async () => {
    const empty: SoftwareFactoryProgramDetail = {
      ...DETAIL,
      graph: { nodes: [], edges: [] },
      routes: [],
    };
    mockDetail({ detail: empty });
    renderAt();

    expect(await screen.findByRole("heading", { level: 2, name: "Task graph" })).toBeInTheDocument();
    expect(screen.getByText("No tasks in this program yet.")).toBeInTheDocument();
    expect(screen.getByText("No tasks are routed to environments yet.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Task graph" })).toBeNull();
  });

  it("turns a 404 into a missing-program state instead of an empty registry", async () => {
    mockDetail({ status: 404 });
    renderAt();
    expect(await screen.findByText("Program not found")).toBeInTheDocument();
    expect(screen.queryByText("No tasks in this program yet.")).toBeNull();
  });

  it("dispatches the tick command and reports the outcome", async () => {
    const user = userEvent.setup();
    const calls = mockDetail();
    renderAt();

    await user.click(await screen.findByRole("button", { name: "Dispatch now" }));

    expect(await screen.findByText(/Dispatch complete/)).toBeInTheDocument();
    const tick = calls.find((c) => c.url === "/api/commands/tick-software-factory");
    expect(tick).toBeDefined();
    expect((tick!.init as RequestInit | undefined)?.method ?? "POST").toBe("POST");
    expect(JSON.parse(String(tick!.init.body))).toEqual({ projectId: "p-1", programId: "p-1" });
  });

  it("adds a task with parsed dependency and environment requirements", async () => {
    const user = userEvent.setup();
    const calls = mockDetail();
    renderAt();

    await user.click(await screen.findByRole("button", { name: "Add task" }));
    await user.type(screen.getByLabelText("Description"), "Distribute the artifact");
    await user.type(screen.getByLabelText(/^Dependencies/), "t-1, t-2");
    await user.type(screen.getByLabelText(/^Environment requirements/), "docker, node-linux");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Task added to the workstream.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    const post = calls.find((c) => c.url === "/api/commands/add-workstream-task");
    expect(post).toBeDefined();
    const body = JSON.parse(String(post!.init.body));
    expect(body).toEqual({
      projectId: "p-1",
      programId: "p-1",
      workstreamId: "ws-1",
      task: {
        type: "build",
        description: "Distribute the artifact",
        dependencies: ["t-1", "t-2"],
        environmentRequirements: ["docker", "node-linux"],
      },
    });
  });

  it("renders in Dutch", async () => {
    mockDetail();
    renderAt("nl");
    expect(await screen.findByRole("heading", { level: 1, name: "Web platform" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Taakgrafiek" })).toBeInTheDocument();
    expect(screen.getByText("Actief")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bsoftwareFactory\.[a-zA-Z]+/);
  });
});