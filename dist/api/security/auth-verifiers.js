export const DEFAULT_REAUTH_FRESHNESS_MS = 10 * 60 * 1000; // 10 minutes
export const DEFAULT_MFA_FRESHNESS_MS = 10 * 60 * 1000; // 10 minutes
export class FirebaseReauthenticationVerifier {
    thresholdMs;
    now;
    constructor(options = {}) {
        this.thresholdMs =
            options.freshnessThresholdMs ?? DEFAULT_REAUTH_FRESHNESS_MS;
        this.now = options.now ?? (() => Date.now());
    }
    /**
     * Verify whether the authenticated identity performed an authentication ceremony
     * recently enough to satisfy reauthentication requirements.
     */
    verify(identity) {
        if (!identity)
            return undefined;
        const authTime = identity.authTime;
        if (typeof authTime !== "number" ||
            !Number.isFinite(authTime) ||
            authTime <= 0) {
            return undefined;
        }
        const authTimeMs = authTime * 1000;
        const currentMs = this.now();
        // Reject clock skew beyond 60s into future
        if (authTimeMs > currentMs + 60_000) {
            return undefined;
        }
        // Reject stale authentication
        if (currentMs - authTimeMs > this.thresholdMs) {
            return undefined;
        }
        return {
            verified: true,
            verifiedAt: new Date(authTimeMs).toISOString(),
            method: "firebase_auth_time",
        };
    }
}
export class FirebaseMfaVerifier {
    thresholdMs;
    now;
    constructor(options = {}) {
        this.thresholdMs = options.freshnessThresholdMs ?? DEFAULT_MFA_FRESHNESS_MS;
        this.now = options.now ?? (() => Date.now());
    }
    /**
     * Verify whether verified Firebase claims prove a genuine multi-factor second factor
     * occurred during authentication.
     */
    verify(identity) {
        if (!identity)
            return undefined;
        // Must have second factor claim from verified Firebase token
        const factorId = identity.firebaseClaims?.signInSecondFactor;
        if (typeof factorId !== "string" || factorId.trim() === "") {
            return undefined;
        }
        // A factor claim without auth_time cannot prove freshness. Never mint
        // evidence using the server clock: that would turn an old/unknown MFA
        // ceremony into a fresh one.
        if (typeof identity.authTime !== "number" ||
            !Number.isFinite(identity.authTime) ||
            identity.authTime <= 0) {
            return undefined;
        }
        const authTimeMs = identity.authTime * 1000;
        const currentMs = this.now();
        if (authTimeMs > currentMs + 60_000 ||
            currentMs - authTimeMs > this.thresholdMs) {
            return undefined;
        }
        return {
            verified: true,
            verifiedAt: new Date(authTimeMs).toISOString(),
            method: `firebase_mfa:${factorId.trim()}`,
        };
    }
}
