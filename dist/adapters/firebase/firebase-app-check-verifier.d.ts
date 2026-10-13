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
import type { AppAttestationResult, AppAttestationVerifier } from "../../api/security/index.js";
import type { FirebaseAppCheckLike } from "./firebase-services.js";
export declare class FirebaseAppCheckVerifier implements AppAttestationVerifier {
    private readonly appCheck;
    constructor(appCheck: FirebaseAppCheckLike | undefined);
    verify(token: string | undefined): Promise<AppAttestationResult>;
}
