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
export function validateApiKeyScopes(raw, field = "apiKey.scopes") {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new ValidationError(`${field} must be a non-empty array`);
    }
    for (const scope of raw) {
        requireText(scope, `${field}[]`);
        if (!/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/.test(scope)) {
            throw new ValidationError(`${field}[] must be "resource:action" (received: ${scope})`);
        }
    }
    return [...new Set(raw)];
}
export function validateWebhookEvents(raw) {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new ValidationError("webhookEndpoint.events must be a non-empty array");
    }
    for (const event of raw) {
        requireText(event, "webhookEndpoint.events[]");
        if (!/^[*]|[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(event)) {
            throw new ValidationError(`webhookEndpoint.events[] must be "*" or "domain.entity" (received: ${event})`);
        }
    }
    return [...new Set(raw)];
}
/**
 * Webhook targets must be TLS and must not address loopback or private
 * networks, so a registered endpoint cannot be pointed back at internal
 * infrastructure.
 */
export function validateWebhookUrl(raw) {
    requireText(raw, "webhookEndpoint.url");
    const value = raw;
    if (value.length > 2048) {
        throw new ValidationError("webhookEndpoint.url must be at most 2048 characters");
    }
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new ValidationError("webhookEndpoint.url must be a valid URL");
    }
    if (parsed.protocol !== "https:") {
        throw new ValidationError("webhookEndpoint.url must use https so delivery signatures are not exposed in transit");
    }
    const host = parsed.hostname.toLowerCase();
    const blocked = host === "localhost" ||
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
        throw new ValidationError("webhookEndpoint.url must not target loopback or private network addresses");
    }
    return parsed.toString();
}
