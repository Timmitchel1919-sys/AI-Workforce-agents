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
import {
  OPERATOR_ROLES,
  validateOperatorPrincipal,
  type OperatorDirectory,
  type OperatorPrincipal,
  type OperatorRole,
} from "../../contracts/index.js";
import type {
  DecodedTokenLike,
  FirebaseAuthLike,
} from "./firebase-services.js";

export interface FirebaseOperatorDirectoryOptions {
  /** Custom-claim name holding the operator role. Default `"role"`. */
  roleClaim?: string;
  /** Custom-claim name holding the project allow-list. Default `"allowedProjects"`. */
  projectsClaim?: string;
}

export class FirebaseOperatorDirectory implements OperatorDirectory {
  private readonly roleClaim: string;
  private readonly projectsClaim: string;

  constructor(
    private readonly auth: FirebaseAuthLike,
    options: FirebaseOperatorDirectoryOptions = {},
  ) {
    this.roleClaim = options.roleClaim ?? "role";
    this.projectsClaim = options.projectsClaim ?? "allowedProjects";
  }

  async resolve(credential: string): Promise<OperatorPrincipal | null> {
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

    const role = decoded[this.roleClaim];
    if (
      typeof role !== "string" ||
      !(OPERATOR_ROLES as readonly string[]).includes(role)
    ) {
      return null;
    }

    const rawProjects = decoded[this.projectsClaim];
    let allowedProjects: readonly string[] | "*";
    if (rawProjects === "*") {
      allowedProjects = "*";
    } else if (
      Array.isArray(rawProjects) &&
      rawProjects.every((p) => typeof p === "string")
    ) {
      allowedProjects = rawProjects as string[];
    } else {
      return null;
    }

    const principal: OperatorPrincipal = {
      id: decoded.uid,
      role: role as OperatorRole,
      allowedProjects,
    };
    try {
      validateOperatorPrincipal(principal);
    } catch {
      return null;
    }
    return principal;
  }
}
