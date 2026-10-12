/**
 * Application-level rate limiter. Defense-in-depth; NEVER a
 * replacement for capability authorization. Each
 * `createControlPlaneApi` invocation instantiates its own in-memory
 * limiter (see `rate-limit-store.ts`), so tests and concurrent
 * processes do not share buckets.
 */
export interface RateLimitRequest {
    profile: string;
    /**
     * Composite identity. Prefer `operator:<id>` when an authenticated
     * operator is known; fall back to `ip:<ip-hash>` for pre-auth
     * routes. The limiter treats the key opaquely.
     */
    key: string;
    now?: number;
}
export interface RateLimitDecision {
    allowed: boolean;
    remaining?: number;
    retryAfterSeconds?: number;
    profile: string;
}
export interface RateLimiter {
    check(input: RateLimitRequest): RateLimitDecision;
}
export interface RateLimitProfile {
    windowMs: number;
    maxRequests: number;
}
/**
 * Conservative defaults. Tune per deployment via
 * `createInMemoryRateLimiter({ profiles: { … } })`. The limits are
 * generous for ordinary reads and tighter for sensitive mutations.
 */
export declare const DEFAULT_RATE_LIMIT_PROFILES: Record<string, RateLimitProfile>;
/**
 * Pure in-memory limiter. One instance per API composition root.
 */
export declare function createInMemoryRateLimiter(options?: {
    profiles?: Record<string, RateLimitProfile>;
    clock?: () => number;
}): RateLimiter;
