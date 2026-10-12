export interface AppAttestationResult {
  valid: boolean;
  appId?: string;
  error?: "app_check_missing" | "app_check_invalid" | "app_check_unconfigured" | "app_check_verification_failed" | string;
}

export interface AppAttestationVerifier {
  verify(token: string | undefined): Promise<AppAttestationResult>;
}

export type AppCheckEnforcementMode = "disabled" | "monitor" | "enforced";

/**
 * Default pass-through verifier used when App Check is unconfigured or disabled.
 */
export class DefaultAppAttestationVerifier implements AppAttestationVerifier {
  async verify(_token: string | undefined): Promise<AppAttestationResult> {
    return { valid: true };
  }
}

export interface AppCheckVerifierSeam {
  verifyToken(appCheckToken: string): Promise<{ appId: string; [claim: string]: unknown }>;
}

/**
 * Production Firebase App Check verifier implementation.
 * Verifies App Check tokens through the official Firebase Admin App Check SDK.
 */
export class FirebaseAppAttestationVerifier implements AppAttestationVerifier {
  constructor(
    private readonly appCheck?: AppCheckVerifierSeam,
    private readonly mode: AppCheckEnforcementMode = "disabled",
  ) {}

  async verify(token: string | undefined): Promise<AppAttestationResult> {
    if (this.mode === "disabled") {
      return { valid: true };
    }

    if (!token || !token.trim()) {
      return {
        valid: false,
        error: "app_check_missing",
      };
    }

    if (!this.appCheck) {
      if (this.mode === "enforced") {
        return { valid: false, error: "app_check_unconfigured" };
      }
      return { valid: true };
    }

    try {
      const decoded = await this.appCheck.verifyToken(token.trim());
      return {
        valid: true,
        appId: decoded.appId,
      };
    } catch {
      return {
        valid: false,
        error: "app_check_invalid",
      };
    }
  }
}
