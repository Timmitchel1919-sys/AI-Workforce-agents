import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthContext } from "../../auth/authContext";
import { ThemeProvider } from "../../theme";
import { ToastProvider } from "../../components/ui";
import { ShellProvider } from "../ShellProvider";
import { Sidebar } from "../Sidebar";
import { Topbar } from "../Topbar";
import { MobileNavigation } from "../MobileNavigation";
import { ControlCenterLayout } from "../ControlCenterLayout";
import { makeStubAuth } from "../../test/stubs";
import { NAV_ROUTES } from "../../app/routes";

function shell(ui: ReactElement, route = "/overview") {
  return render(
    <ThemeProvider>
      <AuthContext.Provider value={makeStubAuth()}>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>
            <ShellProvider>{ui}</ShellProvider>
          </MemoryRouter>
        </ToastProvider>
      </AuthContext.Provider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("Sidebar", () => {
  it("renders every nav route from the central config as a link", () => {
    shell(<Sidebar />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    for (const route of NAV_ROUTES) {
      expect(
        within(nav).getByRole("link", { name: route.label }),
      ).toHaveAttribute("href", route.path);
    }
    // grouped into Workspace + System sections
    expect(within(nav).getByText("Workspace")).toBeInTheDocument();
    expect(within(nav).getByText("System")).toBeInTheDocument();
  });

  it("marks the active route (nested routes keep the parent active)", () => {
    shell(<Sidebar />, "/tasks/task-123");
    const active = screen.getByRole("link", { name: "Tasks" });
    expect(active).toHaveClass("is-active");
    expect(active).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Agents" })).not.toHaveClass(
      "is-active",
    );
  });

  it("collapses and expands, persisting the preference", async () => {
    shell(<Sidebar />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toHaveAttribute("data-collapsed", "false");

    await userEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(nav).toHaveAttribute("data-collapsed", "true");
    expect(localStorage.getItem("ai-workforce.sidebar-state")).toBe(
      "collapsed",
    );
    // collapsed links keep an accessible name (icon-only)
    expect(
      within(nav).getByRole("link", { name: "Agents" }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(nav).toHaveAttribute("data-collapsed", "false");
  });

  it("nav links are keyboard reachable", async () => {
    shell(<Sidebar />);
    await userEvent.tab();
    // first focusable inside the sidebar is the first nav link
    expect(document.activeElement?.tagName).toBe("A");
  });
});

describe("MobileNavigation drawer", () => {
  it("opens from the topbar button, closes on Escape and after navigation", async () => {
    shell(
      <>
        <Topbar />
        <MobileNavigation />
      </>,
    );

    const open = screen.getByRole("button", { name: "Open navigation" });
    await userEvent.click(open);

    const drawer = await screen.findByRole("dialog");
    const mobileNav = within(drawer).getByRole("navigation", {
      name: "Primary (mobile)",
    });
    expect(
      within(mobileNav).getByRole("link", { name: "Workflows" }),
    ).toBeInTheDocument();

    // Escape closes
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // re-open, click a link → closes
    await userEvent.click(open);
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("link", { name: "Approvals" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Topbar", () => {
  it("renders global controls: search trigger, workspace context, theme, account", () => {
    shell(<Topbar />);
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
    expect(screen.getByText("All projects")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /theme:/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /account menu/i }),
    ).toBeInTheDocument();
  });

  it("account menu shows identity + role and a sign-out action", async () => {
    shell(<Topbar />);
    await userEvent.click(
      screen.getByRole("button", { name: /account menu/i }),
    );
    const menu = await screen.findByRole("menu");
    expect(menu).toHaveTextContent("operator@example.com");
    expect(menu).toHaveTextContent("Operator");
    expect(
      within(menu).getByRole("menuitem", { name: "Sign out" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Settings" }),
    ).toBeInTheDocument();
  });
});

describe("ControlCenterLayout", () => {
  it("renders the shell landmarks and the routed page in <main>", () => {
    shell(
      <Routes>
        <Route element={<ControlCenterLayout />}>
          <Route path="/overview" element={<p>overview body</p>} />
        </Route>
      </Routes>,
    );

    expect(screen.getByRole("banner")).toBeInTheDocument(); // <header> topbar
    expect(
      screen.getByRole("navigation", { name: "Primary" }),
    ).toBeInTheDocument();
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(within(main).getByText("overview body")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /skip to main content/i }),
    ).toHaveAttribute("href", "#main-content");
  });

  it("redirects to the auth boundary when unauthenticated", () => {
    render(
      <ThemeProvider>
        <AuthContext.Provider
          value={makeStubAuth({
            status: "unauthenticated",
            user: null,
            role: null,
          })}
        >
          <ToastProvider>
            <MemoryRouter initialEntries={["/overview"]}>
              <Routes>
                <Route path="/login" element={<p>login screen</p>} />
                <Route element={<ControlCenterLayout />}>
                  <Route path="/overview" element={<p>secret</p>} />
                </Route>
              </Routes>
            </MemoryRouter>
          </ToastProvider>
        </AuthContext.Provider>
      </ThemeProvider>,
    );
    expect(screen.getByText("login screen")).toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });
});
