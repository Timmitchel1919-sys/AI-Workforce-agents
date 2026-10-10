import { CommercialProduct, CommercialPlan, PlanVersion, Price } from "../../contracts/billing.js";
export declare class CatalogService {
    private products;
    private plans;
    private planVersions;
    private prices;
    registerProduct(product: CommercialProduct): void;
    getProduct(productId: string): CommercialProduct | undefined;
    registerPlan(plan: CommercialPlan): void;
    getPlan(planId: string): CommercialPlan | undefined;
    registerPlanVersion(version: PlanVersion): void;
    getPlanVersion(versionId: string): PlanVersion | undefined;
    registerPrice(price: Price): void;
    getPrice(priceId: string): Price | undefined;
    resolveEffectivePlanVersion(planId: string): PlanVersion | undefined;
    resolvePriceForVersion(planVersionId: string): Price[];
}
