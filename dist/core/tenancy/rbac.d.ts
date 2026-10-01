import { TenantContext, Role } from "../../contracts/tenancy.js";
import { PermissionGrant } from "../../contracts/index.js";
/**
 * RBAC/ABAC Extensions.
 * Dynamically resolves roles and permissions based on membership.
 */
export declare class RbacEnforcer {
    /**
     * Evaluates if a given TenantContext has the required role.
     */
    hasRole(context: TenantContext, role: Role): boolean;
    /**
     * Evaluates if a given TenantContext has the required ABAC permission.
     */
    hasPermission(context: TenantContext, permissionStr: string): boolean;
    /**
     * Injects enterprise RBAC grants into standard agent permissions.
     */
    injectEnterpriseGrants(agentPermissions: readonly PermissionGrant[], context: TenantContext): PermissionGrant[];
}
