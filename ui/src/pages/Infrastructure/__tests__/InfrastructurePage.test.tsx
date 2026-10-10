import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import InfrastructurePage from "../InfrastructurePage";

const DESCRIPTORS = [
  {
    id: "env.node-web",
    name: "Node web build",
    description: "Builds web front-ends with Node.js.",
    environmentType: "web_build",
    supportedToolchains: [{ kind: "node", minimum: { major: 20, minor: 0, patch: 0 } }],
    requiredCapabilities: ["command_execution_available"],
  },
];
const HOSTS = [
  {
    id: "host-1",
    hostId: "host-1",
    name: "build-box-01",
    hostType: "dedicated_runner",
    os: { os: "linux", version: "22.04", architecture: "x64" },
    trustLevel: "verified",
    availability: "available",
    capabilities: [
      { capability: "command_execution_available", available: true, evidence: "probe: sh -c true" },
      { capability: "gpu_available", available: false },
    ],
    fingerprint: "fp",
    lastDetectedAt: "2026-09-24T10:00:00.000Z",
  },
  {
    id: "host-2",
    hostId: "host-2",
    name: "mac-mini",
    hostType: "mac_build_host",
    os: { os: "macos", architecture: "arm64" },
    trustLevel: "declared",
    availability: "degraded",
    capabilities: [],
    fingerprint: "fp2",
  },
];
const INSTANCES = [
  {
    id: "inst-1",
    descriptorId: "env.node-web",
    hostId: "host-1",
    environmentType: "web_build",
    name: "Node 20 on build-box-01",
    version: { major: 20, minor: 11, patch: 1 },
    availability: "available",
    capabilities: [{ capability: "web_build_capable", available: true }],
    toolchains: [{ kind: "node", name: "Node.js", version: { major: 20, minor: 11, patch: 1 } }],
    trustLevel: "detected",
    fingerprint: "fp3",
  },
];
const TOOLS = [
  {
    toolId: "mm.run-tests",
    name: "Run tests",
    version: "1.0.0",
    capabilities: ["qa"],
    allowedAgents: ["qa-agent"],
    allowedProjects: [],
    allowedEnvironments: ["staging"],
    requiredPermission: "execute",
    approvalRequired: true,
    stats: { total: 3, completed: 2, failed: 1, denied: 0, timedOut: 0, approvalRequired: 1 },
  },
];

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockApi(overrides: { empty?: boolean; status?: number } = {}) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (overrides.status) return respond(overrides.status, { error: { message: "x" } });
      const data: Record<string, unknown[]> = {
        "/api/environments/descriptors": DESCRIPTORS,
        "/api/environments/instances": overrides.empty ? [] : INSTANCES,
        "/api/hosts": overrides.empty ? [] : HOSTS,
        "/api/tools": overrides.empty ? [] : TOOLS,
      };
      return data[url] ? respond(200, data[url]) : respond(404, { error: { message: "not found" } });
    }),
  );
  return urls;
}

const auth = {
  user: { id: "op-1", email: "op@example.test", displayName: "Op" },
  loading: false,
  accessToken: "token",
  configured: true,
  access: "granted",
  accessDetails: { role: "viewer", capabilities: ["view"] },
  signIn: vi.fn(),
  signUp: vi.fn(),
  sendPasswordReset: vi.fn(),
  refreshAccess: vi.fn(),
  getPasswordPolicy: vi.fn(),
  signOut: vi.fn(),
} as unknown as AuthContextValue;

function renderAt(path: string, language: Language = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage={language}>
        <authContext.Provider value={auth}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route path="/infrastructure/*" element={<InfrastructurePage />} />
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

describe("Infrastructure", () => {
  it("shows detected installations and supported environment types separately", async () => {
    const urls = mockApi();
    renderAt("/infrastructure");

    const card = (await screen.findByText("Node 20 on build-box-01")).closest("li") as HTMLElement;
    expect(within(card).getByText("20.11.1")).toBeInTheDocument();
    expect(within(card).getByText("build-box-01")).toBeInTheDocument();
    expect(within(card).getByText("Node.js 20.11.1")).toBeInTheDocument();
    expect(within(card).getByText("Detected")).toBeInTheDocument();

    const types = screen.getByRole("region", { name: "Supported environment types" });
    expect(within(types).getByText("Node web build")).toBeInTheDocument();
    expect(within(types).getByText("node ≥ 20.0.0")).toBeInTheDocument();
    expect(within(types).getByText("Command execution")).toBeInTheDocument();
    for (const url of urls) expect(url).toMatch(/^\/api\//);
  });

  it("lists hosts with evidenced capabilities and filters by availability", async () => {
    const user = userEvent.setup();
    mockApi();
    renderAt("/infrastructure/hosts");

    const host = (await screen.findByText("build-box-01")).closest("li") as HTMLElement;
    expect(within(host).getByText("Dedicated runner")).toBeInTheDocument();
    expect(within(host).getByText("linux · 22.04 · x64")).toBeInTheDocument();
    expect(within(host).getByText("Verified")).toBeInTheDocument();
    expect(within(host).getByText("Evidence: probe: sh -c true")).toBeInTheDocument();
    expect(within(host).getByText("1 installation(s)")).toBeInTheDocument();
    expect(screen.getByText("mac-mini")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Availability"), "degraded");
    expect(screen.queryByText("build-box-01")).toBeNull();
    expect(screen.getByText("mac-mini")).toBeInTheDocument();
  });

  it("shows the tool policy and execution counts", async () => {
    mockApi();
    renderAt("/infrastructure/tools");
    const tool = (await screen.findByText("Run tests")).closest("li") as HTMLElement;
    expect(within(tool).getByText("Approval required")).toBeInTheDocument();
    expect(within(tool).getByText("execute")).toBeInTheDocument();
    expect(within(tool).getByText("qa-agent")).toBeInTheDocument();
    // Projects outside the operator's scope are redacted by the server.
    expect(within(tool).getByText("None in your scope")).toBeInTheDocument();
    expect(within(tool).getByText(/3 runs · 2 completed · 1 failed · 0 denied/)).toBeInTheDocument();
  });

  it("shows honest empty states — nothing is simulated", async () => {
    mockApi({ empty: true });
    renderAt("/infrastructure/hosts");
    expect(await screen.findByText("No hosts registered")).toBeInTheDocument();
    expect(screen.getByText(/No hosts are seeded or simulated/)).toBeInTheDocument();
  });

  it.each([
    [403, "Access denied"],
    [401, "Sign-in required"],
    [500, "Unable to load infrastructure"],
  ])("distinguishes HTTP %s from an empty registry", async (status, title) => {
    mockApi({ status });
    renderAt("/infrastructure/tools");
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.queryByText("No tools registered")).toBeNull();
  });

  it("works in Dutch and the dark theme", async () => {
    window.localStorage.setItem("ai-workforce-theme", "dark");
    mockApi();
    renderAt("/infrastructure/hosts", "nl");
    expect(await screen.findByRole("heading", { level: 1, name: "Infrastructuur" })).toBeInTheDocument();
    expect(await screen.findByText("Geverifieerd")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Omgevingen" })).toHaveAttribute("href", "/infrastructure");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.body.textContent).not.toMatch(/\binfrastructure\.[a-zA-Z]+/);
  });
});
