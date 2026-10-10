import {
  CommercialProduct,
  CommercialPlan,
  PlanVersion,
  Price,
} from "../../contracts/billing.js";

export class CatalogService {
  private products = new Map<string, CommercialProduct>();
  private plans = new Map<string, CommercialPlan>();
  private planVersions = new Map<string, PlanVersion>();
  private prices = new Map<string, Price>();

  registerProduct(product: CommercialProduct) {
    this.products.set(product.productId, product);
  }

  getProduct(productId: string): CommercialProduct | undefined {
    return this.products.get(productId);
  }

  registerPlan(plan: CommercialPlan) {
    this.plans.set(plan.planId, plan);
  }

  getPlan(planId: string): CommercialPlan | undefined {
    return this.plans.get(planId);
  }

  registerPlanVersion(version: PlanVersion) {
    this.planVersions.set(version.versionId, version);
  }

  getPlanVersion(versionId: string): PlanVersion | undefined {
    return this.planVersions.get(versionId);
  }

  registerPrice(price: Price) {
    this.prices.set(price.priceId, price);
  }

  getPrice(priceId: string): Price | undefined {
    return this.prices.get(priceId);
  }

  // Authoritative resolution
  resolveEffectivePlanVersion(planId: string): PlanVersion | undefined {
    const plan = this.plans.get(planId);
    if (!plan || !plan.activeVersionId) return undefined;
    return this.planVersions.get(plan.activeVersionId);
  }

  resolvePriceForVersion(planVersionId: string): Price[] {
    const version = this.planVersions.get(planVersionId);
    if (!version) return [];
    const resolved: Price[] = [];
    for (const ref of version.priceReferences) {
      const p = this.prices.get(ref);
      if (p) resolved.push(p);
    }
    return resolved;
  }
}
