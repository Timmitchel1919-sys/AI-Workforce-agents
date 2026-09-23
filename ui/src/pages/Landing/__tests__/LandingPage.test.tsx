import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LandingPage from "../LandingPage";
import { agentDepartments, environments } from "../landingContent";

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe("Landing Page", () => {
  it("renders the hero with the brand logo and primary actions", () => {
    renderLanding();

    expect(screen.getByRole("heading", { level: 1, name: /AI Workforce/i })).toBeInTheDocument();
    expect(screen.getByAltText(/AI Workforce logo/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Enter Workforce/i })).toHaveAttribute(
      "href",
      "/overview",
    );
    expect(screen.getAllByRole("link", { name: /Explore System/i })[0]).toHaveAttribute(
      "href",
      "#system",
    );
  });

  it("links every Control Center entry point to the existing app route", () => {
    renderLanding();

    for (const name of [/Enter OS/i, /Enter AI Workforce/i]) {
      for (const link of screen.getAllByRole("link", { name })) {
        expect(link).toHaveAttribute("href", "/overview");
      }
    }
  });

  it("renders every section anchor used by the navigation", () => {
    const { container } = renderLanding();

    for (const id of ["system", "capabilities", "architecture", "security"]) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("never presents an environment as available without live detection", () => {
    expect(environments.some((environment) => environment.status === "available")).toBe(false);

    renderLanding();
    const section = screen.getByRole("heading", { name: /Build without environment limits/i })
      .closest("section") as HTMLElement;
    expect(within(section).queryByText(/^Available$/)).toBeNull();
    for (const environment of environments) {
      expect(within(section).getByText(environment.name)).toBeInTheDocument();
    }
  });

  it("labels agents by implementation status", () => {
    renderLanding();

    const registered = agentDepartments.filter((agent) => agent.status === "registered");
    expect(registered.map((agent) => agent.id)).toEqual(["cpa"]);
    expect(screen.getByText("Control Plane Analysis")).toBeInTheDocument();
    expect(screen.getAllByText("Planned").length).toBeGreaterThan(0);
  });
});
