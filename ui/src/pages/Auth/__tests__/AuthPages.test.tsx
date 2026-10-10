import { useMemo, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AccessState, AuthContextValue, AuthUser } from "../../../auth/auth.types";
import { RequireAuth } from "../../../auth/RequireAuth";
import { safeRedirectPath } from "../../../auth/redirect";
import AuthLayout from "../AuthLayout";
import LoginPage from "../LoginPage";
import SignupPage from "../SignupPage";

// Reduced motion → the "access granted" transition navigates immediately.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

const TEST_USER: AuthUser = { id: "u1", email: "tim@example.com", displayName: null };

interface HarnessOptions {
  path: string;
  user?: AuthUser | null;
  access?: AccessState;
  configured?: boolean;
  signIn?: (email: string, password: string, remember: boolean) => Promise<AccessState>;
  signUp?: AuthContextValue["signUp"];
  sendPasswordReset?: AuthContextValue["sendPasswordReset"];
  refreshAccess?: () => Promise<AccessState>;
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function Harness(options: HarnessOptions) {
  const [session, setSession] = useState({
    user: options.user ?? null,
    access: options.access ?? ("none" as AccessState),
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session.user,
      access: session.access,
      accessDetails: { capabilities: [] },
      loading: false,
      accessToken: session.user ? "token" : null,
      configured: options.configured ?? true,
      signIn: async (email, password, remember) => {
        const access = await (options.signIn ?? (async () => "granted" as const))(email, password, remember);
        setSession({ user: { ...TEST_USER, email }, access });
        return access;
      },
      signUp: async (input) => {
        const access = await (options.signUp ?? (async () => "pending" as const))(input);
        setSession({ user: { ...TEST_USER, email: input.email }, access });
        return access;
      },
      sendPasswordReset: options.sendPasswordReset ?? (async () => {}),
      refreshAccess: async () => {
        const next = await (options.refreshAccess ?? (async () => session.access))();
        setSession((current) => ({ ...current, access: next }));
        return next;
      },
      getPasswordPolicy: async () => ({
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireNumber: true,
        requireSymbol: false,
        source: "project",
      }),
      signOut: async () => setSession({ user: null, access: "none" }),
    }),
    [session, options],
  );

  return (
    <authContext.Provider value={value}>
      <MemoryRouter initialEntries={[options.path]}>
        <Routes>
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
          </Route>
          <Route
            path="/overview"
            element={
              <RequireAuth>
                <p>Control Center</p>
              </RequireAuth>
            }
          />
          <Route
            path="/workflows"
            element={
              <RequireAuth>
                <p>Workflows module</p>
              </RequireAuth>
            }
          />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </authContext.Provider>
  );
}

