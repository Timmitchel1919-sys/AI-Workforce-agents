/**
 * RBAC/ABAC Extensions.
 * Dynamically resolves roles and permissions based on membership.
 */
export class RbacEnforcer {
    /**
     * Evaluates if a given TenantContext has the required role.
     */
    hasRole(context, role) {
        if (context.roles.includes("owner"))
            return true; // Owner overrides
        return context.roles.includes(role);
    }
    /**
     * Evaluates if a given TenantContext has the required ABAC permission.
     */
    hasPermission(context, permissionStr) {
        if (this.hasRole(context, "owner"))
            return true;
        return context.permissions.includes(permissionStr);
    }
    /**
     * Injects enterprise RBAC grants into standard agent permissions.
     */
    injectEnterpriseGrants(agentPermissions, context) {
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
