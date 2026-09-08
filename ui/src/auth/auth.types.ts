import type { OperatorRole } from "../api/contracts";

/**
 * The four auth states. The dashboard must never render while `loading` — the
 * router shows a full-page loader until the state resolves.
 */
export type AuthStatus =
  "loading" | "authenticated" | "unauthenticated" | "error";

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export interface AuthSession {
  status: AuthStatus;
  user: AuthUser | null;
  /**
   * Operator role from the Firebase ID-token custom claims. Advisory only —
   * used for navigation/visibility. The Control Plane is the security authority.
   */
  role: OperatorRole | null;
  /** Project allow-list from custom claims (`"*"` = all). Advisory only. */
  allowedProjects: readonly string[] | "*" | null;
  error: string | null;
  /** Current Firebase ID token, or `null`. Passed to the API client as a Bearer token. */
  getIdToken: () => Promise<string | null>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}
