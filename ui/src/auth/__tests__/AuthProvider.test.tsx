import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../firebaseClient", () => ({
  getFirebaseAuth: () => {
    throw new Error("invalid Firebase configuration");
  },
}));

import { AuthProvider } from "../AuthProvider";
import { useAuth } from "../useAuth";

function AuthStateProbe() {
  const auth = useAuth();
  return <output>{`${auth.status}: ${auth.error ?? "none"}`}</output>;
}

describe("AuthProvider", () => {
  it("fails safely when Firebase Auth cannot be initialized", async () => {
    render(
      <AuthProvider>
        <AuthStateProbe />
      </AuthProvider>,
    );

    expect(
      await screen.findByText(
        "error: Authentication is not configured for this environment.",
      ),
    ).toBeInTheDocument();
  });
});
