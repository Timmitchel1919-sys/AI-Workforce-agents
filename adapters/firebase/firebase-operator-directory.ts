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
    return {
      uid: decoded.uid,
      ...(email ? { email } : {}),
      ...(name ? { displayName: name } : {}),
      emailVerified: decoded.email_verified === true,
    };
  }

  /** Authentication + authorization: only an ACTIVE account is a principal. */
  async resolve(credential: string): Promise<OperatorPrincipal | null> {
    const identity = await this.verify(credential);
    if (!identity) return null;
    try {
      return principalFor(await this.accounts.get(identity.uid));
    } catch {
      return null;
    }
  }
}
