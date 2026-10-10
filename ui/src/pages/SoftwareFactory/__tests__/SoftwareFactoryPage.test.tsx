import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import type { ProgramSummary } from "../../../features/softwareFactory";
import SoftwareFactoryPage from "../SoftwareFactoryPage";

const PROGRAM: ProgramSummary = {
  id: "web-platform",
  projectId: "proj-core",
  name: "Web platform",
  objective: "Build and ship the web platform.",
  status: "active",
  workstreamIds: ["ws-1"],
  taskCount: 3,
  activeTaskCount: 2,
  updatedAt: "2026-09-25T10:00:00.000Z",
};

const PROJECTS = [{ projectId: "proj-core", displayName: "Core", status: "active" }];

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockApi(overrides: { empty?: boolean; status?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    if (url === "/api/projects") return respond(200, PROJECTS);
    if (overrides.status) return respond(overrides.status, { error: { message: "x" } });
    if (url.startsWith("/api/software-factory")) {
      return respond(200, { programs: overrides.empty ? [] : [PROGRAM] });
    }
    if (url.startsWith("/api/commands/")) {
      return respond(200, {
        ok: true,
        reason: "created",
        resourceId: "p-9",
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
  accessDetails: { role: "operator", capabilities: ["view", "create_program"] },
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
            <MemoryRouter initialEntries={["/software-factory"]}>
              <Routes>
                <Route path="/software-factory" element={<SoftwareFactoryPage />} />
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

describe("SoftwareFactoryPage", () => {
  it("scopes the program list to the selected project and links into the program", async () => {
    const calls = mockApi();
    renderAt();

    const card = (await screen.findByText("Web platform")).closest("li") as HTMLElement;
    expect(card).toContainHTML("Build and ship the web platform.");
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Tasks: 3 · 2 active")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open Web platform" });
    expect(link).toHaveAttribute("href", "/software-factory/proj-core/web-platform");
    const overview = calls.find((c) => c.url.startsWith("/api/software-factory"));
    expect(overview?.url).toBe("/api/software-factory?projectId=proj-core");
  });

  it("shows an honest empty state — nothing is simulated", async () => {
    mockApi({ empty: true });
    renderAt();
    expect(await screen.findByText("No software factory programs")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is seeded or simulated/)).toBeInTheDocument();
  });

  it.each([
    [403, "Access denied"],
    [401, "Sign-in required"],
    [500, "Unable to load the software factory"],
  ])("distinguishes HTTP %s from an empty registry", async (status, title) => {
    mockApi({ status });
    renderAt();
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.queryByText("No software factory programs")).toBeNull();
  });

  it("hides write actions for read-only roles — the backend remains authoritative", async () => {
    const readOnly = {
      ...auth,
      accessDetails: { role: "viewer", capabilities: ["view"] },
    } as unknown as AuthContextValue;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/projects"
          ? respond(200, PROJECTS)
          : respond(200, { programs: [PROGRAM] }),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ThemeProvider>
        <I18nProvider initialLanguage="en">
          <authContext.Provider value={readOnly}>
            <QueryClientProvider client={client}>
              <MemoryRouter initialEntries={["/software-factory"]}>
                <Routes>
                  <Route path="/software-factory" element={<SoftwareFactoryPage />} />
                </Routes>
              </MemoryRouter>
            </QueryClientProvider>
          </authContext.Provider>
        </I18nProvider>
      </ThemeProvider>,
    );
    await screen.findByText("Web platform");
    expect(screen.queryByRole("button", { name: "New program" })).toBeNull();
  });

  it("uses the backend-reported capability instead of inferring access from the role", async () => {
    const capabilityOnly = {
      ...auth,
      accessDetails: { role: undefined, capabilities: ["view", "create_program"] },
    } as unknown as AuthContextValue;
    mockApi();
    renderAt("en", capabilityOnly);

    expect(await screen.findByRole("button", { name: "New program" })).toBeInTheDocument();
  });

  it("creates a program through an audited command with validation", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderAt();

    await user.click(await screen.findByRole("button", { name: "New program" }));
    await user.type(screen.getByLabelText(/^Id/), "releases");
    await user.type(screen.getByLabelText("Name"), "Releases");
    await user.type(screen.getByLabelText("Objective"), "Ship releases every sprint.");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Program created.")).toBeInTheDocument();
    const post = calls.find((c) => c.url === "/api/commands/create-program");
    expect(post).toBeDefined();
    expect(JSON.parse(String(post!.init.body))).toEqual({
      projectId: "proj-core",
      id: "releases",
      name: "Releases",
      objective: "Ship releases every sprint.",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("rejects an invalid program id instead of sending it", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderAt();

    await user.click(await screen.findByRole("button", { name: "New program" }));
    await user.type(screen.getByLabelText(/^Id/), "Not Valid!");
    await user.type(screen.getByLabelText("Name"), "Releases");
    await user.type(screen.getByLabelText("Objective"), "Ship releases every sprint.");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Complete all required fields.")).toBeInTheDocument();
    expect(calls.filter((c) => c.url.startsWith("/api/commands/"))).toHaveLength(0);
  });

  it("works in Dutch", async () => {
    mockApi();
    renderAt("nl");
    expect(await screen.findByRole("heading", { level: 1, name: "Softwarefabriek" })).toBeInTheDocument();
    expect(await screen.findByText("Actief")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bsoftwareFactory\.[a-zA-Z]+/);
  });
});