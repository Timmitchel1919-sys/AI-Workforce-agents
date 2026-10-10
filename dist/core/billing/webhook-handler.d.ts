import { PaymentProviderAdapter } from "./payment-adapter.js";
import { PaymentProviderEvent } from "../../contracts/billing.js";
export declare class WebhookHandler {
    private adapter;
    private processedEvents;
    constructor(adapter: PaymentProviderAdapter);
    handleWebhook(payloadRaw: string, signature: string, event: PaymentProviderEvent): boolean;
    private dispatch;
}
