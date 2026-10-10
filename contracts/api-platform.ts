/**
 * External integration contracts: scoped API credentials, OAuth applications,
 * and outbound webhooks.
 *
 * Credentials are referenced by a non-secret locator and carried as
 * `locator.secret`. Only a salted digest of the secret is ever retained, so a
 * stored record cannot be replayed against the API.
 *
 * Timestamps are ISO-8601 strings, matching the rest of the contract surface.
 */
import { requireText, ValidationError } from "./index.js";

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
export interface RedactedWebhookEndpoint
  extends Omit<WebhookEndpoint, "secretDigest"> {
  /** Display-only hint, e.g. `whsec_ab12…9f3a`. */
  secretHint: string;
}

/** An endpoint plus its one-time plaintext signing secret. */
export interface RegisteredWebhookEndpoint {
  endpoint: RedactedWebhookEndpoint;
  /** Returned once, at registration or rotation. */
  secret: string;
}

export type WebhookDeliveryStatus =
  | "DELIVERED"
  | "FAILED"
  | "SKIPPED_ENDPOINT_INACTIVE";

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

export function validateApiKeyScopes(
  raw: unknown,
  field = "apiKey.scopes",
): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError(`${field} must be a non-empty array`);
  }
  for (const scope of raw) {
    requireText(scope, `${field}[]`);
    if (!/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/.test(scope)) {
      throw new ValidationError(
        `${field}[] must be "resource:action" (received: ${scope})`,
      );
    }
  }
  return [...new Set(raw as string[])];
}

export function validateWebhookEvents(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError(
      "webhookEndpoint.events must be a non-empty array",
    );
  }
  for (const event of raw) {
    requireText(event, "webhookEndpoint.events[]");
    if (!/^[*]|[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(event)) {
      throw new ValidationError(
        `webhookEndpoint.events[] must be "*" or "domain.entity" (received: ${event})`,
      );
    }
  }
  return [...new Set(raw as string[])];
}

/**
 * Webhook targets must be TLS and must not address loopback or private
 * networks, so a registered endpoint cannot be pointed back at internal
 * infrastructure.
 */
export function validateWebhookUrl(raw: unknown): string {
  requireText(raw, "webhookEndpoint.url");
  const value = raw as string;
  if (value.length > 2048) {
    throw new ValidationError(
      "webhookEndpoint.url must be at most 2048 characters",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ValidationError("webhookEndpoint.url must be a valid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new ValidationError(
      "webhookEndpoint.url must use https so delivery signatures are not exposed in transit",
    );
  }

  const host = parsed.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (blocked) {
    throw new ValidationError(
      "webhookEndpoint.url must not target loopback or private network addresses",
    );
  }

  return parsed.toString();
}
