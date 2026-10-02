import { SubscriptionService } from "./subscription-service.js";
import { EntitlementService } from "./entitlement-service.js";
export declare class DunningService {
    private subscriptionService;
    private entitlementService;
    constructor(subscriptionService: SubscriptionService, entitlementService: EntitlementService);
    handlePaymentFailure(organizationId: string, subscriptionId: string, gracePeriodDays: number): void;
    restrictSubscription(organizationId: string, subscriptionId: string): void;
    handlePaymentRecovery(organizationId: string, subscriptionId: string): void;
}
