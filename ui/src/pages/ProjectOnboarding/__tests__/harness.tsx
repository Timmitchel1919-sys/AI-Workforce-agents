import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AccessState, AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import ProjectsPage from "../../Projects/ProjectsPage";
import NewProjectPage from "../NewProjectPage";
import OnboardingPage from "../OnboardingPage";
import type { OnboardingSession } from "../../../features/projectOnboarding/types";
import { CAPABILITIES } from "../../../features/projectOnboarding/__tests__/fixtures";

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function commandOk(session: OnboardingSession) {
  return json(200, { ok: true, outcome: "executed", correlationId: "c1", details: { session } });
}

function authValue(): AuthContextValue {
  return {
    user: { id: "u1", email: "op@example.test", displayName: "Op" },
    loading: false,
    accessToken: "token",
    configured: true,
    access: "granted" as AccessState,
    accessDetails: { role: "operator", capabilities: ["view"] },
    signIn: vi.fn(), signUp: vi.fn(), sendPasswordReset: vi.fn(), refreshAccess: vi.fn(),
    getPasswordPolicy: vi.fn(), signOut: vi.fn(),
  };
}

export interface Call { url: string; method: string; body?: Record<string, unknown> }

/** Route-aware fetch stub. `commands` maps a command name to its response (or a function). */
export function stubApi(opts: {
  capabilities?: unknown;
  capabilitiesStatus?: number;
  sessions?: unknown[];
  session?: () => OnboardingSession;
  commands?: Record<string, () => Response | Promise<Response>>;
}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, method, ...(body ? { body } : {}) });
    if (url.endsWith("/api/onboarding/capabilities")) return json(opts.capabilitiesStatus ?? 200, opts.capabilities ?? CAPABILITIES);
    if (url.endsWith("/api/onboarding")) return json(200, { sessions: opts.sessions ?? [] });
    if (/\/api\/onboarding\/[^/]+$/.test(url) && opts.session) return json(200, opts.session());
    const command = /\/api\/commands\/(\w+)$/.exec(url)?.[1];
    if (command && opts.commands?.[command]) return opts.commands[command]();
    if (url.endsWith("/api/projects")) return json(200, []);
    return json(404, { message: "not found" });
  }));
  return calls;
}

export function renderAt(path: string, language: Language = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage={language}>
        <authContext.Provider value={authValue()}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/new" element={<NewProjectPage />} />
                <Route path="/projects/onboarding/:onboardingId" element={<OnboardingPage />} />
                <Route path="/projects/:projectId" element={<div>PROJECT CONTROL CENTER</div>} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </authContext.Provider>
      </I18nProvider>
    </ThemeProvider>,
  );
}
