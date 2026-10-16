/**
 * `OperatorDirectory` + `IdentityVerifier` backed by Firebase Auth (AUTHZ-1).
 *
 *   Firebase ID token ──verifyIdToken──▶ VerifiedIdentity (WHO — authentication)
 *   Firebase UID ──OperatorAccountStore──▶ ACTIVE account + role (WHAT — authorization)
 *
 * Authentication ≠ authorization: a valid token alone grants nothing. Only an
 * ACTIVE operator account (read from the authoritative store on every request,
 * so suspension/revocation take effect immediately) yields a principal. A bad
 * or expired token, a missing account, or a pending/rejected/suspended/revoked
 * account resolves to `null` (deny by default). Custom claims are not used for
 * authorization.
 */
import {
  principalFor,
  sessionRevoked,
  type IdentityVerifier,
  type OperatorAccountStore,
  type OperatorDirectory,
  type OperatorPrincipal,
  type VerifiedIdentity,
} from "../../contracts/index.js";
import type {
  DecodedTokenLike,
  FirebaseAuthLike,
} from "./firebase-services.js";

export class FirebaseOperatorDirectory
  implements OperatorDirectory, IdentityVerifier
{
  constructor(
    private readonly auth: FirebaseAuthLike,
    private readonly accounts: OperatorAccountStore,
  ) {}

  /** Authentication only: token → identity, or null. Never throws. */
  async verify(credential: string): Promise<VerifiedIdentity | null> {
    if (typeof credential !== "string" || credential.trim() === "") {
      return null;
    }
    let decoded: DecodedTokenLike;
    try {
      decoded = await this.auth.verifyIdToken(credential.trim());
    } catch {
      return null;
    }
    if (!decoded || typeof decoded.uid !== "string" || decoded.uid === "") {
      return null;
    }
    const email = typeof decoded.email === "string" ? decoded.email : undefined;
    const name = typeof decoded.name === "string" ? decoded.name : undefined;
    const authTime =
      typeof decoded.auth_time === "number" ? decoded.auth_time : undefined;
    const issuedAt = typeof decoded.iat === "number" ? decoded.iat : undefined;

    const firebaseRaw = decoded.firebase;
    const firebaseClaims =
      firebaseRaw && typeof firebaseRaw === "object"
        ? {
            signInSecondFactor:
              typeof (firebaseRaw as Record<string, unknown>)
                .sign_in_second_factor === "string"
                ? ((firebaseRaw as Record<string, unknown>)
                    .sign_in_second_factor as string)
                : undefined,
            secondFactorIdentifier:
              typeof (firebaseRaw as Record<string, unknown>)
                .second_factor_identifier === "string"
                ? ((firebaseRaw as Record<string, unknown>)
                    .second_factor_identifier as string)
                : undefined,
            signInProvider:
              typeof (firebaseRaw as Record<string, unknown>)
                .sign_in_provider === "string"
                ? ((firebaseRaw as Record<string, unknown>)
                    .sign_in_provider as string)
                : undefined,
          }
        : undefined;

    return {
      uid: decoded.uid,
      ...(email ? { email } : {}),
      ...(name ? { displayName: name } : {}),
      emailVerified: decoded.email_verified === true,
      ...(authTime !== undefined ? { authTime } : {}),
      ...(issuedAt !== undefined ? { issuedAt } : {}),
      ...(firebaseClaims ? { firebaseClaims } : {}),
    };
  }

  /** Authentication + authorization: only an ACTIVE account is a principal. */
  async resolve(credential: string): Promise<OperatorPrincipal | null> {
    const identity = await this.verify(credential);
    if (!identity) return null;
    try {
      const account = await this.accounts.get(identity.uid);
      // A token issued before "sign out all devices" is refused immediately.
      if (sessionRevoked(account, identity.issuedAt)) return null;
      return principalFor(account);
    } catch {
      return null;
    }
  }
}
