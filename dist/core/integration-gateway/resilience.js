/**
 * Health, rate limiting and retry — the parts that keep uncontrolled agent activity from
 * exhausting a provider and keep a failing provider from taking the system down.
 *
 * Health is DERIVED from real call outcomes (and an optional probe). The limiter is a
 * per-connector token bucket that also honours the provider's own reported limit. Retry is
 * by failure kind: authentication/authorization/validation/permanent failures are never
 * retried, and only idempotent operations are retried at all.
 */
import { HUB_LIMITS, } from "../../contracts/integration-gateway.js";
export const RETRYABLE = [
    "TRANSIENT",
    "RATE_LIMIT",
    "PROVIDER_ERROR",
    "NETWORK",
];
const IDEMPOTENT = ["READ"];
export function shouldRetryCall(kind, operation, attempt, maxAttempts = HUB_LIMITS.maxAttempts) {
    if (attempt >= maxAttempts)
        return false;
    if (!RETRYABLE.includes(kind))
        return false;
    // A write that may have taken effect is never repeated blindly.
    return IDEMPOTENT.includes(operation);
}
export function retryDelayMs(kind, attempt, retryAfterMs) {
    if (kind === "RATE_LIMIT")
        return Math.min(retryAfterMs ?? 1000 * 2 ** attempt, 30_000);
    return Math.min(200 * 2 ** (attempt - 1), 4_000);
}
export class RateLimiter {
    now;
    perMinute;
    buckets = new Map();
    blockedUntil = new Map();
    constructor(now, perMinute = () => HUB_LIMITS.defaultRatePerMinute) {
        this.now = now;
        this.perMinute = perMinute;
    }
    /** Consume a token, or say how long to wait. */
    take(connectorId) {
        const t = this.now();
        const until = this.blockedUntil.get(connectorId);
        if (until && until > t)
            return {
                ok: false,
                retryAfterMs: until - t,
                reason: "the provider reported its rate limit is nearly exhausted",
            };
        const cap = this.perMinute(connectorId);
        const b = this.buckets.get(connectorId) ?? { tokens: cap, at: t };
        const refilled = Math.min(cap, b.tokens + ((t - b.at) / HUB_LIMITS.rateWindowMs) * cap);
        if (refilled < 1) {
            this.buckets.set(connectorId, { tokens: refilled, at: t });
            return {
                ok: false,
                retryAfterMs: Math.ceil(((1 - refilled) / cap) * HUB_LIMITS.rateWindowMs),
                reason: "the local rate limit for this connector was reached",
            };
        }
        this.buckets.set(connectorId, { tokens: refilled - 1, at: t });
        return { ok: true };
    }
    /** Provider-reported state: stop sending before the provider starts refusing. */
    observe(connectorId, rl, retryAfterMs) {
        const t = this.now();
        if (retryAfterMs)
            this.blockedUntil.set(connectorId, t + retryAfterMs);
        else if (rl?.remaining !== undefined && rl.remaining <= 1) {
            const reset = rl.resetAt ? Date.parse(rl.resetAt) : t + 30_000;
            this.blockedUntil.set(connectorId, Math.max(t + 1000, Math.min(reset, t + 60_000)));
        }
    }
}
export class HealthMonitor {
    registry;
    ledger;
    alerts;
    now;
    openedAt = new Map();
    constructor(registry, ledger, alerts, now) {
        this.registry = registry;
        this.ledger = ledger;
        this.alerts = alerts;
        this.now = now;
    }
    /** Is the circuit open (too many consecutive provider-side failures)? */
    isOpen(connectorId) {
        const at = this.openedAt.get(connectorId);
        if (at === undefined)
            return false;
        if (this.now() - at >= HUB_LIMITS.circuitOpenMs) {
            this.openedAt.delete(connectorId);
            return false;
        }
        return true;
    }
    record(connectorId, o) {
        const c = this.registry.require(connectorId);
        const at = new Date(this.now()).toISOString();
        const failed = !o.ok;
        const kind = o.kind;
        const health = {
            ...c.health,
            checkedAt: at,
            latencyMs: o.latencyMs,
            recentCalls: Math.min(c.health.recentCalls + 1, 1000),
            recentErrors: c.health.recentErrors + (failed ? 1 : 0),
            consecutiveFailures: failed ? c.health.consecutiveFailures + 1 : 0,
            authenticated: failed && kind === "AUTHENTICATION"
                ? false
                : o.ok
                    ? true
                    : c.health.authenticated,
            ...(failed && kind
                ? { lastError: { kind, message: (o.message ?? "").slice(0, 200), at } }
                : {}),
            ...(o.rateLimit ? { rateLimit: o.rateLimit } : {}),
        };
        if (o.ok)
            delete health.lastError;
        const before = c.status;
        const next = this.registry.recompute({ ...c, health });
        if (failed &&
            kind &&
            ["NETWORK", "PROVIDER_ERROR", "TRANSIENT"].includes(kind) &&
            health.consecutiveFailures >= HUB_LIMITS.circuitFailures)
            this.openedAt.set(connectorId, this.now());
        if (o.ok)
            this.openedAt.delete(connectorId);
        if (next.status !== before) {
            this.ledger.record("integration.health_changed", {
                actor: "integration-hub",
                severity: next.status === "ERROR"
                    ? "HIGH"
                    : next.status === "DEGRADED"
                        ? "MEDIUM"
                        : "INFO",
                result: next.status,
                detail: { connectorId, from: before, ...(kind ? { kind } : {}) },
            });
            if (next.status === "ERROR")
                this.alerts.raise({
                    severity: kind === "AUTHENTICATION" ? "HIGH" : "MEDIUM",
                    source: "POLICY",
                    event: "integration_error",
                    description: `${next.name} is in ERROR: ${health.lastError?.message ?? "repeated failures"}`,
                    evidence: {
                        connectorId,
                        kind: kind ?? "",
                        consecutiveFailures: health.consecutiveFailures,
                    },
                    dedupeKey: `integration-error:${connectorId}`,
                });
        }
        return next;
    }
}
