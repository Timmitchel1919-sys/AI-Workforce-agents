import { TenantContext, Role } from "../../contracts/tenancy.js";
import { PermissionGrant } from "../../contracts/index.js";

/**
 * RBAC/ABAC Extensions.
 * Dynamically resolves roles and permissions based on membership.
 */
export class RbacEnforcer {
  /**
   * Evaluates if a given TenantContext has the required role.
   */
  public hasRole(context: TenantContext, role: Role): boolean {
    if (context.roles.includes("owner")) return true; // Owner overrides
    return context.roles.includes(role);
  }

  /**
   * Evaluates if a given TenantContext has the required ABAC permission.
   */
  public hasPermission(context: TenantContext, permissionStr: string): boolean {
    if (this.hasRole(context, "owner")) return true;
    return context.permissions.includes(permissionStr);
  }

  /**
   * Injects enterprise RBAC grants into standard agent permissions.
   */
  public injectEnterpriseGrants(
    agentPermissions: readonly PermissionGrant[],
    context: TenantContext,
  ): PermissionGrant[] {
    const grants = [...agentPermissions];

    // Enterprise admins get implicitly injected read across all projects in the org
    if (this.hasRole(context, "admin")) {
      grants.push({
        effect: "allow",
        action: "read",
      });
    }

    return grants;
  }
}
