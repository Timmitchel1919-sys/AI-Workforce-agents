import { configure, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AccessState, AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider } from "../../../i18n";
import { platformCentersEn } from "../../../i18n/locales/platformCenters.en";
import { platformCentersNl } from "../../../i18n/locales/platformCenters.nl";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import ExtensionPlatformPage from "../ExtensionPlatformPage";
import BusinessLayerPage from "../BusinessLayerPage";
import ProjectPortfolioPage from "../ProjectPortfolioPage";
import OperationsCenterPage from "../OperationsCenterPage";
import AnalyticsCenterPage from "../AnalyticsCenterPage";

configure({ asyncUtilTimeout: 5000 });

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});
afterEach(() => vi.unstubAllGlobals());

/* ---------------------------- catalogue integrity ---------------------------- */

function flatten(obj: unknown, prefix = ""): string[] {
  if (typeof obj === "string") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
}
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) && !name.includes("test") ? [full] : [];
  });
}

describe("catalogue", () => {
  it("has identical EN and NL keys and no empty text", () => {
    const en = flatten(platformCentersEn).sort();
    const nl = flatten(platformCentersNl).sort();
    expect(nl).toEqual(en);
    const empty = (o: unknown): boolean => (typeof o === "string" ? o.trim() === "" : Object.values(o as object).some(empty));
    expect(empty(platformCentersEn) || empty(platformCentersNl)).toBe(false);
  });

  it("keeps the same placeholders in both languages", () => {
    const get = (o: unknown, path: string) => path.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], o) as string;
    for (const key of flatten(platformCentersEn)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
      expect(ph(get(platformCentersNl, key)), key).toBe(ph(get(platformCentersEn, key)));
    }
  });

  it("defines every literal key the screens ask for", () => {
    const keys = new Set(flatten(platformCentersEn));
    const root = join(process.cwd(), "src", "features", "platformCenters");
    const missing: string[] = [];
    for (const file of walk(root)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/\btt\(\s*"([\w.]+)"/g)) if (!keys.has(m[1]!)) missing.push(`${file}: ${m[1]}`);
      for (const m of src.matchAll(/\blabel\(\s*"(\w+)"\s*,\s*"(\w+)"/g)) if (!keys.has(`enums.${m[1]}.${m[2]}`)) missing.push(`${file}: enums.${m[1]}.${m[2]}`);
    }
    expect(missing).toEqual([]);
  });

  it("labels every enum group the screens use", () => {
    const groups = new Set(Object.keys(platformCentersEn.enums));
    const root = join(process.cwd(), "src", "features", "platformCenters");
    const missing: string[] = [];
    for (const file of walk(root)) {
      for (const m of readFileSync(file, "utf8").matchAll(/\blabel\(\s*"(\w+)"/g)) if (!groups.has(m[1]!)) missing.push(`${file}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
});

/* -------------------------------- rendering -------------------------------- */

function authValue(capabilities: readonly string[], role: "viewer" | "operator" | "admin"): AuthContextValue {
  return {
    user: { id: "u1", email: "op@example.test", displayName: "Op" },
    loading: false, accessToken: "token", configured: true, access: "granted" as AccessState,
    accessDetails: { role, capabilities },
    signIn: vi.fn(), signUp: vi.fn(), sendPasswordReset: vi.fn(), refreshAccess: vi.fn(),
    getPasswordPolicy: vi.fn(), signOut: vi.fn(),
  };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stub(routes: Record<string, unknown>) {
  const calls: { path: string; method: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    calls.push({ path: url.pathname, method: init?.method ?? "GET", ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}) });
    if (url.pathname === "/api/projects") return json(200, [{ projectId: "p1", displayName: "Money Mind", status: "ACTIVE" }]);
    if (url.pathname in routes) return json(200, routes[url.pathname]);
    return json(404, { error: { message: "not found" } });
  }));
  return calls;
}

function renderAt(path: string, role: "viewer" | "operator" | "admin", capabilities: readonly string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pages: [string, () => JSX.Element][] = [
    ["extension-platform", ExtensionPlatformPage], ["business-layer", BusinessLayerPage], ["project-portfolio", ProjectPortfolioPage],
    ["operations-center", OperationsCenterPage], ["analytics-center", AnalyticsCenterPage],
  ];
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage="en">
        <authContext.Provider value={authValue(capabilities, role)}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                {pages.flatMap(([base, Page]) => [
                  <Route key={base} path={`/${base}`} element={<Page />} />,
                  <Route key={`${base}-t`} path={`/${base}/:tab`} element={<Page />} />,
                  <Route key={`${base}-i`} path={`/${base}/:tab/:itemId`} element={<Page />} />,
                ])}
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </authContext.Provider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

const TABS: Record<string, string[]> = {
  "extension-platform": ["registry", "register", "catalogue"],
  "business-layer": ["board", "organization", "departments", "objectives", "plans", "decisions"],
  "project-portfolio": ["dashboard", "projects", "priorities", "relations", "ask", "knowledge"],
  "operations-center": ["overview", "approvals", "workflows", "autonomy", "incidents", "audit"],
  "analytics-center": ["overview", "agents", "workflows", "cost", "predictions", "recommendations", "whatif", "lessons"],
};

describe("centers", () => {
  it("renders every tab of every center, and a server failure is shown instead of crashing", async () => {
    for (const [base, tabs] of Object.entries(TABS)) {
      for (const tab of tabs) {
        stub({});
        const { unmount } = renderAt(`/${base}/${tab}`, "operator", ["view"]);
        await waitFor(() => expect(screen.getByRole("link", { current: "page" })).toBeInTheDocument());
        unmount();
        vi.unstubAllGlobals();
      }
    }
  });
});

describe("operations approvals", () => {
  const gate = (risk: string) => ({
    instanceId: "i1", projectId: "p1", stepId: "s1",
    gate: { proposedAction: `do ${risk}`, reason: "because", affectedResources: ["repo"], expectedImpact: "changes", risk, rollback: "none", requestedAt: "2026-05-01T10:00:00.000Z" },
  });
  const overview = {
    generatedAt: "2026-05-01T10:00:00.000Z",
    global: { paused: false, emergencyStop: false },
    counts: { active: 0, queued: 0, failed: 0, waitingApproval: 2, blocked: 0, incidents: 0, recoveries: 0, completed: 0 },
    active: [], queued: [], failed: [], waitingApprovals: [gate("LOW"), gate("CRITICAL")],
    autonomousActions: [], blockedOperations: [], incidents: [], recoveries: [],
    orchestration: { active: 0, queued: 0, failed: 0, waitingApproval: 0 },
  };
  const approveFor = async (action: string) => {
    const cards = await screen.findAllByTestId("gate-card");
    const card = cards.find((c) => c.textContent?.includes(action))!;
    return card.querySelector("button")! as HTMLButtonElement;
  };

  it("lets an operator approve low risk but not critical risk", async () => {
    stub({ "/api/operations-center/overview": overview });
    renderAt("/operations-center/approvals", "operator", ["view", "manage_autonomy"]);
    expect(await approveFor("do LOW")).toBeEnabled();
    expect(await approveFor("do CRITICAL")).toBeDisabled();
  });

  it("lets an administrator approve critical risk", async () => {
    stub({ "/api/operations-center/overview": overview });
    renderAt("/operations-center/approvals", "admin", ["view", "manage_autonomy"]);
    expect(await approveFor("do CRITICAL")).toBeEnabled();
  });

  it("disables every decision without the manage capability", async () => {
    stub({ "/api/operations-center/overview": overview });
    renderAt("/operations-center/approvals", "viewer", ["view"]);
    const cards = await screen.findAllByTestId("gate-card");
    for (const card of cards) for (const b of card.querySelectorAll("button")) expect(b).toBeDisabled();
  });
});
