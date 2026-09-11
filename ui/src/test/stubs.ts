import { vi } from "vitest";
import type { ApiClient } from "../api";
import type { AuthSession } from "../auth/auth.types";

export function makeStubAuth(
  overrides: Partial<AuthSession> = {},
): AuthSession {
  return {
    status: "authenticated",
    user: { uid: "op-1", email: "operator@example.com", displayName: null },
    role: "operator",
    allowedProjects: "*",
    error: null,
    getIdToken: vi.fn(async () => "stub-id-token"),
    signInWithEmail: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    ...overrides,
  };
}

/** A stub `ApiClient` whose methods are vi.fn's returning empty results. */
export function makeStubApiClient(
  overrides: Partial<ApiClient> = {},
): ApiClient {
  const ok = vi.fn(async () => ({
    data: undefined as never,
    status: 200,
    correlationId: "test",
  }));
  return {
    get: ok,
    post: ok,
    patch: ok,
    delete: ok,
    ...overrides,
  };
}
