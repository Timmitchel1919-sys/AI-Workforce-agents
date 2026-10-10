export class EntitlementService {
    catalog;
    constructor(catalog) {
        this.catalog = catalog;
    }
    overrides = new Map();
    restrictions = new Map();
    entitlementDefs = new Map();
    registerEntitlementDefinition(def) {
        this.entitlementDefs.set(def.entitlementId, def);
    }
    setContractOverride(override) {
        this.overrides.set(override.organizationId, override);
    }
    addRestriction(restriction) {
        const list = this.restrictions.get(restriction.organizationId) || [];
        list.push(restriction);
        this.restrictions.set(restriction.organizationId, list);
    }
    removeRestrictions(organizationId) {
        this.restrictions.delete(organizationId);
    }
    checkFeatureAccess(organizationId, featureId, subscription, currentUsage) {
        // 1. Check for commercial restrictions (e.g. past due)
        const orgRestrictions = this.restrictions.get(organizationId) || [];
        for (const res of orgRestrictions) {
            if (res.restrictedCapabilities.includes(featureId)) {
                return { allowed: false, reason: "PAYMENT_RESTRICTION" };
            }
        }
        // 2. Resolve Subscription state
        if (!subscription) {
            return { allowed: false, reason: "SUBSCRIPTION_INACTIVE" };
        }
        if (["PAST_DUE", "CANCELLED", "ENDED", "EXPIRED", "UNKNOWN"].includes(subscription.status)) {
            if (subscription.status === "EXPIRED" ||
                subscription.status === "ENDED") {
                return { allowed: false, reason: "TRIAL_EXPIRED" };
            }
            return { allowed: false, reason: "SUBSCRIPTION_INACTIVE" };
        }
        // 3. Resolve Plan Version
        const planVersion = this.catalog.getPlanVersion(subscription.planVersionId);
        if (!planVersion) {
            return { allowed: false, reason: "UNKNOWN" };
        }
        // 4. Resolve Contract Override
        const contract = this.overrides.get(organizationId);
        const now = new Date();
        let isContractActive = false;
        if (contract &&
            contract.contractStart <= now &&
            contract.contractEnd >= now) {
            isContractActive = true;
        }
        // 5. Evaluate Base Entitlements vs Overrides
        const baseEntitlement = planVersion.entitlements[featureId];
        const overrideEntitlement = isContractActive && contract?.customEntitlements
            ? contract.customEntitlements[featureId]
            : undefined;
        const overrideQuota = isContractActive && contract?.customQuotas
            ? contract.customQuotas[featureId]
            : undefined;
        const def = this.entitlementDefs.get(featureId);
        if (def?.type === "QUOTA") {
            const limit = overrideQuota !== undefined
                ? overrideQuota
                : typeof baseEntitlement === "number"
                    ? baseEntitlement
                    : 0;
            if (limit === 0) {
                return { allowed: false, reason: "NOT_ENTITLED", limit: 0 };
            }
            if (currentUsage !== undefined && currentUsage >= limit) {
                return { allowed: false, reason: "QUOTA_EXCEEDED", limit };
            }
            return {
                allowed: true,
                reason: isContractActive && overrideQuota !== undefined
                    ? "CONTRACT_OVERRIDE"
                    : "ENTITLED",
                limit,
            };
        }
        else {
            const allowed = overrideEntitlement !== undefined
                ? overrideEntitlement
                : !!baseEntitlement;
            if (!allowed) {
                return { allowed: false, reason: "PLAN_LIMIT" };
            }
            return {
                allowed: true,
                reason: isContractActive && overrideEntitlement !== undefined
                    ? "CONTRACT_OVERRIDE"
                    : "ENTITLED",
            };
        }
    }
}
