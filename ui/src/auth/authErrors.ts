/**
 * Maps Firebase Auth error codes to a small set of user-safe outcomes. Raw
 * codes, messages, and stack traces never reach the UI.
 */
export type AuthErrorKind =
  | "invalid-credentials"
  | "account-unavailable"
  | "signup-rejected"
  | "weak-password"
  | "invalid-email"
  | "rate-limited"
  | "network"
  | "method-disabled"
  | "not-configured"
  | "unknown";

const CODE_TO_KIND: Record<string, AuthErrorKind> = {
  "auth/invalid-credential": "invalid-credentials",
  "auth/invalid-login-credentials": "invalid-credentials",
  "auth/wrong-password": "invalid-credentials",
  "auth/user-not-found": "invalid-credentials",
  "auth/user-disabled": "account-unavailable",
  "auth/email-already-in-use": "signup-rejected",
  "auth/credential-already-in-use": "signup-rejected",
  "auth/weak-password": "weak-password",
  "auth/password-does-not-meet-requirements": "weak-password",
  "auth/invalid-email": "invalid-email",
  "auth/missing-email": "invalid-email",
  "auth/too-many-requests": "rate-limited",
  "auth/quota-exceeded": "rate-limited",
  "auth/network-request-failed": "network",
  "auth/timeout": "network",
  "auth/operation-not-allowed": "method-disabled",
  "auth/admin-restricted-operation": "method-disabled",
};

export class AuthFlowError extends Error {
  readonly kind: AuthErrorKind;

  constructor(kind: AuthErrorKind) {
    super(kind);
    this.name = "AuthFlowError";
    this.kind = kind;
  }

  static from(error: unknown): AuthFlowError {
    if (error instanceof AuthFlowError) return error;
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    return new AuthFlowError(CODE_TO_KIND[code] ?? "unknown");
  }
}

export type AuthFlow = "signIn" | "signUp" | "reset" | "refresh";

export function authErrorMessage(error: unknown, flow: AuthFlow): string {
  const kind = AuthFlowError.from(error).kind;

  switch (kind) {
    case "invalid-credentials":
      return "Invalid email or password.";
    case "account-unavailable":
      return "Account access unavailable. Contact your AI Workforce administrator.";
    case "signup-rejected":
      // Deliberately does not confirm that the address is registered.
      return "We couldn't create an account with these details. If you already have access, sign in or reset your password.";
    case "weak-password":
      return "Password does not meet the requirements.";
    case "invalid-email":
      return "Enter a valid email address.";
    case "rate-limited":
      return "Too many attempts. Wait a moment and try again.";
    case "network":
      return "Connection problem. Try again.";
    case "method-disabled":
      return flow === "signUp"
        ? "Account creation is not enabled for this system."
        : "Email sign-in is not enabled for this system.";
    case "not-configured":
      return "Authentication is not configured for this environment.";
    default:
      switch (flow) {
        case "signUp":
          return "Account creation failed. Try again.";
        case "reset":
          return "Could not send the reset email. Try again.";
        case "refresh":
          return "Could not check access. Try again.";
        default:
          return "Sign-in failed. Try again.";
      }
  }
}
