export class SubscriptionService {
    subscriptions = new Map();
    auditLog = [];
    createSubscription(sub) {
        this.subscriptions.set(sub.subscriptionId, sub);
        this.recordAudit(sub.organizationId, "SYSTEM", "SUBSCRIPTION_CREATED", "Subscription", sub.subscriptionId, { status: sub.status });
    }
    getSubscription(subscriptionId) {
        return this.subscriptions.get(subscriptionId);
    }
    transitionStatus(subscriptionId, newStatus, actor) {
        const sub = this.subscriptions.get(subscriptionId);
        if (!sub)
            throw new Error("Subscription not found");
        const oldStatus = sub.status;
        // Validate state transitions for commercial lifecycle logic
        const validTransitions = {
            "TRIALING": ["ACTIVE", "CANCELLED", "EXPIRED", "RESTRICTED"],
            "ACTIVE": ["PAST_DUE", "CANCELLED", "RESTRICTED"],
            "PAST_DUE": ["ACTIVE", "RESTRICTED", "CANCELLED"],
            "RESTRICTED": ["ACTIVE", "CANCELLED"],
            "CANCELLED": ["ACTIVE"], // Reactivation
            "EXPIRED": ["ACTIVE"],
            "INCOMPLETE": ["TRIALING", "ACTIVE", "CANCELLED"],
            "UNKNOWN": ["ACTIVE", "CANCELLED"]
        };
        if (validTransitions[oldStatus] && !validTransitions[oldStatus].includes(newStatus)) {
            throw new Error(`Invalid transition from ${oldStatus} to ${newStatus}`);
        }
        sub.status = newStatus;
        if (newStatus === "CANCELLED") {
            sub.cancelledAt = new Date();
        }
        this.recordAudit(sub.organizationId, actor, "SUBSCRIPTION_STATUS_CHANGED", "Subscription", sub.subscriptionId, { oldStatus, newStatus });
    }
    processUsageMetering(subscriptionId, usage, limit, actor) {
        // Integrate real Usage Metering from the multi-tenancy layer into a commercial lifecycle state.
        const sub = this.subscriptions.get(subscriptionId);
        if (!sub)
            throw new Error("Subscription not found");
        if (usage > limit) {
            if (sub.status === "ACTIVE" || sub.status === "TRIALING") {
                this.transitionStatus(subscriptionId, "RESTRICTED", actor);
            }
        }
        else if (sub.status === "RESTRICTED") {
            this.transitionStatus(subscriptionId, "ACTIVE", actor);
        }
    }
    cancelSubscription(subscriptionId, actor, cancelAtPeriodEnd = false) {
        const sub = this.subscriptions.get(subscriptionId);
        if (!sub)
            throw new Error("Subscription not found");
        if (cancelAtPeriodEnd) {
            sub.cancelAtPeriodEnd = true;
            this.recordAudit(sub.organizationId, actor, "SUBSCRIPTION_CANCEL_SCHEDULED", "Subscription", sub.subscriptionId, { end: sub.currentPeriodEnd });
        }
        else {
            this.transitionStatus(subscriptionId, "CANCELLED", actor);
        }
    }
    recordAudit(orgId, actor, action, type, resId, details) {
        this.auditLog.push({
            id: `audit_${Date.now()}`,
            organizationId: orgId,
            actor,
            action,
            resourceType: type,
            resourceId: resId,
            timestamp: new Date(),
            details
        });
    }
}
