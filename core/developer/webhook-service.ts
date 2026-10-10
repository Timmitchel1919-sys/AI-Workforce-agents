import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  NotFoundError,
  ValidationError,
  requireText,
  validateWebhookEvents,
  validateWebhookUrl,
  type RedactedWebhookEndpoint,
  type RegisteredWebhookEndpoint,
  type WebhookDelivery,
  type WebhookDeliveryStatus,
  type WebhookEndpoint,
  type WebhookTransport,
} from "../../contracts/index.js";

/**
 * Outbound webhooks: endpoint registration, signed delivery, and an honest
 * delivery log.
 *
 * Two rules this service holds to:
 *  - A signing secret is shown once at registration and never returned again.
 *  - Delivery status is whatever the injected transport reports. Nothing here
 *    invents a success.
 */

const SECRET_BYTES = 32;
const MAX_DESCRIPTION_LENGTH = 500;
/** Consecutive failures after which an endpoint stops receiving deliveries. */
const FAILURE_THRESHOLD = 5;
const MAX_ERROR_LENGTH = 200;

function assertDescription(description: string): string {
  if (description === undefined || description === null) return "";
  const value = String(description);
  if (value.length > MAX_DESCRIPTION_LENGTH) {
    throw new ValidationError(
      `webhookEndpoint.description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
    );
  }
  return value;
}

function statusClass(statusCode: number): string {
  return `${Math.floor(statusCode / 100)}xx`;
}

function truncate(value: string): string {
  return value.length > MAX_ERROR_LENGTH
    ? `${value.slice(0, MAX_ERROR_LENGTH)}…`
    : value;
}

function signaturesMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export class WebhookService {
  private readonly endpoints = new Map<string, WebhookEndpoint>();
  private readonly deliveries = new Map<string, WebhookDelivery>();
  /** endpointId -> live signing secret. Never placed on a returned record. */
  private readonly secrets = new Map<string, string>();

  constructor(private readonly transport: WebhookTransport) {}

  registerEndpoint(
    organizationId: string,
    url: string,
    description: string,
    events: readonly string[],
  ): RegisteredWebhookEndpoint {
    requireText(organizationId, "organizationId");
    const validatedUrl = validateWebhookUrl(url);
    const validatedEvents = validateWebhookEvents(events);
    const descriptionText = assertDescription(description);

    const secret = `whsec_${randomBytes(SECRET_BYTES).toString("base64url")}`;
    const endpointId = `ep_${randomUUID()}`;
    const timestamp = new Date().toISOString();

    const endpoint: WebhookEndpoint = {
      endpointId,
      organizationId,
      url: validatedUrl,
      description: descriptionText,
      events: validatedEvents,
      secretDigest: createHmac("sha256", secret)
        .update(endpointId, "utf8")
        .digest("hex"),
      status: "ACTIVE",
      consecutiveFailures: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.endpoints.set(endpointId, endpoint);
    this.secrets.set(endpointId, secret);

    return { endpoint: this.redact(endpoint), secret };
  }

  /**
   * `t=<unix>,v1=<hex>`. The timestamp is inside the signed material so a
   * replayed request is detectable by a recipient comparing against its own
   * clock.
   */
  sign(payload: string, secret: string, timestampSeconds?: number): string {
    const stamp = timestampSeconds ?? Math.floor(Date.now() / 1000);
    const mac = createHmac("sha256", secret)
      .update(`${stamp}.${payload}`, "utf8")
      .digest("hex");
    return `t=${stamp},v1=${mac}`;
  }

  /**
   * Verify a signature before trusting a payload. Accepting a signature
   * without checking it is how tampering gets in.
   */
  verifySignature(
    payload: string,
    secret: string,
    presented: string,
    timestampSeconds?: number,
  ): boolean {
    requireText(payload, "payload");
    requireText(secret, "secret");
    requireText(presented, "signature");
    return signaturesMatch(
      presented,
      this.sign(payload, secret, timestampSeconds),
    );
  }

  /**
   * Deliver one event to every matching endpoint of `organizationId`.
   *
   * Endpoints past the consecutive-failure threshold, or deactivated, are
   * recorded as skipped rather than silently dropped, so a caller can tell the
   * difference between "nothing to send" and "suppressed".
   */
  async dispatch(
    organizationId: string,
    eventId: string,
    eventType: string,
    payload: unknown,
  ): Promise<WebhookDelivery[]> {
    requireText(organizationId, "organizationId");
    requireText(eventId, "eventId");
    requireText(eventType, "eventType");

    const targets = this.listEndpoints(organizationId).filter(
      (endpoint) =>
        endpoint.events.includes(eventType) || endpoint.events.includes("*"),
    );
    const body = JSON.stringify(payload ?? null);
    const produced: WebhookDelivery[] = [];

    for (const redacted of targets) {
      const endpoint = this.endpoints.get(redacted.endpointId);
      if (!endpoint) continue;
      const secret = this.secrets.get(endpoint.endpointId);
      if (!secret) continue;

      if (endpoint.status !== "ACTIVE") {
        produced.push(
          this.record(endpoint, eventId, eventType, {
            status: "SKIPPED_ENDPOINT_INACTIVE",
            signature: "",
            latencyMs: 0,
          }),
        );
        continue;
      }

      const signature = this.sign(body, secret);

      try {
        const result = await this.transport.send({
          url: endpoint.url,
          body,
          signature,
          headers: {
            "content-type": "application/json",
            "x-aiw-event-id": eventId,
            "x-aiw-event-type": eventType,
            "x-aiw-signature": signature,
          },
        });

        const delivered =
          result.statusCode >= 200 && result.statusCode < 300;

        produced.push(
          this.record(endpoint, eventId, eventType, {
            status: delivered ? "DELIVERED" : "FAILED",
            responseStatusClass: statusClass(result.statusCode),
            signature,
            latencyMs: result.latencyMs,
            ...(delivered
              ? {}
              : {
                  error: truncate(
                    `endpoint responded ${result.statusCode}`,
                  ),
                }),
          }),
        );

        this.applyOutcome(endpoint, delivered);
      } catch (error) {
        produced.push(
          this.record(endpoint, eventId, eventType, {
            status: "FAILED",
            signature,
            latencyMs: 0,
            error: truncate(
              error instanceof Error ? error.message : "transport error",
            ),
          }),
        );
        this.applyOutcome(endpoint, false);
      }
    }

    return produced;
  }

  listEndpoints(organizationId: string): RedactedWebhookEndpoint[] {
    requireText(organizationId, "organizationId");
    return [...this.endpoints.values()]
      .filter((endpoint) => endpoint.organizationId === organizationId)
      .map((endpoint) => this.redact(endpoint));
  }

  /** Deliveries for an endpoint the caller owns. Cross-tenant reads throw. */
  listDeliveries(
    organizationId: string,
    endpointId: string,
  ): WebhookDelivery[] {
    const endpoint = this.ownedEndpoint(organizationId, endpointId);
    return [...this.deliveries.values()].filter(
      (delivery) => delivery.endpointId === endpoint.endpointId,
    );
  }

  deactivateEndpoint(
    organizationId: string,
    endpointId: string,
  ): RedactedWebhookEndpoint {
    const endpoint = this.ownedEndpoint(organizationId, endpointId);
    endpoint.status = "INACTIVE";
    endpoint.updatedAt = new Date().toISOString();
    return this.redact(endpoint);
  }

  /**
   * Issue a fresh signing secret. The previous secret stops working
   * immediately, which is the point of rotation.
   */
  rotateSecret(
    organizationId: string,
    endpointId: string,
  ): RegisteredWebhookEndpoint {
    const endpoint = this.ownedEndpoint(organizationId, endpointId);
    const secret = `whsec_${randomBytes(SECRET_BYTES).toString("base64url")}`;
    this.secrets.set(endpoint.endpointId, secret);
    endpoint.secretDigest = createHmac("sha256", secret)
      .update(endpoint.endpointId, "utf8")
      .digest("hex");
    endpoint.consecutiveFailures = 0;
    endpoint.updatedAt = new Date().toISOString();
    return { endpoint: this.redact(endpoint), secret };
  }

  private ownedEndpoint(
    organizationId: string,
    endpointId: string,
  ): WebhookEndpoint {
    requireText(organizationId, "organizationId");
    requireText(endpointId, "endpointId");
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint || endpoint.organizationId !== organizationId) {
      throw new NotFoundError(`webhook endpoint ${endpointId} not found`);
    }
    return endpoint;
  }

  /**
   * Track consecutive failures. Crossing the threshold deactivates the
   * endpoint; resuming delivery requires an explicit human action, never a
   * quiet automatic retry.
   */
  private applyOutcome(endpoint: WebhookEndpoint, delivered: boolean): void {
    endpoint.consecutiveFailures = delivered
      ? 0
      : endpoint.consecutiveFailures + 1;
    endpoint.updatedAt = new Date().toISOString();
    if (endpoint.consecutiveFailures >= FAILURE_THRESHOLD) {
      endpoint.status = "INACTIVE";
    }
  }

  private record(
    endpoint: WebhookEndpoint,
    eventId: string,
    eventType: string,
    outcome: {
      status: WebhookDeliveryStatus;
      responseStatusClass?: string;
      error?: string;
      signature: string;
      latencyMs: number;
    },
  ): WebhookDelivery {
    const delivery: WebhookDelivery = {
      deliveryId: `del_${randomUUID()}`,
      endpointId: endpoint.endpointId,
      eventId,
      eventType,
      status: outcome.status,
      attempt: 1,
      signature: outcome.signature,
      deliveredAt: new Date().toISOString(),
      latencyMs: outcome.latencyMs,
      ...(outcome.responseStatusClass
        ? { responseStatusClass: outcome.responseStatusClass }
        : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
    };
    this.deliveries.set(delivery.deliveryId, delivery);
    return delivery;
  }

  /** Strip the usable secret before an endpoint leaves the service. */
  private redact(endpoint: WebhookEndpoint): RedactedWebhookEndpoint {
    const secret = this.secrets.get(endpoint.endpointId);
    const secretHint = secret
      ? `${secret.slice(0, 8)}…${secret.slice(-4)}`
      : "…";
    const { secretDigest: _secretDigest, ...safe } = endpoint;
    return { ...safe, secretHint };
  }
}
