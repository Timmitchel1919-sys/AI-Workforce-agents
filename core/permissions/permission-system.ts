import { type PermissionGrant, type PermissionRequest } from "../../contracts/index.js";
export class PermissionSystem {
  constructor(private readonly grants: readonly PermissionGrant[] = []) {}
  evaluate(request: PermissionRequest): { allowed: boolean; reason: string } {
    const matching = this.grants.filter((grant) => grant.action === request.action && this.matches(grant, request));
    if (matching.some((grant) => grant.effect === "deny")) return { allowed: false, reason: "explicit deny" };
    if (matching.some((grant) => grant.effect === "allow")) return { allowed: true, reason: "explicit allow" };
    return { allowed: false, reason: "deny by default" };
  }
  private matches(grant: PermissionGrant, request: PermissionRequest): boolean {
    return (!grant.agentId || grant.agentId === request.agentId) && (!grant.projectId || grant.projectId === request.projectId) && (!grant.toolId || grant.toolId === request.toolId) && (!grant.environment || grant.environment === request.environment);
  }
}
