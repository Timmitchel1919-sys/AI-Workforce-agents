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
import { type IdentityVerifier, type OperatorAccountStore, type OperatorDirectory, type OperatorPrincipal, type VerifiedIdentity } from "../../contracts/index.js";
import type { FirebaseAuthLike } from "./firebase-services.js";
export declare class FirebaseOperatorDirectory implements OperatorDirectory, IdentityVerifier {
    private readonly auth;
    private readonly accounts;
    constructor(auth: FirebaseAuthLike, accounts: OperatorAccountStore);
    /** Authentication only: token → identity, or null. Never throws. */
    verify(credential: string): Promise<VerifiedIdentity | null>;
    /** Authentication + authorization: only an ACTIVE account is a principal. */
    resolve(credential: string): Promise<OperatorPrincipal | null>;
}
