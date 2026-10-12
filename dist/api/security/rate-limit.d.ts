import type { SecureRequestContext } from "./request-context.js";
export interface RateLimitProfile {
    windowMs: number;
    maxRequests: number;
    keyStrategy: "ip" | "authenticated" | "mixed";
}
export declare const RATE_LIMIT_PROFILES: Record<string, RateLimitProfile>;
export declare function checkRateLimit(ctx: SecureRequestContext, profileName: string): void;
