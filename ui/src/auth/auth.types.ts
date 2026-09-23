export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

/**
 * Whether the signed-in user's ID token carries a Control Plane role claim.
 * UX only — the Control Plane re-verifies the token and enforces authorization
 * on every request; this never grants access by itself.
 */
export type AccessState = "none" | "granted" | "pending";

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
  signIn: (email: string, password: string, remember: boolean) => Promise<AccessState>;
  signUp: (input: SignUpInput) => Promise<AccessState>;
  sendPasswordReset: (email: string) => Promise<void>;
  /** Forces an ID-token refresh so newly assigned role claims are picked up. */
  refreshAccess: () => Promise<AccessState>;
  getPasswordPolicy: () => Promise<PasswordPolicy>;
  signOut: () => Promise<void>;
}
