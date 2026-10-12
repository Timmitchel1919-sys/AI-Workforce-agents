import { configure, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AccessState, AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import LiveWorkspacePage from "../LiveWorkspacePage";
import type {
  EventsResponse, FileResponse, RuntimeOverview, RuntimeSession, RuntimeSessionSummary, TreeResponse,
} from "../../../features/liveWorkspace/types";

configure({ asyncUtilTimeout: 5000 });

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function authValue(capabilities: readonly string[]): AuthContextValue {
  return {
    user: { id: "u1", email: "op@example.test", displayName: "Op" },
    loading: false,
    accessToken: "token",
    configured: true,
    access: "granted" as AccessState,
    accessDetails: { role: "operator", capabilities },
    signIn: vi.fn(), signUp: vi.fn(), sendPasswordReset: vi.fn(), refreshAccess: vi.fn(),
    getPasswordPolicy: vi.fn(), signOut: vi.fn(),
  };
}

export interface Call { url: string; method: string; body?: Record<string, unknown> }
type Responder = () => Response | Promise<Response>;

export const eventsBatch = (events: EventsResponse["events"], status: EventsResponse["status"] = "RUNNING", done = false): Responder =>
  () => json(200, { events, status, done });

export function stubApi(opts: {
  overview?: RuntimeOverview;
  overviewStatus?: number;
  sessions?: RuntimeSessionSummary[];
  sessionsStatus?: number;
  session?: RuntimeSession;
  sessionStatus?: number;
  sessionBody?: unknown;
  /** Tree responses keyed by dir ("" = root). */
  trees?: Record<string, TreeResponse>;
  /** File responses keyed by path; a number is an HTTP status. */
  files?: Record<string, FileResponse | number>;
  /** Sequential long-poll responses; when exhausted the request hangs until aborted. */
  events?: Responder[];
  commands?: Record<string, Responder>;
  networkFailure?: boolean;
}) {
  const calls: Call[] = [];
  const queue = [...(opts.events ?? [])];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, method, ...(body ? { body } : {}) });
    if (opts.networkFailure) throw new TypeError("Failed to fetch");
    const command = /\/api\/commands\/(\w+)$/.exec(url)?.[1];
    if (command) return opts.commands?.[command]?.() ?? json(404, { message: "not found" });
    if (/\/api\/runtime\/overview$/.test(url)) {
      return json(opts.overviewStatus ?? 200, opts.overviewStatus && opts.overviewStatus >= 400 ? { message: "overview failed" } : (opts.overview ?? { active: 0, queued: 0, waitingApproval: 0, failed: 0, completedToday: 0 }));
    }
    if (/\/api\/runtime\/sessions\?/.test(url)) {
      return json(opts.sessionsStatus ?? 200, opts.sessionsStatus && opts.sessionsStatus >= 400 ? { message: "list failed" } : { sessions: opts.sessions ?? [] });
    }
    if (/\/events\?/.test(url)) {
      const next = queue.shift();
      if (next) return next();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    const tree = /\/tree(?:\?dir=(.*))?$/.exec(url);
    if (tree) {
      const dir = decodeURIComponent(tree[1] ?? "");
      const found = opts.trees?.[dir];
      return found ? json(200, found) : json(404, { message: "no such directory" });
    }
    const file = /\/file\?path=(.*)$/.exec(url);
    if (file) {
      const found = opts.files?.[decodeURIComponent(file[1] ?? "")];
      if (typeof found === "number") return json(found, { message: "path refused by policy" });
      return found ? json(200, found) : json(404, { message: "no such file" });
    }
    if (/\/api\/runtime\/sessions\/[^/?]+$/.test(url)) {
      if (opts.sessionStatus && opts.sessionStatus >= 400) return json(opts.sessionStatus, opts.sessionBody ?? { message: "session failed" });
      return opts.session ? json(200, opts.session) : json(404, { message: "not found" });
    }
    return json(404, { message: "not found" });
  }));
  return calls;
}

export function renderAt(path: string, options: { language?: Language; capabilities?: readonly string[] } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage={options.language ?? "en"}>
        <authContext.Provider value={authValue(options.capabilities ?? ["view", "orchestrate_execution"])}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route path="/workspace" element={<LiveWorkspacePage />} />
                <Route path="/workspace/:executionId" element={<LiveWorkspacePage />} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </authContext.Provider>
      </I18nProvider>
    </ThemeProvider>,
  );
}
