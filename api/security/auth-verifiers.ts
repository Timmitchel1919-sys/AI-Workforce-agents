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
import type {
  SecurityMfaEvidence,
  SecurityReauthenticationEvidence,
} from "../../contracts/destructive-action.js";
import type { VerifiedIdentity } from "../../contracts/access.js";

export const DEFAULT_REAUTH_FRESHNESS_MS = 10 * 60 * 1000; // 10 minutes
export const DEFAULT_MFA_FRESHNESS_MS = 10 * 60 * 1000; // 10 minutes

export interface ReauthenticationVerifierOptions {
  /** Freshness window in milliseconds (default 10 minutes). */
  freshnessThresholdMs?: number;
  /** Clock injection for deterministic testing. */
  now?: () => number;
}

export class FirebaseReauthenticationVerifier {
  private readonly thresholdMs: number;
  private readonly now: () => number;

  constructor(options: ReauthenticationVerifierOptions = {}) {
    this.thresholdMs =
      options.freshnessThresholdMs ?? DEFAULT_REAUTH_FRESHNESS_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Verify whether the authenticated identity performed an authentication ceremony
   * recently enough to satisfy reauthentication requirements.
   */
  verify(
    identity: VerifiedIdentity | null | undefined,
  ): SecurityReauthenticationEvidence | undefined {
    if (!identity) return undefined;

    const authTime = identity.authTime;
    if (
      typeof authTime !== "number" ||
      !Number.isFinite(authTime) ||
      authTime <= 0
    ) {
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

export interface MfaVerifierOptions {
  /** Freshness window in milliseconds (default 10 minutes). */
  freshnessThresholdMs?: number;
  /** Clock injection for deterministic testing. */
  now?: () => number;
}

export class FirebaseMfaVerifier {
  private readonly thresholdMs: number;
  private readonly now: () => number;

  constructor(options: MfaVerifierOptions = {}) {
    this.thresholdMs = options.freshnessThresholdMs ?? DEFAULT_MFA_FRESHNESS_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Verify whether verified Firebase claims prove a genuine multi-factor second factor
   * occurred during authentication.
   */
  verify(
    identity: VerifiedIdentity | null | undefined,
  ): SecurityMfaEvidence | undefined {
    if (!identity) return undefined;

    // Must have second factor claim from verified Firebase token
    const factorId = identity.firebaseClaims?.signInSecondFactor;
    if (typeof factorId !== "string" || factorId.trim() === "") {
      return undefined;
    }

    // A factor claim without auth_time cannot prove freshness. Never mint
    // evidence using the server clock: that would turn an old/unknown MFA
    // ceremony into a fresh one.
    if (
      typeof identity.authTime !== "number" ||
      !Number.isFinite(identity.authTime) ||
      identity.authTime <= 0
    ) {
      return undefined;
    }

    const authTimeMs = identity.authTime * 1000;
    const currentMs = this.now();
    if (
      authTimeMs > currentMs + 60_000 ||
      currentMs - authTimeMs > this.thresholdMs
    ) {
      return undefined;
    }
    return {
      verified: true,
      verifiedAt: new Date(authTimeMs).toISOString(),
      method: `firebase_mfa:${factorId.trim()}`,
    };
  }
}
