import type { SecureRequestContext } from "./request-context.js";
export interface RateLimitProfile {
    windowMs: number;
    maxRequests: number;
    keyStrategy: "ip" | "authenticated" | "mixed";
}
export declare const RATE_LIMIT_PROFILES: Record<string, RateLimitProfile>;
export interface RateLimiter {
    check(ctx: SecureRequestContext, profileName: string): void;
}
/**
 * Creates an independent in-memory rate limiter (in a real production
 * system this would use Redis or similar). One instance is created per
 * `createControlPlaneApi()` call rather than shared at module scope, so
 * concurrent API instances — notably in tests, which each spin up their
 * own server — never accumulate counts against each other.
 */
export declare function createRateLimiter(): RateLimiter;
