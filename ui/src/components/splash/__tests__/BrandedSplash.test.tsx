import { render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AccessState, AuthContextValue, AuthUser } from "../../../auth/auth.types";
import { BrandedSplash } from "../BrandedSplash";
import { resolveDestination } from "../initialization";

const USER: AuthUser = { id: "u1", email: "op@example.com", displayName: null };

function setReducedMotion(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: null,
    loading: false,
    accessToken: null,
    configured: true,
    access: "none" as AccessState,
    signIn: vi.fn(),
    signUp: vi.fn(),
    sendPasswordReset: vi.fn(),
    refreshAccess: vi.fn(),
    getPasswordPolicy: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
  };
}

function renderSplash(props: Partial<Parameters<typeof BrandedSplash>[0]> = {}, auth = authValue()) {
  const onFinished = vi.fn();
  const navigate = vi.fn();
  const loadChunk = vi.fn(async () => {});
  const checkControlPlane = vi.fn(async () => true);
  const utils = render(
    <authContext.Provider value={auth}>
      <BrandedSplash
        onFinished={onFinished}
        navigate={navigate}
        pathname="/"
        loadChunk={loadChunk}
        checkControlPlane={checkControlPlane}
        minDisplayMs={0}
        {...props}
      />
    </authContext.Provider>,
  );
  return { ...utils, onFinished, navigate, loadChunk, checkControlPlane };
}

beforeEach(() => setReducedMotion(false));

describe("BrandedSplash", () => {
  it("renders the 3D emblem (front, back, extrusion, side) and accessible progress", () => {
    renderSplash({ loadChunk: () => new Promise(() => {}) });

    const logo = screen.getByTestId("splash-logo");
    expect(logo.querySelector(".splash-logo__spinner")).not.toHaveClass("is-still");
    expect(logo.querySelector(".splash-logo__face--front img")).toHaveAttribute("alt", expect.stringMatching(/AI Workforce logo/));
    expect(logo.querySelector(".splash-logo__face--back")).not.toBeNull();
    expect(logo.querySelectorAll(".splash-logo__slice").length).toBeGreaterThan(8);
    expect(logo.querySelectorAll(".splash-logo__side")).toHaveLength(2);
    expect(screen.getByRole("progressbar", { name: /Initialization progress/i })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /AI Workforce is starting/i })).toHaveAttribute("aria-busy", "true");
  });

  it("reports real stages and finishes once the destination module is ready", async () => {
    const { onFinished, loadChunk } = renderSplash();

    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(loadChunk).toHaveBeenCalledWith("landing");
    expect(screen.getByText("Connects after sign-in")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("respects the minimum display duration on fast loads", async () => {
    const { onFinished } = renderSplash({ minDisplayMs: 400 });

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(onFinished).not.toHaveBeenCalled();
    await waitFor(() => expect(onFinished).toHaveBeenCalled(), { timeout: 3000 });
  });

  it("sends an authorized user from / to the Control Center and checks the Control Plane", async () => {
    const auth = authValue({ user: USER, access: "granted", accessToken: "token" });
    const { onFinished, navigate, loadChunk, checkControlPlane } = renderSplash({}, auth);

    await waitFor(() => expect(onFinished).toHaveBeenCalled(), { timeout: 3000 });
    expect(loadChunk).toHaveBeenCalledWith("controlCenter");
    expect(checkControlPlane).toHaveBeenCalledWith("token");
    expect(navigate).toHaveBeenCalledWith("/overview");
  });

  it("continues in a degraded state when the Control Plane is unreachable", async () => {
    const auth = authValue({ user: USER, access: "granted", accessToken: "token" });
    const { onFinished } = renderSplash(
      { checkControlPlane: vi.fn(async () => { throw new Error("offline"); }) },
      auth,
    );

    expect(await screen.findByText(/Unreachable — continuing/i)).toBeInTheDocument();
    expect(screen.getByText("Limited connectivity")).toBeInTheDocument();
    await waitFor(() => expect(onFinished).toHaveBeenCalled(), { timeout: 3000 });
  });

  it("shows a recoverable error instead of initializing forever when the interface fails to load", async () => {
    const { onFinished } = renderSplash({ loadChunk: vi.fn(async () => { throw new Error("chunk"); }) });

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not start/i);
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("never traps the user when a dependency hangs (hard ceiling)", async () => {
    const { onFinished } = renderSplash({ loadChunk: () => new Promise(() => {}), maxWaitMs: 80 });
    await waitFor(() => expect(onFinished).toHaveBeenCalled(), { timeout: 3000 });
  });

  it("uses a static front-facing emblem with reduced motion", async () => {
    setReducedMotion(true);
    const { container, onFinished } = renderSplash();

    expect(container.querySelector(".splash-logo__spinner")).toHaveClass("is-still");
    expect(container.querySelector(".splash")).toHaveClass("is-reduced");
    await waitFor(() => expect(onFinished).toHaveBeenCalled(), { timeout: 3000 });
  });

  it("cleans up timers on unmount", async () => {
    const { unmount, onFinished } = renderSplash({ minDisplayMs: 200 });
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(onFinished).not.toHaveBeenCalled();
  });
});

describe("resolveDestination", () => {
  const base = { configured: true, user: null, access: "none" as AccessState };

  it.each([
    [{ ...base, pathname: "/" }, { redirectTo: null, chunk: "landing" }],
    [{ ...base, pathname: "/", user: USER, access: "granted" as AccessState }, { redirectTo: "/overview", chunk: "controlCenter" }],
    [{ ...base, pathname: "/login" }, { redirectTo: null, chunk: "auth" }],
    [{ ...base, pathname: "/workflows" }, { redirectTo: null, chunk: "auth" }],
    [{ ...base, pathname: "/workflows", user: USER, access: "pending" as AccessState }, { redirectTo: null, chunk: "auth" }],
    [{ ...base, pathname: "/workflows", user: USER, access: "granted" as AccessState }, { redirectTo: null, chunk: "controlCenter" }],
    [{ ...base, pathname: "/workflows", configured: false }, { redirectTo: null, chunk: "controlCenter" }],
  ])("%o → %o", (input, expected) => {
    expect(resolveDestination(input)).toEqual(expected);
  });
});
