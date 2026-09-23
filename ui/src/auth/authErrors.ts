import { translate, type MessageKey } from "../i18n/messages";

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

/** Message key for a user-safe error (translated by the caller). */
export function authErrorKey(error: unknown, flow: AuthFlow): MessageKey {
  const kind = AuthFlowError.from(error).kind;

  switch (kind) {
    case "invalid-credentials":
      return "auth.errors.invalidCredentials";
    case "account-unavailable":
      return "auth.errors.accountUnavailable";
    case "signup-rejected":
      // Deliberately does not confirm that the address is registered.
      return "auth.errors.signupRejected";
    case "weak-password":
      return "auth.errors.weakPassword";
    case "invalid-email":
      return "auth.errors.invalidEmail";
    case "rate-limited":
      return "auth.errors.rateLimited";
    case "network":
      return "auth.errors.network";
    case "method-disabled":
      return flow === "signUp" ? "auth.errors.signupDisabled" : "auth.errors.signinDisabled";
    case "not-configured":
      return "auth.errors.notConfigured";
    default:
      switch (flow) {
        case "signUp":
          return "auth.errors.signupFailed";
        case "reset":
          return "auth.errors.resetFailed";
        case "refresh":
          return "auth.errors.refreshFailed";
        default:
          return "auth.errors.signinFailed";
      }
  }
}

/** English message (for non-UI callers and tests). */
export function authErrorMessage(error: unknown, flow: AuthFlow): string {
  return translate("en", authErrorKey(error, flow));
}
