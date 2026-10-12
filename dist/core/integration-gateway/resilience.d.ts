/**
 * Health, rate limiting and retry — the parts that keep uncontrolled agent activity from
 * exhausting a provider and keep a failing provider from taking the system down.
 *
 * Health is DERIVED from real call outcomes (and an optional probe). The limiter is a
 * per-connector token bucket that also honours the provider's own reported limit. Retry is
 * by failure kind: authentication/authorization/validation/permanent failures are never
 * retried, and only idempotent operations are retried at all.
 */
import { type FailureKind, type HubConnector, type OperationClass } from "../../contracts/integration-gateway.js";
import type { SecurityAlertService } from "../security-governance/alerts.js";
import type { GovernanceLedger } from "../security-governance/ledger.js";
import type { HubRegistry } from "./registry.js";
export declare const RETRYABLE: readonly FailureKind[];
export declare function shouldRetryCall(kind: FailureKind, operation: OperationClass, attempt: number, maxAttempts?: 3): boolean;
export declare function retryDelayMs(kind: FailureKind, attempt: number, retryAfterMs?: number): number;
export declare class RateLimiter {
    private readonly now;
    private readonly perMinute;
    private readonly buckets;
    private readonly blockedUntil;
    constructor(now: () => number, perMinute?: (connectorId: string) => number);
    /** Consume a token, or say how long to wait. */
    take(connectorId: string): {
        ok: true;
    } | {
        ok: false;
        retryAfterMs: number;
        reason: string;
    };
    /** Provider-reported state: stop sending before the provider starts refusing. */
    observe(connectorId: string, rl: {
        remaining?: number;
        resetAt?: string;
    } | undefined, retryAfterMs?: number): void;
}
export interface CallOutcome {
    ok: boolean;
    kind?: FailureKind;
    message?: string;
    latencyMs: number;
    rateLimit?: {
        remaining?: number;
        limit?: number;
        resetAt?: string;
    };
}
export declare class HealthMonitor {
    private readonly registry;
    private readonly ledger;
    private readonly alerts;
    private readonly now;
    private readonly openedAt;
    constructor(registry: HubRegistry, ledger: GovernanceLedger, alerts: SecurityAlertService, now: () => number);
    /** Is the circuit open (too many consecutive provider-side failures)? */
    isOpen(connectorId: string): boolean;
    record(connectorId: string, o: CallOutcome): HubConnector;
}
