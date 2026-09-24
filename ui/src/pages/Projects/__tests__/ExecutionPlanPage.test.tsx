import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../../auth/AuthProvider";
import { I18nProvider, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import ExecutionPlanPage from "../ExecutionPlanPage";

const PLAN = {
  id: "plan_1@v2",
  planId: "plan_1",
  version: 2,
  projectId: "alpha",
  status: "blocked",
  current: true,
  request: { title: "Native iOS app" },
  architecture: { style: "single_platform", layers: ["mobile_app"], platforms: ["ios"] },
  analysis: { technologies: [{ componentId: "ios-app", technologyId: "swiftui" }] },
  environments: [
    {
      id: "env-1",
      componentIds: ["ios-app"],
      requirement: {
        requiredCapabilities: ["mobile_build_capable"],
        toolchains: [{ kind: "swift_xcode", minimum: { major: 15, minor: 0, patch: 0 }, components: [{ name: "ios_sdk" }] }],
        os: { os: "macos" },
      },
      descriptorSupport: "supported",
      status: "missing",
      match: { outcome: "REQUIRES_PROVISIONING", candidates: [] },
    },
  ],
  agents: [
    {
      requirementId: "agent:build:ios-app",
      agentId: "ios-agent",
      requiredCapabilities: ["ios_development"],
      matchedCapabilities: ["ios_development"],
      qualification: "qualified",
    },
  ],
  dependencies: { order: ["toolchain:swift_xcode", "toolchain:swift_xcode:ios_sdk"] },
  build: [{ id: "build:ios-app", status: "planned", componentId: "ios-app", expectedArtifact: { kind: "ios_app_archive", name: "app-ipa" } }],
  tests: [{ id: "test:ios-app:unit", status: "planned", componentId: "ios-app", type: "unit" }],
  security: [{ id: "security:secret_scan", status: "planned", check: "secret_scan" }],
  deployment: [],
  approvalRequirements: [],
  approval: { state: "not_requested" },
  blockers: [
    {
      code: "MISSING_ENVIRONMENT",
      subjectType: "environment",
      subjectId: "env-1",
      reasonCodes: ["no_eligible_instance_registered"],
      missing: ["swift_xcode", "swift_xcode:ios_sdk"],
    },
  ],
  createdAt: "2026-09-23T12:00:00.000Z",
  execution: { available: false, reason: "Plan execution is not available yet (EO-4). Planning only." },
};

const LIST = {
  items: [{ id: "plan_1@v2", planId: "plan_1", version: 2, status: "blocked", current: true, title: "Native iOS app", createdAt: PLAN.createdAt }],
  total: 1,
  nextCursor: null,
};

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockApi(handler: (url: string) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage(language: Language = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage={language}>
        <AuthProvider>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={["/projects/alpha/execution-plan"]}>
              <Routes>
                <Route path="/projects/:projectId/execution-plan" element={<ExecutionPlanPage />} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("Execution Plan page", () => {
  it("shows the plan read-only: required vs missing vs selected, blockers, and no execute control", async () => {
    const fetchMock = mockApi((url) =>
      url.endsWith("/execution-plans/plan_1") ? respond(200, PLAN) : respond(200, LIST),
    );
    renderPage();

    expect(await screen.findByRole("heading", { name: "Native iOS app" })).toBeInTheDocument();
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
    expect(screen.getByText("Missing environment")).toBeInTheDocument();
    expect(screen.getByText(/Selected: ios-agent/)).toBeInTheDocument();
    expect(screen.getAllByText("Required").length).toBeGreaterThan(0);
    expect(screen.getByText(/Execution is not available yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run|execute|deploy/i })).toBeNull();

    // Same-origin Control Plane API only.
    for (const [input] of fetchMock.mock.calls) {
      expect(String(input)).toMatch(/^\/api\/projects\/alpha\/execution-plans/);
    }
  });

  it("renders in Dutch and in the dark theme through the shared providers", async () => {
    window.localStorage.setItem("ai-workforce-theme", "dark");
    mockApi((url) => (url.endsWith("/execution-plans/plan_1") ? respond(200, PLAN) : respond(200, LIST)));
    renderPage("nl");
    expect(await screen.findByRole("heading", { name: "Native iOS app" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Uitvoeringsplan" })).toBeInTheDocument();
    expect(screen.getByText("Omgeving ontbreekt")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("distinguishes 403 from an empty result", async () => {
    mockApi(() => respond(403, { error: { message: "forbidden" } }));
    renderPage();
    expect(await screen.findByText("No access")).toBeInTheDocument();
    expect(screen.queryByText("No execution plan yet")).toBeNull();
  });

  it("distinguishes 401 (awaiting access) from 403", async () => {
    mockApi(() => respond(401, { error: { message: "authentication required" } }));
    renderPage();
    expect(await screen.findByText("Sign-in required")).toBeInTheDocument();
  });

  it("shows an empty state when the project has no plan", async () => {
    mockApi(() => respond(200, { items: [], total: 0, nextCursor: null }));
    renderPage();
    expect(await screen.findByText("No execution plan yet")).toBeInTheDocument();
  });

  it("shows not-found for an unknown or foreign project", async () => {
    mockApi(() => respond(404, { error: { message: "resource not found" } }));
    renderPage();
    expect(await screen.findByText("Project not found")).toBeInTheDocument();
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
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toMatch(/firebase\/firestore|getFirestore|collection\(/);
    }
  });
});
