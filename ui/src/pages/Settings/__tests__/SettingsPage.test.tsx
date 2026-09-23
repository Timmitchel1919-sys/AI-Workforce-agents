import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { I18nProvider, LANGUAGE_STORAGE_KEY, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import Sidebar from "../../../components/layout/Sidebar";
import SettingsPage from "../SettingsPage";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

function renderApp(language?: Language) {
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage={language}>
        <MemoryRouter initialEntries={["/settings"]}>
          <Sidebar />
          <SettingsPage />
        </MemoryRouter>
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe("Settings → Appearance", () => {
  it("switches theme immediately and persists it", async () => {
    const user = userEvent.setup();
    renderApp("en");

    await user.click(screen.getByRole("radio", { name: /Dark/ }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("ai-workforce-theme")).toBe("dark");

    await user.click(screen.getByRole("radio", { name: /Light/ }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("ai-workforce-theme")).toBe("light");
  });

  it("switches language immediately (no reload) and persists it", async () => {
    const user = userEvent.setup();
    renderApp("en");

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Language"), "nl");

    expect(screen.getByRole("heading", { name: "Instellingen" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Weergave" })).toBeInTheDocument();
    // Navigation follows too.
    const nav = screen.getByRole("navigation", { name: "Hoofdnavigatie" });
    expect(within(nav).getByText("Overzicht")).toBeInTheDocument();
    expect(within(nav).getByText("Taken")).toBeInTheDocument();
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("nl");
    expect(document.documentElement.lang).toBe("nl");

    await user.selectOptions(screen.getByLabelText("Taal"), "en");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("names languages in their own language, not with flags", () => {
    renderApp("nl");
    const options = within(screen.getByLabelText("Taal")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["English", "Nederlands"]);
  });

  it("restores the saved language on the next start", () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "nl");
    renderApp();
    expect(screen.getByRole("heading", { name: "Instellingen" })).toBeInTheDocument();
  });

  it.each([
    ["light", "en", "Settings", "Appearance"],
    ["light", "nl", "Instellingen", "Weergave"],
    ["dark", "en", "Settings", "Appearance"],
    ["dark", "nl", "Instellingen", "Weergave"],
  ] as const)("works as %s + %s (theme and language are independent)", async (theme, language, title, section) => {
    window.localStorage.setItem("ai-workforce-theme", theme);
    renderApp(language);

    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: section })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: new RegExp(theme === "light" ? "Light|Licht" : "Dark|Donker") })).toBeChecked();
  });
});
