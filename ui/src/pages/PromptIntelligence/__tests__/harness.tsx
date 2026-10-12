import { configure, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AccessState, AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import PromptIntelligencePage from "../PromptIntelligencePage";
import type { PromptRequestSummary, PromptRequestView } from "../../../features/promptIntelligence/types";

// The full suite runs many jsdom workers at once; give async queries headroom.
configure({ asyncUtilTimeout: 5000 });

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function commandOk(view: PromptRequestView) {
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

/** Route-aware fetch stub for the Prompt Intelligence endpoints. */
export function stubApi(opts: {
  history?: PromptRequestSummary[];
  historyStatus?: number;
  views?: Record<string, PromptRequestView>;
  detailStatus?: number;
  detailBody?: unknown;
  projects?: { projectId: string; displayName: string; status: string }[];
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
    if (/\/api\/prompt-intelligence\?/.test(url) || url.endsWith("/api/prompt-intelligence")) {
      return json(opts.historyStatus ?? 200, opts.historyStatus && opts.historyStatus >= 400 ? { message: "history failed" } : { requests: opts.history ?? [] });
    }
    const detail = /\/api\/prompt-intelligence\/([^/?]+)$/.exec(url)?.[1];
    if (detail) {
      if (opts.detailStatus && opts.detailStatus >= 400) return json(opts.detailStatus, opts.detailBody ?? { message: "detail failed" });
      const view = opts.views?.[decodeURIComponent(detail)];
      return view ? json(200, view) : json(404, { message: "not found" });
    }
    if (url.endsWith("/api/projects")) return json(200, opts.projects ?? [{ projectId: "money-mind", displayName: "Money Mind", status: "active" }]);
    return json(404, { message: "not found" });
  }));
  return calls;
}

export function renderAt(path: string, options: { language?: Language; capabilities?: readonly string[] } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage={options.language ?? "en"}>
        <authContext.Provider value={authValue(options.capabilities ?? ["view", "prepare_prompt"])}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route path="/prompt-intelligence" element={<PromptIntelligencePage />} />
                <Route path="/prompt-intelligence/:requestId" element={<PromptIntelligencePage />} />
                <Route path="/approvals" element={<div>APPROVALS PAGE</div>} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </authContext.Provider>
      </I18nProvider>
    </ThemeProvider>,
  );
}
