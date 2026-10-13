/**
 * Firebase Admin App Check verifier adapter.
 *
 * Implements the server-side `AppAttestationVerifier` port using Firebase
 * Admin's `getAppCheck(app).verifyToken(token)` seam.
 *
 * Security guarantees:
 * - Never decodes tokens manually or trusts unverified JWT claims.
 * - Never logs or exposes raw tokens or internal certificates.
 * - Maps results into safe AppAttestationResult fields (valid, appId, error).
 * - Distinguishes invalid tokens from unavailable verifier infrastructure so
 *   enforced mode can deterministically fail closed.
 */
import type {
  AppAttestationResult,
  AppAttestationVerifier,
} from "../../api/security/index.js";
import type { FirebaseAppCheckLike } from "./firebase-services.js";

export class FirebaseAppCheckVerifier implements AppAttestationVerifier {
  constructor(private readonly appCheck: FirebaseAppCheckLike | undefined) {}

  async verify(token: string | undefined): Promise<AppAttestationResult> {
    if (!this.appCheck) {
      return { valid: false, error: "verifier_unavailable" };
    }

    if (!token || typeof token !== "string" || token.trim() === "") {
      return { valid: false, error: "missing" };
    }

    try {
      const response = await this.appCheck.verifyToken(token.trim());
      if (
        response &&
        typeof response.appId === "string" &&
        response.appId.length > 0
      ) {
        return {
          valid: true,
          appId: response.appId,
        };
      }
      return { valid: false, error: "invalid" };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string })?.code ?? "";

      // Classify error: client-facing invalidity vs infrastructure unavailability
      const isClientTokenError =
        code.includes("expired") ||
        code.includes("invalid-argument") ||
        code.includes("invalid-credential") ||
        message.toLowerCase().includes("expired") ||
        message.toLowerCase().includes("invalid") ||
        message.toLowerCase().includes("malformed") ||
        message.toLowerCase().includes("decoding") ||
        message.toLowerCase().includes("jwt");

      if (isClientTokenError) {
        return { valid: false, error: "invalid" };
      }

      // Infrastructure / network / firebase admin service failure
      return { valid: false, error: "unavailable" };
    }
  }
}
