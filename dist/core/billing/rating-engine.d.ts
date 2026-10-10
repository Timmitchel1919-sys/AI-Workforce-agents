import { Price, BillableUsage, RatedCharge } from "../../contracts/billing.js";
export declare class RatingEngine {
    rateUsage(subscriptionId: string, usage: BillableUsage, price: Price): RatedCharge[];
    rateSubscription(subscriptionId: string, price: Price, periodStart: Date, periodEnd: Date): RatedCharge[];
}
