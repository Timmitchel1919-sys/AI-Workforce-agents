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
import { OPERATOR_ROLES, validateOperatorPrincipal, } from "../../contracts/index.js";
export class FirebaseOperatorDirectory {
    auth;
    roleClaim;
    projectsClaim;
    constructor(auth, options = {}) {
        this.auth = auth;
        this.roleClaim = options.roleClaim ?? "role";
        this.projectsClaim = options.projectsClaim ?? "allowedProjects";
    }
    async resolve(credential) {
        if (typeof credential !== "string" || credential.trim() === "") {
            return null;
        }
        let decoded;
        try {
            decoded = await this.auth.verifyIdToken(credential.trim());
        }
        catch {
            return null;
        }
        if (!decoded || typeof decoded.uid !== "string" || decoded.uid === "") {
            return null;
        }
        const role = decoded[this.roleClaim];
        if (typeof role !== "string" ||
            !OPERATOR_ROLES.includes(role)) {
            return null;
        }
        const rawProjects = decoded[this.projectsClaim];
        let allowedProjects;
        if (rawProjects === "*") {
            allowedProjects = "*";
        }
        else if (Array.isArray(rawProjects) &&
            rawProjects.every((p) => typeof p === "string")) {
            allowedProjects = rawProjects;
        }
        else {
            return null;
        }
        const principal = {
            id: decoded.uid,
            role: role,
            allowedProjects,
        };
        try {
            validateOperatorPrincipal(principal);
        }
        catch {
            return null;
        }
        return principal;
    }
}
