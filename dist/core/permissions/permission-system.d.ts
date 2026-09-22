import { type PermissionDecision, type PermissionGrant, type PermissionRequest } from "../../contracts/index.js";
/**
 * Deny-by-default permission evaluation.
 *
 * A request is scoped by agent, project, tool, action, and environment. A
 * grant matches when its action equals the request action and every scope
 * field it specifies matches (an unspecified field is a wildcard).
 *
 * Precedence: explicit deny > explicit allow > implicit deny.
 */
export declare class PermissionSystem {
    private readonly grants;
    constructor(grants?: readonly PermissionGrant[]);
    /** Return a new system with additional grants appended (immutable). */
    withGrants(extra: readonly PermissionGrant[]): PermissionSystem;
    evaluate(request: PermissionRequest): PermissionDecision;
    /** Throw `PermissionDeniedError` unless the request is explicitly allowed. */
    assert(request: PermissionRequest): void;
    private scopeMatches;
}
