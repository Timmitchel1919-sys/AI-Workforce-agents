import { Subscription, CommercialContractOverride, EntitlementDefinition, CommercialRestriction } from "../../contracts/billing.js";
import { CatalogService } from "./catalog-service.js";
export interface FeatureAccessResult {
    allowed: boolean;
    reason: "ENTITLED" | "NOT_ENTITLED" | "QUOTA_EXCEEDED" | "SUBSCRIPTION_INACTIVE" | "TRIAL_EXPIRED" | "PAYMENT_RESTRICTION" | "PLAN_LIMIT" | "CONTRACT_OVERRIDE" | "UNKNOWN";
    limit?: number;
}
export declare class EntitlementService {
    private catalog;
    constructor(catalog: CatalogService);
    private overrides;
    private restrictions;
    private entitlementDefs;
    registerEntitlementDefinition(def: EntitlementDefinition): void;
    setContractOverride(override: CommercialContractOverride): void;
    addRestriction(restriction: CommercialRestriction): void;
    removeRestrictions(organizationId: string): void;
    checkFeatureAccess(organizationId: string, featureId: string, subscription?: Subscription, currentUsage?: number): FeatureAccessResult;
}
