import { PaymentProviderAdapter } from "./payment-adapter.js";
import { PaymentProviderEvent } from "../../contracts/billing.js";

export class WebhookHandler {
  private processedEvents = new Set<string>(); // Idempotency check store

  constructor(private adapter: PaymentProviderAdapter) {}

  handleWebhook(
    payloadRaw: string,
    signature: string,
    event: PaymentProviderEvent,
  ): boolean {
    // 1. Verify signature
    if (!this.adapter.verifyWebhookSignature(payloadRaw, signature)) {
      throw new Error("Invalid webhook signature");
    }

    // 2. Idempotency Check
    if (this.processedEvents.has(event.eventId)) {
      // Already processed, acknowledge but do not re-apply
      return true;
    }

    // 3. Dispatch to business logic
    this.dispatch(event);

    // 4. Mark as processed
    this.processedEvents.add(event.eventId);
    return true;
  }

  private dispatch(event: PaymentProviderEvent) {
    switch (event.eventType) {
      case "payment.succeeded":
        // Handle payment success -> mark invoice paid, update subscription
        break;
      case "payment.failed":
        // Handle dunning/restrictions
        break;
      case "subscription.cancelled":
        // Handle provider-side cancellation
        break;
      default:
        // Unknown or irrelevant events ignored
        break;
    }
  }
}
