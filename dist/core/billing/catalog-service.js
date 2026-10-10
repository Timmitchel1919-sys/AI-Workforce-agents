export class CatalogService {
    products = new Map();
    plans = new Map();
    planVersions = new Map();
    prices = new Map();
    registerProduct(product) {
        this.products.set(product.productId, product);
    }
    getProduct(productId) {
        return this.products.get(productId);
    }
    registerPlan(plan) {
        this.plans.set(plan.planId, plan);
    }
    getPlan(planId) {
        return this.plans.get(planId);
    }
    registerPlanVersion(version) {
        this.planVersions.set(version.versionId, version);
    }
    getPlanVersion(versionId) {
        return this.planVersions.get(versionId);
    }
    registerPrice(price) {
        this.prices.set(price.priceId, price);
    }
    getPrice(priceId) {
        return this.prices.get(priceId);
    }
    // Authoritative resolution
    resolveEffectivePlanVersion(planId) {
        const plan = this.plans.get(planId);
        if (!plan || !plan.activeVersionId)
            return undefined;
        return this.planVersions.get(plan.activeVersionId);
    }
    resolvePriceForVersion(planVersionId) {
        const version = this.planVersions.get(planVersionId);
        if (!version)
            return [];
        const resolved = [];
        for (const ref of version.priceReferences) {
            const p = this.prices.get(ref);
            if (p)
                resolved.push(p);
        }
        return resolved;
    }
}
