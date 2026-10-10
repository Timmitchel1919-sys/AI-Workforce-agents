export class NotConfiguredPaymentAdapter {
    async createCustomer(_organizationId, _email) {
        throw new Error("BILLING PROVIDER: NOT CONFIGURED");
    }
    async createSubscription(_customerId, _planProviderId) {
        throw new Error("BILLING PROVIDER: NOT CONFIGURED");
    }
    async cancelSubscription(_subscriptionProviderId) {
        throw new Error("BILLING PROVIDER: NOT CONFIGURED");
    }
    async createPaymentIntent(_customerId, _amountMinorUnits, _currency) {
        throw new Error("BILLING PROVIDER: NOT CONFIGURED");
    }
    verifyWebhookSignature(_payload, _signature) {
        throw new Error("BILLING PROVIDER: NOT CONFIGURED");
    }
}
export class TestPaymentAdapter {
    webhookSecret = "test_whsec_12345";
    async createCustomer(organizationId, _email) {
        return `cust_test_${organizationId}`;
    }
    async createSubscription(_customerId, _planProviderId) {
        return `sub_test_${Date.now()}`;
    }
    async cancelSubscription(_subscriptionProviderId) {
        // Test mode: succeed immediately
    }
    async createPaymentIntent(customerId, amountMinorUnits, currency) {
        return {
            paymentId: `pi_test_${Date.now()}`,
            organizationId: customerId.replace("cust_test_", ""),
            billingAccountId: "ba_test",
            provider: "TEST_ADAPTER",
            providerPaymentRef: `ref_${Date.now()}`,
            amountMinorUnits,
            currency,
            status: "PENDING",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    }
    verifyWebhookSignature(payload, signature) {
        // In test mode, we accept a hardcoded signature "test_valid_sig" for testing webhooks
        if (signature === "test_valid_sig")
            return true;
        return false;
    }
}