describe("Login", () => {
  it("renders the secure sign-in form without decorative OAuth buttons or role fields", () => {
    render(<Harness path="/login" />);

    expect(screen.getByRole("heading", { name: /Welcome back/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Email address/i)).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText(/^Password$/i)).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: /Enter Workforce/i })).toBeInTheDocument();
    expect(screen.queryByText(/Google|Microsoft|GitHub|Apple/i)).toBeNull();
    expect(screen.queryByLabelText(/role/i)).toBeNull();
  });

  it("validates accessibly and moves focus to the first invalid field", async () => {
    const user = userEvent.setup();
    render(<Harness path="/login" />);

    await user.click(screen.getByRole("button", { name: /Enter Workforce/i }));

    const email = screen.getByLabelText(/Email address/i);
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Enter a valid email address.");
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    await waitFor(() => expect(email).toHaveFocus());
  });

  it("toggles password visibility", async () => {
    const user = userEvent.setup();
    render(<Harness path="/login" />);

    const password = screen.getByLabelText(/^Password$/i);
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: /Show password/i }));
    expect(password).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: /Hide password/i }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("signs in with the keyboard and returns to the safe intended destination", async () => {
    const user = userEvent.setup();
    const signIn = vi.fn(async () => "granted" as const);
    render(<Harness path="/login?next=%2Fworkflows" signIn={signIn} />);

    await user.type(screen.getByLabelText(/Email address/i), "tim@example.com");
    await user.type(screen.getByLabelText(/^Password$/i), "correct horse{Enter}");

    expect(signIn).toHaveBeenCalledWith("tim@example.com", "correct horse", true);
    expect(await screen.findByText("Workflows module")).toBeInTheDocument();
  });

  it("shows a safe, generic message on failure and never the raw provider error", async () => {
    const user = userEvent.setup();
    const signIn = vi.fn(async () => {
      throw Object.assign(new Error("Firebase: Error (auth/invalid-credential)."), {
        code: "auth/invalid-credential",
      });
    });
    render(<Harness path="/login" signIn={signIn} />);

    await user.type(screen.getByLabelText(/Email address/i), "tim@example.com");
    await user.type(screen.getByLabelText(/^Password$/i), "wrong");
    await user.click(screen.getByRole("button", { name: /Enter Workforce/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(screen.queryByText(/auth\/|Firebase:/)).toBeNull();
    expect(screen.getByTestId("location")).toHaveTextContent("/login");
  });

  it("prevents duplicate submissions while a sign-in is in flight", async () => {
    const user = userEvent.setup();
    let resolve!: (value: AccessState) => void;
    const signIn = vi.fn(() => new Promise<AccessState>((r) => (resolve = r)));
    render(<Harness path="/login" signIn={signIn} />);

    await user.type(screen.getByLabelText(/Email address/i), "tim@example.com");
    await user.type(screen.getByLabelText(/^Password$/i), "secret");
    const submit = screen.getByRole("button", { name: /Enter Workforce/i });
    await user.click(submit);
    expect(screen.getByRole("button", { name: /Verifying/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Verifying/i }));
    expect(signIn).toHaveBeenCalledTimes(1);
    resolve("granted");
    expect(await screen.findByText("Control Center")).toBeInTheDocument();
  });

  it("shows the pending-access state when the account has no role claim", async () => {
    const user = userEvent.setup();
    render(<Harness path="/login" signIn={async () => "pending"} />);

    await user.type(screen.getByLabelText(/Email address/i), "tim@example.com");
    await user.type(screen.getByLabelText(/^Password$/i), "secret{Enter}");

    expect(await screen.findByRole("heading", { name: /Awaiting access/i })).toBeInTheDocument();
    // Masked, not the full address.
    expect(screen.getByText(/t•+@example\.com/)).toBeInTheDocument();
    expect(screen.queryByText("Control Center")).toBeNull();
  });

  it("sends a password reset with a response that does not reveal account existence", async () => {
    const user = userEvent.setup();
    const sendPasswordReset = vi.fn(async () => {});
    render(<Harness path="/login" sendPasswordReset={sendPasswordReset} />);

    await user.click(screen.getByRole("button", { name: /Forgot password/i }));
    await user.type(screen.getByLabelText(/Email address/i), "someone@example.com");
    await user.click(screen.getByRole("button", { name: /Send reset link/i }));

    expect(sendPasswordReset).toHaveBeenCalledWith("someone@example.com");
    expect(await screen.findByText(/If an account exists for that address/i)).toBeInTheDocument();
  });

  it("redirects an already-authenticated user straight to the Control Center", async () => {
    render(<Harness path="/login" user={TEST_USER} access="granted" />);
    expect(await screen.findByText("Control Center")).toBeInTheDocument();
  });
});

describe("Sign up", () => {
  it("shows only the enforced password requirements and validates locally", async () => {
    const user = userEvent.setup();
    const signUp = vi.fn(async () => "pending" as const);
    render(<Harness path="/signup" signUp={signUp} />);

    expect(await screen.findByText("At least 8 characters")).toBeInTheDocument();
    expect(screen.getByText("A number")).toBeInTheDocument();
    expect(screen.queryByText(/uppercase/i)).toBeNull();

    await user.type(screen.getByLabelText(/Email address/i), "new@example.com");
    await user.type(screen.getByLabelText(/^Password$/i), "longpassword1");
    await user.type(screen.getByLabelText(/Confirm password/i, { selector: "input" }), "different1");
    await user.click(screen.getByRole("button", { name: /Create account/i }));

    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("creates an account without sending any role and shows the pending state", async () => {
    const user = userEvent.setup();
    const signUp = vi.fn(async () => "pending" as const);
    render(<Harness path="/signup" signUp={signUp} />);

    await user.type(screen.getByLabelText(/Full name/i), "Tim");
    await user.type(screen.getByLabelText(/Email address/i), "new@example.com");
    await user.type(screen.getByLabelText(/^Password$/i), "longpassword1");
    await user.type(screen.getByLabelText(/Confirm password/i, { selector: "input" }), "longpassword1");
    await user.click(screen.getByRole("button", { name: /Create account/i }));

    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
    const [input] = signUp.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(Object.keys(input).sort()).toEqual(["displayName", "email", "password"]);
    expect(await screen.findByText(/Account created/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Awaiting access/i })).toBeInTheDocument();
  });

  it("does not confirm whether an email is already registered", async () => {
    const user = userEvent.setup();
    const signUp = vi.fn(async () => {
      throw Object.assign(new Error("exists"), { code: "auth/email-already-in-use" });
    });
    render(<Harness path="/signup" signUp={signUp} />);

    await user.type(screen.getByLabelText(/Email address/i), "taken@example.com");
    await user.type(screen.getByLabelText(/^Password$/i), "longpassword1");
    await user.type(screen.getByLabelText(/Confirm password/i, { selector: "input" }), "longpassword1");
    await user.click(screen.getByRole("button", { name: /Create account/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't create an account with these details/i);
    expect(alert).not.toHaveTextContent(/already in use|already registered|exists/i);
  });

  it("switches between sign-in and sign-up within the same gateway", async () => {
    const user = userEvent.setup();
    render(<Harness path="/login" />);

    await user.click(screen.getByRole("link", { name: /Create account/i }));
    expect(screen.getByRole("heading", { name: /Create your account/i })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /Sign in/i }));
    expect(screen.getByRole("heading", { name: /Welcome back/i })).toBeInTheDocument();
  });
});

describe("Protected routes", () => {
  it("sends unauthenticated users to login with the intended destination", async () => {
    render(<Harness path="/workflows" />);
    expect(await screen.findByRole("heading", { name: /Welcome back/i })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/login?next=%2Fworkflows");
  });

  it("does not admit a signed-in user without an assigned role", async () => {
    render(<Harness path="/overview" user={TEST_USER} access="pending" />);
    expect(await screen.findByRole("heading", { name: /Awaiting access/i })).toBeInTheDocument();
    expect(screen.queryByText("Control Center")).toBeNull();
  });

  it("keeps the development pass-through when Firebase is not configured", () => {
    render(<Harness path="/overview" configured={false} />);
    expect(screen.getByText("Control Center")).toBeInTheDocument();
  });
});

describe("safeRedirectPath", () => {
  it.each([
    [null, "/overview"],
    ["https://evil.example/phish", "/overview"],
    ["//evil.example", "/overview"],
    ["/\\evil.example", "/overview"],
    ["javascript:alert(1)", "/overview"],
    ["/login?next=/login", "/overview"],
    ["/", "/overview"],
    ["/workflows/wf-1?tab=stages#top", "/workflows/wf-1?tab=stages#top"],
  ])("maps %s to %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });
});

describe("Awaiting access states (AUTHZ-1)", () => {
  it.each([
    ["rejected", /Access request declined/i],
    ["suspended", /Access suspended/i],
    ["revoked", /Access revoked/i],
    ["unavailable", /Access could not be checked/i],
  ] as const)("shows the %s state from the Control Plane, never the Control Center", async (access, title) => {
    render(<Harness path="/overview" user={TEST_USER} access={access} />);
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.queryByText("Control Center")).toBeNull();
  });

  it("does not claim the identity is verified", async () => {
    render(<Harness path="/login" user={TEST_USER} access="pending" />);
    expect(await screen.findByRole("heading", { name: /Awaiting access/i })).toBeInTheDocument();
    expect(screen.queryByText(/identity is verified/i)).toBeNull();
  });

  it("Check access again stays pending until the backend grants, then enters", async () => {
    const user = userEvent.setup();
    const answers: AccessState[] = ["pending", "granted"];
    const refreshAccess = vi.fn(async () => answers.shift() ?? "granted");
    render(<Harness path="/login?next=%2Fworkflows" user={TEST_USER} access="pending" refreshAccess={refreshAccess} />);

    await user.click(await screen.findByRole("button", { name: /Check access again/i }));
    expect(await screen.findByText(/No access has been granted yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Workflows module")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Check access again/i }));
    expect(await screen.findByText("Workflows module")).toBeInTheDocument();
    expect(refreshAccess).toHaveBeenCalledTimes(2);
  });
});
