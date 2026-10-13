/**
 * Trusted MFA & Reauthentication verification boundaries.
 *
 * Implements server-side verifiers that derive evidence exclusively from
 * verified Firebase ID token claims (AUTHZ-1 / Layer 5).
 *
 * Security guarantees:
 * - Evidence is NEVER accepted from untrusted request bodies (e.g.
 *   `request.body.reauthVerified` or `request.body.mfaVerified`).
 * - Reauthentication checks the verified `auth_time` claim against an
 *   authoritative freshness threshold (default 10 minutes).
 * - MFA evidence requires explicit second-factor proof in verified Firebase
 *   token claims (`firebase.sign_in_second_factor`). It is NEVER inferred from
 *   email verification, password provider, admin role, or App Check status.
 * - Missing or unconfigured MFA fails closed with undefined evidence, keeping
 *   sensitive routes blocked.
 */
import type { SecurityMfaEvidence, SecurityReauthenticationEvidence } from "../../contracts/destructive-action.js";
import type { VerifiedIdentity } from "../../contracts/access.js";
export declare const DEFAULT_REAUTH_FRESHNESS_MS: number;
export declare const DEFAULT_MFA_FRESHNESS_MS: number;
export interface ReauthenticationVerifierOptions {
    /** Freshness window in milliseconds (default 10 minutes). */
    freshnessThresholdMs?: number;
    /** Clock injection for deterministic testing. */
    now?: () => number;
}
export declare class FirebaseReauthenticationVerifier {
    private readonly thresholdMs;
    private readonly now;
    constructor(options?: ReauthenticationVerifierOptions);
    /**
     * Verify whether the authenticated identity performed an authentication ceremony
     * recently enough to satisfy reauthentication requirements.
     */
    verify(identity: VerifiedIdentity | null | undefined): SecurityReauthenticationEvidence | undefined;
}
export interface MfaVerifierOptions {
    /** Freshness window in milliseconds (default 10 minutes). */
    freshnessThresholdMs?: number;
    /** Clock injection for deterministic testing. */
    now?: () => number;
}
export declare class FirebaseMfaVerifier {
    private readonly thresholdMs;
    private readonly now;
    constructor(options?: MfaVerifierOptions);
    /**
     * Verify whether verified Firebase claims prove a genuine multi-factor second factor
     * occurred during authentication.
     */
    verify(identity: VerifiedIdentity | null | undefined): SecurityMfaEvidence | undefined;
}
