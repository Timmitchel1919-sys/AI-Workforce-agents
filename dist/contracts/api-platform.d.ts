export type ApiKeyStatus = "ACTIVE" | "REVOKED" | "EXPIRED";
export interface ApiKey {
    keyId: string;
    organizationId: string;
    name: string;
    /** Non-secret locator, e.g. `sk_live_9f2c41ab`. Safe to display. */
    locator: string;
    /** `salt:hash` of the secret. Never the secret itself. */
    digest: string;
    scopes: readonly string[];
    status: ApiKeyStatus;
    expiresAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
}
/** An issued key plus its one-time plaintext secret. */
export interface IssuedApiKey {
    record: ApiKey;
    /** Full credential. Returned once; the caller must persist it now. */
    secret: string;
}
/** The verified identity behind an authenticated request. */
export interface ApiKeyPrincipal {
    keyId: string;
    organizationId: string;
    scopes: readonly string[];
}
export type OAuthAppStatus = "ACTIVE" | "SUSPENDED";
export interface OAuthApp {
    clientId: string;
    organizationId: string;
    name: string;
    description: string;
    redirectUris: readonly string[];
    /** `salt:hash` of the client secret. Never the secret itself. */
    clientSecretDigest: string;
    allowedScopes: readonly string[];
    status: OAuthAppStatus;
    createdAt: string;
}
export interface OAuthAppWithSecret {
    app: OAuthApp;
    /** Returned once at registration. */
    clientSecret: string;
}
export type WebhookEndpointStatus = "ACTIVE" | "INACTIVE";
export interface WebhookEndpoint {
    endpointId: string;
    organizationId: string;
    url: string;
    description: string;
    /** Subscribed event names, or `["*"]` for all. */
    events: readonly string[];
    /**
     * Digest of the live signing secret. The plaintext secret is never stored
     * on the record and is never returned after registration.
     */
    secretDigest: string;
    status: WebhookEndpointStatus;
    consecutiveFailures: number;
    createdAt: string;
    updatedAt: string;
}
/** An endpoint as returned to its owner: carries no usable secret. */
export interface RedactedWebhookEndpoint extends Omit<WebhookEndpoint, "secretDigest"> {
    /** Display-only hint, e.g. `whsec_ab12…9f3a`. */
    secretHint: string;
}
/** An endpoint plus its one-time plaintext signing secret. */
export interface RegisteredWebhookEndpoint {
    endpoint: RedactedWebhookEndpoint;
    /** Returned once, at registration or rotation. */
    secret: string;
}
export type WebhookDeliveryStatus = "DELIVERED" | "FAILED" | "SKIPPED_ENDPOINT_INACTIVE";
export interface WebhookDelivery {
    deliveryId: string;
    endpointId: string;
    eventId: string;
    eventType: string;
    /** `"2xx"` when the transport returned a response. Absent when it did not. */
    responseStatusClass?: string;
    status: WebhookDeliveryStatus;
    /** Human-readable cause. Never a stack trace or a secret. */
    error?: string;
    attempt: number;
    /** Signed header value as sent. */
    signature: string;
    deliveredAt: string;
    latencyMs: number;
}
/** Result of one HTTP attempt, supplied by the caller of `dispatch`. */
export interface WebhookTransportResult {
    statusCode: number;
    body?: string;
    latencyMs: number;
}
/**
 * Outbound HTTP transport. Injected so delivery is deterministic under test
 * and so no layer of this service invents a delivery outcome.
 */
export interface WebhookTransport {
    send(request: {
        url: string;
        body: string;
        signature: string;
        headers: Record<string, string>;
    }): Promise<WebhookTransportResult>;
}
export declare function validateApiKeyScopes(raw: unknown, field?: string): string[];
export declare function validateWebhookEvents(raw: unknown): string[];
/**
 * Webhook targets must be TLS and must not address loopback or private
 * networks, so a registered endpoint cannot be pointed back at internal
 * infrastructure.
 */
export declare function validateWebhookUrl(raw: unknown): string;
