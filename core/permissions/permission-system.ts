import {
  type PermissionDecision,
  type PermissionGrant,
  type PermissionRequest,
  PermissionDeniedError,
} from "../../contracts/index.js";

/**
 * Deny-by-default permission evaluation.
 *
 * A request is scoped by agent, project, tool, action, and environment. A
 * grant matches when its action equals the request action and every scope
 * field it specifies matches (an unspecified field is a wildcard).
 *
 * Precedence: explicit deny > explicit allow > implicit deny.
 */
export class PermissionSystem {
  private readonly grants: readonly PermissionGrant[];

  constructor(grants: readonly PermissionGrant[] = []) {
    this.grants = grants.map((grant) => ({ ...grant }));
  }

  /** Return a new system with additional grants appended (immutable). */
  withGrants(extra: readonly PermissionGrant[]): PermissionSystem {
    return new PermissionSystem([...this.grants, ...extra]);
  }

  evaluate(request: PermissionRequest): PermissionDecision {
    const matches = this.grants.filter(
      (grant) =>
        grant.action === request.action && this.scopeMatches(grant, request),
    );

    const deny = matches.find((grant) => grant.effect === "deny");
    if (deny) {
      return {
        allowed: false,
        reason: deny.reason ?? "explicit deny",
        matched: deny,
      };
    }

    const allow = matches.find((grant) => grant.effect === "allow");
    if (allow) {
      return {
        allowed: true,
        reason: allow.reason ?? "explicit allow",
        matched: allow,
      };
    }

    return { allowed: false, reason: "deny by default" };
  }

  /** Throw `PermissionDeniedError` unless the request is explicitly allowed. */
  assert(request: PermissionRequest): void {
    const decision = this.evaluate(request);
    if (!decision.allowed) {
      const tool = request.toolId ? `/${request.toolId}` : "";
      throw new PermissionDeniedError(
        `permission denied: ${request.agentId} ${request.action} on ` +
          `${request.projectId}${tool} (${request.environment}) — ` +
          decision.reason,
      );
    }
  }

  private scopeMatches(
    grant: PermissionGrant,
    request: PermissionRequest,
  ): boolean {
    return (
      (grant.agentId === undefined || grant.agentId === request.agentId) &&
      (grant.projectId === undefined || grant.projectId === request.projectId) &&
      (grant.toolId === undefined || grant.toolId === request.toolId) &&
      (grant.environment === undefined ||
        grant.environment === request.environment)
    );
  }
}
