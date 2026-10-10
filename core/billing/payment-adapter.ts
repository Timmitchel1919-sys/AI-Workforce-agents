import {
  PaymentTransaction,
  PaymentProviderEvent,
} from "../../contracts/billing.js";

export interface PaymentProviderAdapter {
  createCustomer(organizationId: string, email: string): Promise<string>;
  createSubscription(
    customerId: string,
    planProviderId: string,
  ): Promise<string>;
  cancelSubscription(subscriptionProviderId: string): Promise<void>;
  createPaymentIntent(
    customerId: string,
    amountMinorUnits: number,
    currency: string,
  ): Promise<PaymentTransaction>;
  verifyWebhookSignature(payload: string, signature: string): boolean;
}

export class TestPaymentAdapter implements PaymentProviderAdapter {
  private webhookSecret = "test_whsec_12345";

  async createCustomer(organizationId: string, email: string): Promise<string> {
    return `cust_test_${organizationId}`;
  }

  async createSubscription(
    customerId: string,
    planProviderId: string,
  ): Promise<string> {
    return `sub_test_${Date.now()}`;
  }

  async cancelSubscription(subscriptionProviderId: string): Promise<void> {
    // Test mode: succeed immediately
  }

  async createPaymentIntent(
    customerId: string,
    amountMinorUnits: number,
    currency: string,
  ): Promise<PaymentTransaction> {
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

  verifyWebhookSignature(payload: string, signature: string): boolean {
    // In test mode, we accept a hardcoded signature "test_valid_sig" for testing webhooks
    if (signature === "test_valid_sig") return true;
    return false;
  }
}
