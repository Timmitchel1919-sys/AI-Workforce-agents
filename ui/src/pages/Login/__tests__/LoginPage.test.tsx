import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "../../../theme";
import { AuthContext } from "../../../auth/authContext";
import { LoginPage } from "../index";
import { makeStubAuth } from "../../../test/stubs";
import type { AuthSession } from "../../../auth/auth.types";

function renderLogin(overrides: Partial<AuthSession> = {}) {
  return render(
    <ThemeProvider>
      <AuthContext.Provider
        value={makeStubAuth({ status: "unauthenticated", ...overrides })}
      >
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </ThemeProvider>,
  );
}

describe("LoginPage", () => {
  it("offers Google sign-in and delegates it to the Firebase auth boundary", async () => {
    const signInWithGoogle = vi.fn(async () => {});
    renderLogin({ signInWithGoogle });

    await userEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/administrator-provisioned operator role/i),
    ).toBeInTheDocument();
  });

  it("shows a safe error when Google sign-in cannot complete", async () => {
    renderLogin({
      signInWithGoogle: vi.fn(async () => {
        throw new Error("Google sign-in was cancelled.");
      }),
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    expect(await screen.findByText("Sign-in failed")).toBeInTheDocument();
    expect(
      screen.getByText("Google sign-in was cancelled."),
    ).toBeInTheDocument();
  });
});
