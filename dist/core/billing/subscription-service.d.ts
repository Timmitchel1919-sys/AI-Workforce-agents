import { Subscription, SubscriptionStatus } from "../../contracts/billing.js";
export declare class SubscriptionService {
    private subscriptions;
    private auditLog;
    createSubscription(sub: Subscription): void;
    getSubscription(subscriptionId: string): Subscription | undefined;
    transitionStatus(subscriptionId: string, newStatus: SubscriptionStatus, actor: string): void;
    processUsageMetering(subscriptionId: string, usage: number, limit: number, actor: string): void;
    cancelSubscription(subscriptionId: string, actor: string, cancelAtPeriodEnd?: boolean): void;
    private recordAudit;
}
