import { configure, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AccessState, AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import ExecutionCenterPage from "../ExecutionCenterPage";
import type { PreparedRequestSummary, RunSummary, RunView } from "../../../features/executionOrchestration/types";

configure({ asyncUtilTimeout: 5000 });

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function commandOk(view: RunView) {
  return json(200, { ok: true, outcome: "executed", correlationId: "c1", details: { view } });
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

/** Route-aware fetch stub for the Execution Center endpoints. `views` may be replaced mid-test. */
export function stubApi(opts: {
  runs?: RunSummary[];
  runsStatus?: number;
  views?: Record<string, RunView>;
  detailStatus?: number;
  detailBody?: unknown;
  prepared?: PreparedRequestSummary[];
  preparedStatus?: number;
  commands?: Record<string, () => Response | Promise<Response>>;
  networkFailure?: boolean;
}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, method, ...(body ? { body } : {}) });
    if (opts.networkFailure) throw new TypeError("Failed to fetch");
    const command = /\/api\/commands\/(\w+)$/.exec(url)?.[1];
    if (command) return opts.commands?.[command]?.() ?? json(404, { message: "not found" });
    if (/\/api\/execution-runs\?/.test(url)) {
      return json(opts.runsStatus ?? 200, opts.runsStatus && opts.runsStatus >= 400 ? { message: "list failed" } : { runs: opts.runs ?? [] });
    }
    const detail = /\/api\/execution-runs\/([^/?]+)$/.exec(url)?.[1];
    if (detail) {
      if (opts.detailStatus && opts.detailStatus >= 400) return json(opts.detailStatus, opts.detailBody ?? { message: "detail failed" });
      const view = opts.views?.[decodeURIComponent(detail)];
      return view ? json(200, view) : json(404, { message: "not found" });
    }
    if (/\/api\/prompt-intelligence\?/.test(url)) {
      return json(opts.preparedStatus ?? 200, opts.preparedStatus && opts.preparedStatus >= 400 ? { message: "prepared failed" } : { requests: opts.prepared ?? [] });
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
                <Route path="/execution-center" element={<ExecutionCenterPage />} />
                <Route path="/execution-center/:runId" element={<ExecutionCenterPage />} />
                <Route path="/approvals" element={<div>APPROVALS PAGE</div>} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </authContext.Provider>
      </I18nProvider>
    </ThemeProvider>,
  );
}
