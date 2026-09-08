import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { AppRoutes } from "../AppRoutes";
import { renderWithProviders } from "../../test/renderWithProviders";

const ROUTES: Array<[string, RegExp]> = [
  ["/overview", /AI Workforce Control Center/i],
  ["/agents", /^Agents$/],
  ["/tasks", /^Tasks$/],
  ["/workflows", /^Workflows$/],
  ["/projects", /^Projects$/],
  ["/approvals", /^Approvals$/],
  ["/audit", /Audit Log/i],
  ["/knowledge", /^Knowledge$/],
  ["/settings", /^Settings$/],
];

describe("routing", () => {
  for (const [path, heading] of ROUTES) {
    it(`renders ${path}`, () => {
      renderWithProviders(<AppRoutes />, { route: path });
      expect(
        screen.getByRole("heading", { name: heading }),
      ).toBeInTheDocument();
    });
  }

  it("renders a detail route with its id", () => {
    renderWithProviders(<AppRoutes />, { route: "/agents/agent-42" });
    expect(screen.getByText(/agent-42/)).toBeInTheDocument();
  });

  it("renders the index redirect to /overview", () => {
    renderWithProviders(<AppRoutes />, { route: "/" });
    expect(
      screen.getByRole("heading", { name: /AI Workforce Control Center/i }),
    ).toBeInTheDocument();
  });

  it("unknown route → 404", () => {
    renderWithProviders(<AppRoutes />, { route: "/no-such-page" });
    expect(screen.getByText(/page not found/i)).toBeInTheDocument();
  });

  it("redirects to /login when unauthenticated", () => {
    renderWithProviders(<AppRoutes />, {
      route: "/agents",
      auth: { status: "unauthenticated", user: null, role: null },
    });
    expect(screen.getByText(/Operator sign-in/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it("shows a full-page loader while auth is loading (no dashboard flash)", () => {
    renderWithProviders(<AppRoutes />, {
      route: "/overview",
      auth: { status: "loading", user: null, role: null },
    });
    expect(screen.queryByText(/System health/i)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
