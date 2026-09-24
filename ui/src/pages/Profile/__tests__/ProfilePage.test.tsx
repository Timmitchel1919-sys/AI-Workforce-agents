import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AccessState, AuthContextValue } from "../../../auth/auth.types";
import Sidebar from "../../../components/layout/Sidebar";
import { I18nProvider, LANGUAGE_STORAGE_KEY, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import SettingsPage from "../../Settings/SettingsPage";
import ProfilePage from "../ProfilePage";

vi.mock("../../../features/profile/resizeImage", () => ({
  AVATAR_SIZE: 256,
  resizeToAvatar: vi.fn(async () => "data:image/jpeg;base64,/9j/4AAQ"),
}));

const PHOTO = "data:image/jpeg;base64,/9j/4AAQ";

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockApi(initial: { avatarDataUrl?: string; putStatus?: number } = {}) {
  let avatar = initial.avatarDataUrl;
  const calls: { method: string; url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (url === "/api/me/profile/photo" && method === "PUT") {
        if (initial.putStatus) return respond(initial.putStatus, { error: { message: "bad" } });
        avatar = (JSON.parse(String(init?.body)) as { dataUrl: string }).dataUrl;
      }
      if (url === "/api/me/profile/photo" && method === "DELETE") avatar = undefined;
      if (url.startsWith("/api/me/profile")) {
        return respond(200, {
          operatorId: "op-1",
          displayName: "Ada",
          email: "ada@example.test",
          emailVerified: true,
          role: "operator",
          allowedProjects: ["alpha"],
          ...(avatar ? { avatarDataUrl: avatar } : {}),
        });
      }
      return respond(404, { error: { message: "not found" } });
    }),
  );
  return calls;
}

function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: { id: "op-1", email: "ada@example.test", displayName: "Ada" },
    loading: false,
    accessToken: "token",
    configured: true,
    access: "granted" as AccessState,
    accessDetails: { role: "operator", capabilities: ["view"] },
    signIn: vi.fn(),
    signUp: vi.fn(),
    sendPasswordReset: vi.fn(),
    refreshAccess: vi.fn(),
    getPasswordPolicy: vi.fn(),
    updateDisplayName: vi.fn(async () => {}),
    signOut: vi.fn(),
    ...overrides,
  };
}

function renderPage(node: React.ReactNode, { language, auth = authValue(), path = "/profile" }: { language?: Language; auth?: AuthContextValue; path?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage={language}>
        <authContext.Provider value={auth}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
              <Sidebar />
              {node}
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

describe("Profile", () => {
  it("shows the profile and preferences as separate cards with a back button", async () => {
    mockApi();
    renderPage(<ProfilePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Preferences" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "Profile" });
    expect(await within(card).findByText("Operator")).toBeInTheDocument();
    expect(within(card).getByText("ada@example.test")).toBeInTheDocument();
    // The role is shown, never editable.
    expect(within(card).queryByRole("combobox")).toBeNull();
  });

  it("uploads and removes a profile photo through the Control Plane only", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderPage(<ProfilePage />);

    const file = new File(["x"], "me.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Upload photo"), file);
    expect(await screen.findByText("Profile photo saved.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Profile photo of Ada" })).toHaveAttribute("src", PHOTO);
    expect(calls.find((c) => c.method === "PUT")).toEqual({ method: "PUT", url: "/api/me/profile/photo", body: { dataUrl: PHOTO } });

    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(await screen.findByText("Profile photo removed.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Profile photo of/ })).toBeNull();
    for (const call of calls) expect(call.url).toMatch(/^\/api\/me\/profile/);
  });

  it("reports a rejected photo", async () => {
    const user = userEvent.setup();
    mockApi({ putStatus: 400 });
    renderPage(<ProfilePage />);
    await user.upload(screen.getByLabelText("Upload photo"), new File(["x"], "me.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be saved/);
  });

  it("saves the display name via Firebase Auth", async () => {
    const user = userEvent.setup();
    mockApi();
    const auth = authValue();
    renderPage(<ProfilePage />, { auth });
    const input = screen.getByLabelText("Display name");
    await user.clear(input);
    await user.type(input, "Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(auth.updateDisplayName).toHaveBeenCalledWith("Ada Lovelace");
    expect(await screen.findByText("Display name saved.")).toBeInTheDocument();
  });

  it("switches theme immediately and persists it", async () => {
    const user = userEvent.setup();
    mockApi();
    renderPage(<ProfilePage />, { language: "en" });

    await user.click(screen.getByRole("radio", { name: /Dark/ }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("ai-workforce-theme")).toBe("dark");
    await user.click(screen.getByRole("radio", { name: /Light/ }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("switches language immediately (no reload) and persists it", async () => {
    const user = userEvent.setup();
    mockApi();
    renderPage(<ProfilePage />, { language: "en" });

    await user.selectOptions(screen.getByLabelText("Language"), "nl");
    expect(screen.getByRole("heading", { level: 1, name: "Profiel" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Voorkeuren" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Hoofdnavigatie" });
    expect(within(nav).getByText("Overzicht")).toBeInTheDocument();
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("nl");
    expect(document.documentElement.lang).toBe("nl");
    const options = within(screen.getByLabelText("Taal")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["English", "Nederlands"]);
  });

  it.each([
    ["light", "en", "Profile", "Preferences"],
    ["light", "nl", "Profiel", "Voorkeuren"],
    ["dark", "en", "Profile", "Preferences"],
    ["dark", "nl", "Profiel", "Voorkeuren"],
  ] as const)("works as %s + %s", async (theme, language, title, section) => {
    window.localStorage.setItem("ai-workforce-theme", theme);
    mockApi();
    renderPage(<ProfilePage />, { language });
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: section })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: new RegExp(theme === "light" ? "Light|Licht" : "Dark|Donker") })).toBeChecked();
    expect(document.body.textContent).not.toMatch(/\bprofile\.[a-zA-Z]+/);
  });
});

describe("Settings", () => {
  it("points to Profile → Preferences; Users & Access only for administrators", () => {
    renderPage(<SettingsPage />, { path: "/settings" });
    expect(screen.getByRole("link", { name: /Profile & preferences/ })).toHaveAttribute("href", "/profile#preferences");
    expect(screen.queryByRole("link", { name: /Users & Access/i })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("restores the saved language on the next start", () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "nl");
    renderPage(<SettingsPage />, { path: "/settings" });
    expect(screen.getByRole("heading", { level: 1, name: "Instellingen" })).toBeInTheDocument();
  });
});
