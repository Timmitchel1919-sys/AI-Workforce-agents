import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../../auth/AuthProvider";
import { I18nProvider } from "../../../i18n/I18nProvider";
import LandingPage from "../LandingPage";

function renderLanding() {
  return render(
    <AuthProvider>
      <I18nProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </I18nProvider>
    </AuthProvider>,
  );
}

describe("Landing Page (v2)", () => {
  it("renders a single h1 and uses the primitives-based sections", () => {
    renderLanding();
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent(/coordinated workforce/i);
  });

  it("uses one fixed Dimensional Field across the full landing page", () => {
    const { container } = renderLanding();
    const fields = container.querySelectorAll(".lp-dimensional-background");

    expect(fields).toHaveLength(1);
    expect(fields[0]).toHaveClass("aw-bg");
    expect(fields[0]).toHaveAttribute("aria-hidden", "true");
    expect(fields[0]).toHaveStyle({ position: "fixed" });
    expect(container.querySelector("video.aw-bg-video")).toBeNull();
  });

  it("exposes a semantic nav, main, and footer", () => {
    renderLanding();
    expect(screen.getByRole("navigation", { name: /Primary/i })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("tabIndex", "-1");
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("links the primary CTAs to /login", () => {
    renderLanding();
    const loginLinks = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === "/login");
    // Nav sign-in, hero CTA, final CTA, footer sign-in.
    expect(loginLinks.length).toBeGreaterThanOrEqual(3);
  });

  it("does not expose a public signup affordance", () => {
    renderLanding();
    expect(
      screen.queryByRole("link", { name: /create account|sign ?up/i }),
    ).toBeNull();
  });

  it("renders the Command Center preview inline inside the hero", () => {
    const { container } = renderLanding();
    const hero = container.querySelector(".lp2-hero");
    const copy = hero?.querySelector(".lp2-hero-head");

    expect(screen.getByLabelText(/AI Workforce command preview/i)).toBeInTheDocument();
    expect(copy?.querySelector(".aw-section-eyebrow")).toHaveTextContent(/Private operating system/i);
    expect(copy?.querySelector(".lp2-hero-meta")).toHaveTextContent(/Private.*single-tenant/i);
  });

  it("renders each primary section by its id anchor", () => {
    const { container } = renderLanding();
    for (const id of ["capabilities", "workforce", "workflow", "security"]) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("exposes an accessible mobile menu control", () => {
    renderLanding();
    expect(screen.getByRole("button", { name: /Open menu/i })).toBeInTheDocument();
  });

  it("renders capabilities, departments, workflow, integrations, security, and projects content", () => {
    renderLanding();
    // Each has an aw-section-eyebrow or heading we can locate via the i18n copy.
    expect(screen.getByRole("heading", { level: 2, name: /operating system, not a chatbot/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Specialist departments/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /One pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Already speaks/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /operating system discipline/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Composable workspaces/i })).toBeInTheDocument();
  });

  it("renders the final CTA with Sign in", () => {
    renderLanding();
    const cta = screen.getByRole("heading", { level: 2, name: /Enter the Command Center/i });
    const section = cta.closest("section")!;
    expect(within(section).getByRole("link", { name: /Sign in/i })).toHaveAttribute("href", "/login");
  });
});
