export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

/**
 * The signed-in user's AI Workforce access, as reported by the Control Plane
 * (`GET /api/me/access`). UX only — the backend re-verifies the token and the
 * operator account on every request; this never grants access by itself.
 *
 *   none         not signed in
 *   granted      ACTIVE operator account
 *   pending      signed in, waiting for an administrator
 *   rejected     access request declined
 *   suspended    access temporarily suspended
 *   revoked      access revoked
 *   unavailable  the Control Plane could not be reached — nothing is assumed
 */
export type AccessState =
  | "none"
  | "granted"
  | "pending"
  | "rejected"
  | "suspended"
  | "revoked"
  | "unavailable";

/** Backend-reported role/capabilities for the active account (UX only). */
export interface AccessDetails {
  role?: "viewer" | "operator" | "admin";
  capabilities: readonly string[];
}

export interface SignUpInput {
  displayName?: string;
  email: string;
  password: string;
}

/** The project's effective password policy, normalized for display and local checks. */
export interface PasswordPolicy {
  minLength: number;
  maxLength?: number;
  requireLowercase: boolean;
  requireUppercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
  /** "project" = fetched from Firebase Auth; "default" = Firebase's built-in minimum. */
  source: "project" | "default";
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  accessToken: string | null;
  /** False when Firebase web config is absent (local development / demo data). */
  configured: boolean;
  access: AccessState;
  /** Role and capabilities of an ACTIVE account; empty otherwise. */
  accessDetails: AccessDetails;
  signIn: (email: string, password: string, remember: boolean) => Promise<AccessState>;
  signUp: (input: SignUpInput) => Promise<AccessState>;
  sendPasswordReset: (email: string) => Promise<void>;
  /** Refreshes the ID token and asks the Control Plane for the current access state. */
  refreshAccess: () => Promise<AccessState>;
  getPasswordPolicy: () => Promise<PasswordPolicy>;
  /**
   * Updates the Firebase Auth display name and refreshes the ID token so the
   * Control Plane picks up the new name. Optional: absent in test doubles.
   */
  updateDisplayName?: (displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
}
