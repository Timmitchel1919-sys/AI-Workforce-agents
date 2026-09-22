/**
 * `OperatorDirectory` backed by Firebase Auth.
 *
 * Verifies a Firebase ID token and maps its custom claims to an
 * `OperatorPrincipal`:
 *
 *   role             -> "viewer" | "operator" | "admin"   (custom claim)
 *   allowedProjects  -> string[] | "*"                     (custom claim)
 *
 * Anything unverifiable — a bad/expired token, a missing or out-of-range role,
 * a malformed project list — resolves to `null` (deny by default). The control
 * services still enforce authorization from the returned principal; this only
 * establishes identity + claims.
 */
import { type OperatorDirectory, type OperatorPrincipal } from "../../contracts/index.js";
import type { FirebaseAuthLike } from "./firebase-services.js";
export interface FirebaseOperatorDirectoryOptions {
    /** Custom-claim name holding the operator role. Default `"role"`. */
    roleClaim?: string;
    /** Custom-claim name holding the project allow-list. Default `"allowedProjects"`. */
    projectsClaim?: string;
}
export declare class FirebaseOperatorDirectory implements OperatorDirectory {
    private readonly auth;
    private readonly roleClaim;
    private readonly projectsClaim;
    constructor(auth: FirebaseAuthLike, options?: FirebaseOperatorDirectoryOptions);
    resolve(credential: string): Promise<OperatorPrincipal | null>;
}
