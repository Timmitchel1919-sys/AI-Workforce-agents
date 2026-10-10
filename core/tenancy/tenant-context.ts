import { TenantContext } from "../../contracts/tenancy.js";

/**
 * Tenant Isolation Context.
 * Ensures queries, listing, and caches are isolated per organization.
 */
export class TenantIsolationContext {
  private static instance: TenantIsolationContext;
  private currentContexts = new Map<string, TenantContext>();

  private constructor() {}

  public static getInstance(): TenantIsolationContext {
    if (!TenantIsolationContext.instance) {
      TenantIsolationContext.instance = new TenantIsolationContext();
    }
    return TenantIsolationContext.instance;
  }

  public setContext(executionId: string, context: TenantContext) {
    this.currentContexts.set(executionId, context);
  }

  public getContext(executionId: string): TenantContext | undefined {
    return this.currentContexts.get(executionId);
  }

  public clearContext(executionId: string) {
    this.currentContexts.delete(executionId);
  }

  public enforceIsolation(executionId: string, entityOrgId: string): void {
    const context = this.getContext(executionId);
    if (!context) {
      throw new Error(
        "No tenant context found for execution. Strict isolation enforced.",
      );
    }
    if (context.organizationId !== entityOrgId) {
      throw new Error(
        `Tenant Isolation Violation: Access denied to organization ${entityOrgId}`,
      );
    }
  }
}
