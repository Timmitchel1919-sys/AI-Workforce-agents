import { type RedactedWebhookEndpoint, type RegisteredWebhookEndpoint, type WebhookDelivery, type WebhookTransport } from "../../contracts/index.js";
export declare class WebhookService {
    private readonly transport;
    private readonly endpoints;
    private readonly deliveries;
    /** endpointId -> live signing secret. Never placed on a returned record. */
    private readonly secrets;
    constructor(transport: WebhookTransport);
    registerEndpoint(organizationId: string, url: string, description: string, events: readonly string[]): RegisteredWebhookEndpoint;
    /**
     * `t=<unix>,v1=<hex>`. The timestamp is inside the signed material so a
     * replayed request is detectable by a recipient comparing against its own
     * clock.
     */
    sign(payload: string, secret: string, timestampSeconds?: number): string;
    /**
     * Verify a signature before trusting a payload. Accepting a signature
     * without checking it is how tampering gets in.
     */
    verifySignature(payload: string, secret: string, presented: string, timestampSeconds?: number): boolean;
    /**
     * Deliver one event to every matching endpoint of `organizationId`.
     *
     * Endpoints past the consecutive-failure threshold, or deactivated, are
     * recorded as skipped rather than silently dropped, so a caller can tell the
     * difference between "nothing to send" and "suppressed".
     */
    dispatch(organizationId: string, eventId: string, eventType: string, payload: unknown): Promise<WebhookDelivery[]>;
    listEndpoints(organizationId: string): RedactedWebhookEndpoint[];
    /** Deliveries for an endpoint the caller owns. Cross-tenant reads throw. */
    listDeliveries(organizationId: string, endpointId: string): WebhookDelivery[];
    deactivateEndpoint(organizationId: string, endpointId: string): RedactedWebhookEndpoint;
    /**
     * Issue a fresh signing secret. The previous secret stops working
     * immediately, which is the point of rotation.
     */
    rotateSecret(organizationId: string, endpointId: string): RegisteredWebhookEndpoint;
    private ownedEndpoint;
    /**
     * Track consecutive failures. Crossing the threshold deactivates the
     * endpoint; resuming delivery requires an explicit human action, never a
     * quiet automatic retry.
     */
    private applyOutcome;
    private record;
    /** Strip the usable secret before an endpoint leaves the service. */
    private redact;
}
