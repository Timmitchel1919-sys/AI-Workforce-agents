import { PaymentTransaction } from "../../contracts/billing.js";
export interface PaymentProviderAdapter {
    createCustomer(organizationId: string, email: string): Promise<string>;
    createSubscription(_customerId: string, planProviderId: string): Promise<string>;
    cancelSubscription(subscriptionProviderId: string): Promise<void>;
    createPaymentIntent(customerId: string, amountMinorUnits: number, currency: string): Promise<PaymentTransaction>;
    verifyWebhookSignature(payload: string, signature: string): boolean;
}
export declare class NotConfiguredPaymentAdapter implements PaymentProviderAdapter {
    createCustomer(_organizationId: string, _email: string): Promise<string>;
    createSubscription(_customerId: string, _planProviderId: string): Promise<string>;
    cancelSubscription(_subscriptionProviderId: string): Promise<void>;
    createPaymentIntent(_customerId: string, _amountMinorUnits: number, _currency: string): Promise<PaymentTransaction>;
    verifyWebhookSignature(_payload: string, _signature: string): boolean;
}
export declare class TestPaymentAdapter implements PaymentProviderAdapter {
    private webhookSecret;
    createCustomer(organizationId: string, _email: string): Promise<string>;
    createSubscription(_customerId: string, _planProviderId: string): Promise<string>;
    cancelSubscription(_subscriptionProviderId: string): Promise<void>;
    createPaymentIntent(customerId: string, amountMinorUnits: number, currency: string): Promise<PaymentTransaction>;
    verifyWebhookSignature(payload: string, signature: string): boolean;
}
