import { TenantContext } from "../../contracts/tenancy.js";
/**
 * Tenant Isolation Context.
 * Ensures queries, listing, and caches are isolated per organization.
 */
export declare class TenantIsolationContext {
    private static instance;
    private currentContexts;
    private constructor();
    static getInstance(): TenantIsolationContext;
    setContext(executionId: string, context: TenantContext): void;
    getContext(executionId: string): TenantContext | undefined;
    clearContext(executionId: string): void;
    enforceIsolation(executionId: string, entityOrgId: string): void;
}
