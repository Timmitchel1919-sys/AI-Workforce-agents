import { describe, expect, it } from "vitest";
import { allowsRole } from "../roleAccess";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { authContext } from "../authContext";
import { RequireRole } from "../RequireRole";
import { I18nProvider } from "../../i18n";
import type { AuthContextValue } from "../auth.types";
import { createElement } from "react";

describe("role-aware route discovery", () => {
  it("keeps admin surfaces unavailable to viewer and operator roles", () => {
    expect(allowsRole("viewer", "admin")).toBe(false);
    expect(allowsRole("operator", "admin")).toBe(false);
    expect(allowsRole(undefined, "admin")).toBe(false);
    expect(allowsRole("admin", "admin")).toBe(true);
  });

  it("uses an ordered role hierarchy only for UI discovery", () => {
    expect(allowsRole("admin", "operator")).toBe(true);
    expect(allowsRole("operator", "viewer")).toBe(true);
    expect(allowsRole("viewer", "operator")).toBe(false);
  });
});

const authValue = (patch: Partial<AuthContextValue>): AuthContextValue => ({
  user: null,
  loading: false,
  accessToken: null,
  configured: true,
  access: "none",
  accessDetails: { capabilities: [] },
  signIn: async () => "none",
  signUp: async () => "none",
  sendPasswordReset: async () => {},
  refreshAccess: async () => "none",
  getPasswordPolicy: async () => ({ minLength: 6, requireLowercase: false, requireUppercase: false, requireNumber: false, requireSymbol: false, source: "default" }),
  signOut: async () => {},
  ...patch,
});

function renderGuard(value: AuthContextValue) {
  render(createElement(
    I18nProvider,
    { initialLanguage: "en" },
    createElement(
      authContext.Provider,
      { value },
      createElement(
        MemoryRouter,
        null,
        createElement(RequireRole, { role: "admin" }, createElement("p", null, "Admin content")),
      ),
    ),
  ));
}

describe("RequireRole fail-closed behavior", () => {
  it("does not render protected content without auth configuration", () => {
    renderGuard(authValue({ configured: false }));
    expect(screen.getByRole("heading", { name: /Secure access unavailable/i })).toBeInTheDocument();
    expect(screen.queryByText("Admin content")).toBeNull();
  });

  it("permits only an explicit development demo bypass", () => {
    renderGuard(authValue({ configured: false, demoMode: true }));
    expect(screen.getByText("Admin content")).toBeInTheDocument();
  });

  it("blocks a configured non-admin role", () => {
    renderGuard(authValue({ accessDetails: { role: "operator", capabilities: [] } }));
    expect(screen.getByRole("heading", { name: /Access restricted/i })).toBeInTheDocument();
    expect(screen.queryByText("Admin content")).toBeNull();
  });
});
