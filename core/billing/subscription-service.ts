import { Subscription, SubscriptionStatus, CommercialAuditRecord } from "../../contracts/billing.js";

export class SubscriptionService {
  private subscriptions = new Map<string, Subscription>();
  private auditLog: CommercialAuditRecord[] = [];

  createSubscription(sub: Subscription) {
    this.subscriptions.set(sub.subscriptionId, sub);
    this.recordAudit(sub.organizationId, "SYSTEM", "SUBSCRIPTION_CREATED", "Subscription", sub.subscriptionId, { status: sub.status });
  }

  getSubscription(subscriptionId: string): Subscription | undefined {
    return this.subscriptions.get(subscriptionId);
  }

  transitionStatus(subscriptionId: string, newStatus: SubscriptionStatus, actor: string) {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) throw new Error("Subscription not found");

    const oldStatus = sub.status;
    
    // Validate state transitions
    if (oldStatus === "CANCELLED" && newStatus !== "ACTIVE") { // Only allow reactivation to ACTIVE
      throw new Error(`Invalid transition from ${oldStatus} to ${newStatus}`);
    }
    
    if (oldStatus === "ACTIVE" && newStatus === "INCOMPLETE") {
      throw new Error(`Invalid transition from ${oldStatus} to ${newStatus}`);
    }

    sub.status = newStatus;
    
    if (newStatus === "CANCELLED") {
      sub.cancelledAt = new Date();
    }

    this.recordAudit(sub.organizationId, actor, "SUBSCRIPTION_STATUS_CHANGED", "Subscription", sub.subscriptionId, { oldStatus, newStatus });
  }

  cancelSubscription(subscriptionId: string, actor: string, cancelAtPeriodEnd: boolean = false) {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) throw new Error("Subscription not found");

    if (cancelAtPeriodEnd) {
      sub.cancelAtPeriodEnd = true;
      this.recordAudit(sub.organizationId, actor, "SUBSCRIPTION_CANCEL_SCHEDULED", "Subscription", sub.subscriptionId, { end: sub.currentPeriodEnd });
    } else {
      this.transitionStatus(subscriptionId, "CANCELLED", actor);
    }
  }

  private recordAudit(orgId: string, actor: string, action: string, type: string, resId: string, details: any) {
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
