/**
 * Tenant Isolation Context.
 * Ensures queries, listing, and caches are isolated per organization.
 */
export class TenantIsolationContext {
    static instance;
    currentContexts = new Map();
    constructor() { }
    static getInstance() {
        if (!TenantIsolationContext.instance) {
            TenantIsolationContext.instance = new TenantIsolationContext();
        }
        return TenantIsolationContext.instance;
    }
    setContext(executionId, context) {
        this.currentContexts.set(executionId, context);
    }
    getContext(executionId) {
        return this.currentContexts.get(executionId);
    }
    clearContext(executionId) {
        this.currentContexts.delete(executionId);
    }
    enforceIsolation(executionId, entityOrgId) {
        const context = this.getContext(executionId);
        if (!context) {
            throw new Error("No tenant context found for execution. Strict isolation enforced.");
        }
        if (context.organizationId !== entityOrgId) {
            throw new Error(`Tenant Isolation Violation: Access denied to organization ${entityOrgId}`);
        }
    }
}
