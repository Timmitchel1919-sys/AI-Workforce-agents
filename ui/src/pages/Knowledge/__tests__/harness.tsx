import { configure, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AccessState, AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import KnowledgeCenterPage from "../KnowledgeCenterPage";
import { LocationProbe } from "./LocationProbe";
import { makeGraph, makeMemory, makeOverview } from "../../../features/knowledge/__tests__/fixtures";
import type {
  Conflict, ContextPackage, GraphResponse, KnowledgeDocument, MemoryDetail, MemorySummary, SearchHit,
} from "../../../features/knowledge/types";

configure({ asyncUtilTimeout: 5000 });

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function authValue(capabilities: readonly string[], role: "viewer" | "operator" | "admin"): AuthContextValue {
  return {
    user: { id: "u1", email: "op@example.test", displayName: "Op" },
    loading: false,
    accessToken: "token",
    configured: true,
    access: "granted" as AccessState,
    accessDetails: { role, capabilities },
    signIn: vi.fn(), signUp: vi.fn(), sendPasswordReset: vi.fn(), refreshAccess: vi.fn(),
    getPasswordPolicy: vi.fn(), signOut: vi.fn(),
  };
}

export interface Call { url: string; path: string; params: URLSearchParams; method: string; body?: Record<string, unknown> }
type Responder<T> = T | ((call: Call) => T | Response);

export interface ApiOptions {
  projects?: { projectId: string; displayName: string; status: string }[];
  overview?: ReturnType<typeof makeOverview>;
  memories?: Responder<MemorySummary[]>;
  total?: number;
  search?: Responder<SearchHit[]>;
  details?: Record<string, MemoryDetail | number>;
  graph?: GraphResponse | number;
  conflicts?: Responder<Conflict[]>;
  documents?: KnowledgeDocument[];
  decisions?: MemorySummary[];
  candidates?: Responder<MemorySummary[]>;
  context?: ContextPackage | number;
  /** Command name -> response (or a function of the call). */
  commands?: Record<string, Responder<Response>>;
}

function resolve<T>(value: Responder<T> | undefined, call: Call, fallback: T): T | Response {
  if (value === undefined) return fallback;
  return typeof value === "function" ? (value as (c: Call) => T | Response)(call) : value;
}

export function stubApi(opts: ApiOptions = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const parsed = new URL(url, "http://localhost");
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const call: Call = { url, path: parsed.pathname, params: parsed.searchParams, method, ...(body ? { body } : {}) };
    calls.push(call);
    const command = /\/api\/commands\/(\w+)$/.exec(parsed.pathname)?.[1];
    if (command) {
      const handler = opts.commands?.[command];
      if (!handler) return json(404, { message: "no handler" });
      const out = resolve(handler, call, json(404, { message: "no handler" }));
      return out;
    }
    switch (parsed.pathname) {
      case "/api/projects":
        return json(200, opts.projects ?? [
          { projectId: "p1", displayName: "Money Mind", status: "ACTIVE" },
          { projectId: "p2", displayName: "Second", status: "ACTIVE" },
        ]);
      case "/api/knowledge/overview":
        return json(200, opts.overview ?? makeOverview());
      case "/api/knowledge/memories": {
        const list = resolve(opts.memories, call, [makeMemory()]);
        return list instanceof Response ? list : json(200, { memories: list, total: opts.total ?? list.length });
      }
      case "/api/knowledge/search": {
        const hits = resolve(opts.search, call, [] as SearchHit[]);
        return hits instanceof Response ? hits : json(200, { hits });
      }
      case "/api/knowledge/graph":
        return typeof opts.graph === "number" ? json(opts.graph, { error: { message: "graph failed" } }) : json(200, opts.graph ?? makeGraph());
      case "/api/knowledge/conflicts": {
        const list = resolve(opts.conflicts, call, [] as Conflict[]);
        return list instanceof Response ? list : json(200, { conflicts: list });
      }
      case "/api/knowledge/documents":
        return json(200, { documents: opts.documents ?? [] });
      case "/api/knowledge/decisions":
        return json(200, { decisions: opts.decisions ?? [] });
      case "/api/knowledge/candidates": {
        const list = resolve(opts.candidates, call, [] as MemorySummary[]);
        return list instanceof Response ? list : json(200, { candidates: list });
      }
      case "/api/knowledge/context":
        return typeof opts.context === "number" ? json(opts.context, { error: { message: "context failed" } }) : json(200, opts.context);
      default: {
        const detail = /\/api\/knowledge\/memories\/([^/]+)$/.exec(parsed.pathname)?.[1];
        if (detail) {
          const found = opts.details?.[decodeURIComponent(detail)];
          if (typeof found === "number") return json(found, { error: { message: "memory failed" } });
          return found ? json(200, found) : json(404, { error: { message: "memory not found" } });
        }
        return json(404, { message: "not found" });
      }
    }
  }));
  return calls;
}

export function renderAt(path: string, options: { language?: Language; capabilities?: readonly string[]; role?: "viewer" | "operator" | "admin" } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage={options.language ?? "en"}>
        <authContext.Provider value={authValue(options.capabilities ?? ["view", "manage_knowledge"], options.role ?? "operator")}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
              <LocationProbe />
              <Routes>
                <Route path="/knowledge" element={<KnowledgeCenterPage />} />
                <Route path="/knowledge/:tab" element={<KnowledgeCenterPage />} />
                <Route path="/knowledge/:tab/:memoryId" element={<KnowledgeCenterPage />} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </authContext.Provider>
      </I18nProvider>
    </ThemeProvider>,
  );
}
