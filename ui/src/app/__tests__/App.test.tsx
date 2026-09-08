import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../AppRoutes";
import { makeQueryClient } from "../providers/queryClient";
import { AuthContext } from "../../auth/authContext";
import { ApiContext } from "../providers/apiContext";
import { makeStubApiClient, makeStubAuth } from "../../test/stubs";

describe("App composition", () => {
  it("mounts the route tree inside the app providers without crashing", () => {
    const queryClient = makeQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={makeStubAuth()}>
          <ApiContext.Provider value={makeStubApiClient()}>
            <MemoryRouter initialEntries={["/overview"]}>
              <AppRoutes />
            </MemoryRouter>
          </ApiContext.Provider>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: /AI Workforce Control Center/i }),
    ).toBeInTheDocument();
    // the authenticated shell rendered (primary sidebar nav present)
    expect(
      screen.getByRole("navigation", { name: "Primary" }),
    ).toBeInTheDocument();
  });

  it("query provider defaults are configured", () => {
    const qc = makeQueryClient();
    const defaults = qc.getDefaultOptions();
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.queries?.retry).toBe(1);
  });
});
