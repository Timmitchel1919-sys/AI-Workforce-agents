import { PaymentTransaction } from "../../contracts/billing.js";
export interface PaymentProviderAdapter {
    createCustomer(organizationId: string, email: string): Promise<string>;
    createSubscription(customerId: string, planProviderId: string): Promise<string>;
    cancelSubscription(subscriptionProviderId: string): Promise<void>;
    createPaymentIntent(customerId: string, amountMinorUnits: number, currency: string): Promise<PaymentTransaction>;
    verifyWebhookSignature(payload: string, signature: string): boolean;
}
export declare class NotConfiguredPaymentAdapter implements PaymentProviderAdapter {
    createCustomer(organizationId: string, email: string): Promise<string>;
    createSubscription(customerId: string, planProviderId: string): Promise<string>;
    cancelSubscription(subscriptionProviderId: string): Promise<void>;
    createPaymentIntent(customerId: string, amountMinorUnits: number, currency: string): Promise<PaymentTransaction>;
    verifyWebhookSignature(payload: string, signature: string): boolean;
}
export declare class TestPaymentAdapter implements PaymentProviderAdapter {
    private webhookSecret;
    createCustomer(organizationId: string, email: string): Promise<string>;
    createSubscription(customerId: string, planProviderId: string): Promise<string>;
    cancelSubscription(subscriptionProviderId: string): Promise<void>;
    createPaymentIntent(customerId: string, amountMinorUnits: number, currency: string): Promise<PaymentTransaction>;
    verifyWebhookSignature(payload: string, signature: string): boolean;
}
