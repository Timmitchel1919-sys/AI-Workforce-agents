import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AccessState, AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import SettingsPage from "../SettingsPage";
import UsersAccessPage from "../UsersAccessPage";

const ACCOUNTS = [
  {
    operatorId: "uid-new",
    email: "new@example.test",
    displayName: "New Person",
    emailVerified: false,
    status: "pending",
    allowedProjects: [],
    requestedAt: "2026-09-24T08:00:00.000Z",
    updatedAt: "2026-09-24T08:00:00.000Z",
    isSelf: false,
  },
  {
    operatorId: "uid-owner",
    email: "owner@example.test",
    displayName: "Owner",
    emailVerified: true,
    status: "active",
    role: "admin",
    allowedProjects: "*",
    requestedAt: "2026-09-23T08:00:00.000Z",
    updatedAt: "2026-09-23T08:00:00.000Z",
    isSelf: true,
  },
];

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function authValue(capabilities: readonly string[]): AuthContextValue {
  return {
    user: { id: "uid-owner", email: "owner@example.test", displayName: "Owner" },
    loading: false,
    accessToken: "token",
    configured: true,
    access: "granted" as AccessState,
    accessDetails: { role: "admin", capabilities },
    signIn: vi.fn(),
    signUp: vi.fn(),
    sendPasswordReset: vi.fn(),
    refreshAccess: vi.fn(),
    getPasswordPolicy: vi.fn(),
    signOut: vi.fn(),
  };
}

function renderWith(node: React.ReactNode, capabilities: readonly string[] = ["view", "manage_access"], language: Language = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage={language}>
        <authContext.Provider value={authValue(capabilities)}>
          <QueryClientProvider client={client}>
            <MemoryRouter>{node}</MemoryRouter>
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

describe("Settings → Users & Access", () => {
  it("lists pending and active users; the admin cannot act on their own account", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, ACCOUNTS)));
    renderWith(<UsersAccessPage />);

    const pending = await screen.findByRole("region", { name: /Pending access/i });
    expect(within(pending).getByText("New Person")).toBeInTheDocument();
    expect(within(pending).getByText("Email not verified", { exact: false })).toBeInTheDocument();
    const active = screen.getByRole("region", { name: /Active users/i });
    expect(within(active).getByText("You cannot change your own access.")).toBeInTheDocument();
    expect(within(active).queryByRole("button", { name: /Suspend access/i })).toBeNull();
  });

  it("approves with an explicitly chosen role and project scope via the Control Plane", async () => {
    const user = userEvent.setup();
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
        if (url.endsWith("/api/projects")) {
          return respond(200, [{ projectId: "alpha", displayName: "Alpha", status: "available" }]);
        }
        if (url.includes("/api/commands/")) return respond(200, { ok: true, outcome: "executed" });
        return respond(200, ACCOUNTS);
      }),
    );
    renderWith(<UsersAccessPage />);

    await user.click(await screen.findByRole("button", { name: /Approve access/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/This email address has not been verified/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: /^Operator/i }));
    await user.click(within(dialog).getByRole("checkbox", { name: /All projects/i }));
    await user.click(await within(dialog).findByRole("checkbox", { name: "Alpha" }));
    await user.click(within(dialog).getByRole("button", { name: /Approve access/i }));

    expect(await screen.findByText("Access updated.")).toBeInTheDocument();
    const command = calls.find((c) => c.url.endsWith("/api/commands/approve-access"));
    expect(JSON.parse(command!.body!)).toEqual({ operatorId: "uid-new", role: "operator", allowedProjects: ["alpha"] });
    // Same-origin Control Plane only — never Firestore.
    for (const call of calls) expect(call.url).toMatch(/^\/api\//);
  });

  it("shows an administrators-only state on 403 (not an empty list)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(403, { error: { message: "forbidden" } })));
    renderWith(<UsersAccessPage />);
    expect(await screen.findByText("Administrators only")).toBeInTheDocument();
    expect(screen.queryByText("No pending access requests.")).toBeNull();
  });

  it("works in Dutch and the dark theme", async () => {
    window.localStorage.setItem("ai-workforce-theme", "dark");
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, ACCOUNTS)));
    renderWith(<UsersAccessPage />, ["view", "manage_access"], "nl");
    expect(await screen.findByRole("heading", { name: "Gebruikers & Toegang" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: /Wacht op toegang/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Toegang goedkeuren/i })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("links from Settings only for administrators", () => {
    const { unmount } = renderWith(<SettingsPage />, ["view", "manage_access"]);
    expect(screen.getByRole("link", { name: /Manage users and access/i })).toHaveAttribute("href", "/settings/access");
    unmount();
    renderWith(<SettingsPage />, ["view", "approve"]);
    expect(screen.queryByRole("link", { name: /Manage users and access/i })).toBeNull();
  });
});
