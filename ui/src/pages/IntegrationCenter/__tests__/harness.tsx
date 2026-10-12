import { configure, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AccessState, AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import IntegrationCenterPage from "../IntegrationCenterPage";
import { LocationProbe } from "./LocationProbe";
import {
  makeActivity, makeAudit, makeCapabilities, makeDetail, makeEvents, makeHealth, makeMcpServer, makeOverview,
} from "../../../features/integrationCenter/__tests__/fixtures";

configure({ asyncUtilTimeout: 5000 });

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function authValue(capabilities: readonly string[], role: "viewer" | "operator" | "admin"): AuthContextValue {
  return {
    user: { id: "u1", email: "op@example.test", displayName: "Op" },
    loading: false, accessToken: "token", configured: true, access: "granted" as AccessState,
    accessDetails: { role, capabilities },
    signIn: vi.fn(), signUp: vi.fn(), sendPasswordReset: vi.fn(), refreshAccess: vi.fn(),
    getPasswordPolicy: vi.fn(), signOut: vi.fn(),
  };
}

export interface Call { url: string; path: string; params: URLSearchParams; method: string; body?: Record<string, unknown> }
export type Responder = unknown | ((call: Call) => unknown | Response);

/** `routes` maps an API path (e.g. "/api/integration-center/overview") to a body or a function of the call. */
export interface ApiOptions {
  routes?: Record<string, Responder>;
  commands?: Record<string, Responder>;
}

const DEFAULTS: Record<string, unknown> = {
  "/api/projects": [
    { projectId: "p1", displayName: "Money Mind", status: "ACTIVE" },
    { projectId: "p2", displayName: "Second", status: "ACTIVE" },
  ],
  "/api/integration-center/overview": makeOverview(),
  "/api/integration-center/capabilities": makeCapabilities(),
  "/api/integration-center/events": makeEvents(),
  "/api/integration-center/activity": { activity: [makeActivity()] },
  "/api/integration-center/health": makeHealth(),
  "/api/integration-center/mcp": { servers: [makeMcpServer()] },
  "/api/integration-center/audit": { entries: [makeAudit()] },
};

function respond(value: unknown, call: Call): Response {
  const out = typeof value === "function" ? (value as (c: Call) => unknown)(call) : value;
  return out instanceof Response ? out : json(200, out);
}

export function stubApi(opts: ApiOptions = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const parsed = new URL(url, "http://localhost");
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const call: Call = { url, path: parsed.pathname, params: parsed.searchParams, method: init?.method ?? "GET", ...(body ? { body } : {}) };
    calls.push(call);
    const command = /\/api\/commands\/(\w+)$/.exec(parsed.pathname)?.[1];
    if (command) {
      const handler = opts.commands?.[command];
      return handler === undefined ? json(404, { error: { message: "no handler" } }) : respond(handler, call);
    }
    const custom = opts.routes?.[parsed.pathname];
    if (custom !== undefined) return respond(custom, call);
    if (parsed.pathname in DEFAULTS) return json(200, DEFAULTS[parsed.pathname]);
    const connector = /\/api\/integration-center\/connectors\/([^/]+)$/.exec(parsed.pathname)?.[1];
    if (connector) return json(200, makeDetail({ connectorId: decodeURIComponent(connector) }));
    return json(404, { error: { message: "not found" } });
  }));
  return calls;
}

export function renderAt(path: string, options: { language?: Language; capabilities?: readonly string[]; role?: "viewer" | "operator" | "admin" } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage={options.language ?? "en"}>
        <authContext.Provider value={authValue(options.capabilities ?? ["view", "manage_integrations"], options.role ?? "operator")}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
              <LocationProbe />
              <Routes>
                <Route path="/integration-center" element={<IntegrationCenterPage />} />
                <Route path="/integration-center/:tab" element={<IntegrationCenterPage />} />
                <Route path="/integration-center/:tab/:itemId" element={<IntegrationCenterPage />} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </authContext.Provider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

export const commandBody = (details: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  command: "integration_x", outcome: "executed", ok: true, reason: "ok", correlationId: "corr-1", details, auditEventId: "a1", timestamp: "2026-05-01T10:00:00.000Z", ...over,
});
export const executed = (details: Record<string, unknown> = {}) => json(200, commandBody(details));
export const rejected = (reason: string, errorKind = "forbidden") =>
  json(403, commandBody({}, { outcome: "denied", ok: false, errorKind, reason }));
