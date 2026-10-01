import { SubscriptionService } from "./subscription-service.js";
import { EntitlementService } from "./entitlement-service.js";

export class DunningService {
  constructor(
    private subscriptionService: SubscriptionService,
    private entitlementService: EntitlementService
  ) {}

  handlePaymentFailure(organizationId: string, subscriptionId: string, gracePeriodDays: number) {
    const sub = this.subscriptionService.getSubscription(subscriptionId);
    if (!sub) return;

    if (sub.status === "ACTIVE" || sub.status === "TRIALING") {
      this.subscriptionService.transitionStatus(subscriptionId, "PAST_DUE", "SYSTEM");
      
      // If no grace period, restrict immediately
      if (gracePeriodDays === 0) {
        this.restrictSubscription(organizationId, subscriptionId);
      } else {
        // Here we would normally schedule a job for grace period expiration
        // We'll simulate moving to GRACE_PERIOD state conceptually
        this.subscriptionService.transitionStatus(subscriptionId, "GRACE_PERIOD", "SYSTEM");
      }
    }
  }

  restrictSubscription(organizationId: string, subscriptionId: string) {
    const sub = this.subscriptionService.getSubscription(subscriptionId);
    if (!sub) return;

    if (sub.status !== "RESTRICTED") {
      this.subscriptionService.transitionStatus(subscriptionId, "RESTRICTED", "SYSTEM");
      this.entitlementService.addRestriction({
        organizationId,
        reason: "PAST_DUE",
        restrictedCapabilities: ["premium_agents", "unlimited_projects"] // Example of core capabilities restricted
      });
    }
  }

  handlePaymentRecovery(organizationId: string, subscriptionId: string) {
    const sub = this.subscriptionService.getSubscription(subscriptionId);
    if (!sub) return;

    if (["PAST_DUE", "GRACE_PERIOD", "RESTRICTED"].includes(sub.status)) {
      this.subscriptionService.transitionStatus(subscriptionId, "ACTIVE", "SYSTEM");
      this.entitlementService.removeRestrictions(organizationId);
    }
  }
}

