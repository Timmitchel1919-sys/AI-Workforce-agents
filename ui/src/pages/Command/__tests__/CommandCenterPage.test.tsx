import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import { interpretCommand } from "../../../features/commandCenter/commandIntents";
import { SessionSecurityCard } from "../../Profile/SessionSecurityCard";
import CommandCenterPage from "../CommandCenterPage";

const PROJECTS = [{ projectId: "ai-workforce", displayName: "AI Workforce" }];

describe("interpretCommand", () => {
  it("maps read requests to navigation, matching exactly", () => {
    expect(interpretCommand("show pending approvals", PROJECTS)).toEqual({ kind: "navigate", intent: "show_approvals", to: "/approvals" });
    expect(interpretCommand("Which agents are working right now?", PROJECTS)).toMatchObject({ intent: "show_agents" });
    expect(interpretCommand("show today's costs", PROJECTS)).toMatchObject({ intent: "show_costs" });
    expect(interpretCommand("toon openstaande goedkeuringen", PROJECTS)).toMatchObject({ intent: "show_approvals" });
    expect(interpretCommand("open my project ai-workforce", PROJECTS)).toMatchObject({ kind: "open_project", to: "/projects/ai-workforce" });
    expect(interpretCommand("open project AI Workforce", PROJECTS)).toMatchObject({ kind: "open_project", projectId: "ai-workforce" });
    expect(interpretCommand("open project secret-other", PROJECTS)).toEqual({ kind: "project_not_found", query: "secret-other" });
    expect(interpretCommand("sing me a song", PROJECTS)).toEqual({ kind: "no_match" });
  });

  it("never turns a high-impact phrase into an action", () => {
    for (const phrase of [
      "start the approved test pipeline",
      "deploy to production",
      "merge the pull request",
      "delete the project",
      "approve everything",
      "rollback the release",
      "rol uit naar productie",
    ]) {
      expect(interpretCommand(phrase, PROJECTS)).toMatchObject({ kind: "requires_approval", to: "/approvals" });
    }
    expect(interpretCommand("show the latest pull request", PROJECTS)).toEqual({ kind: "unsupported_pull_requests" });
  });
});

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function authWith(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: { id: "op-1", email: "op@example.test", displayName: "Op" },
    loading: false,
    accessToken: "token",
    configured: true,
    access: "granted",
    accessDetails: { role: "admin", capabilities: ["view"] },
    signIn: vi.fn(),
    signUp: vi.fn(),
    sendPasswordReset: vi.fn(),
    refreshAccess: vi.fn(),
    getPasswordPolicy: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AuthContextValue;
}

function renderWith(node: React.ReactNode, auth = authWith(), path = "/x") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage="en">
        <authContext.Provider value={auth}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route path={path} element={node} />
                <Route path="/overview" element={<p>overview page</p>} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </authContext.Provider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("CommandCenterPage", () => {
  it("shows the interpreted request and routes high-impact commands to approvals without calling any command API", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/projects" ? respond(200, [{ projectId: "ai-workforce", displayName: "AI Workforce", status: "active" }]) : respond(404, {}),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWith(<CommandCenterPage />);
    await user.type(screen.getByLabelText("Command"), "deploy to production");
    await user.click(screen.getByRole("button", { name: /interpret/i }));
    expect(await screen.findByText(/never started from a typed or spoken command/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/approvals");
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/commands/"))).toBe(false);
  });
});

describe("SessionSecurityCard", () => {
  it("revokes every session server-side, then signs out locally", async () => {
    const fetchMock = vi.fn(async () => respond(200, { sessionsValidAfter: 1, refreshTokensRevoked: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const auth = authWith();
    const user = userEvent.setup();
    renderWith(<SessionSecurityCard />, auth);
    await user.click(screen.getByRole("button", { name: "Sign out all devices" }));
    expect(await screen.findByText(/All devices are signed out/)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/me/sessions/revoke");
    expect(init.method).toBe("POST");
    await vi.waitFor(() => expect(auth.signOut).toHaveBeenCalled(), { timeout: 3000 });
    expect(screen.getByText(/cannot wipe data from a lost phone/i)).toBeInTheDocument();
  });
});
