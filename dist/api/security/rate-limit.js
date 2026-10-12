import { RateLimitError } from "./errors.js";
export const RATE_LIMIT_PROFILES = {
    "AUTHENTICATION": { windowMs: 60000, maxRequests: 20, keyStrategy: "ip" },
    "PRIVILEGED_MUTATIONS": { windowMs: 60000, maxRequests: 50, keyStrategy: "authenticated" },
    "GENERAL_READ": { windowMs: 60000, maxRequests: 200, keyStrategy: "mixed" },
    "DESTRUCTIVE_ACTIONS": { windowMs: 300000, maxRequests: 10, keyStrategy: "authenticated" },
};
/**
 * Creates an independent in-memory rate limiter (in a real production
 * system this would use Redis or similar). One instance is created per
 * `createControlPlaneApi()` call rather than shared at module scope, so
 * concurrent API instances — notably in tests, which each spin up their
 * own server — never accumulate counts against each other.
 */
export function createRateLimiter() {
    const store = new Map();
    return {
        check(ctx, profileName) {
            const profile = RATE_LIMIT_PROFILES[profileName];
            if (!profile)
                return; // No profile, no limit
            let keyPart = "";
            if (profile.keyStrategy === "ip") {
                keyPart = ctx.client.ipHash || "unknown-ip";
            }
            else if (profile.keyStrategy === "authenticated") {
                keyPart = ctx.identity?.uid || ctx.client.ipHash || "unauth";
            }
            else {
                keyPart = ctx.identity?.uid || ctx.client.ipHash || "unknown";
            }
            const key = `ratelimit:${profileName}:${keyPart}`;
            const now = Date.now();
            let record = store.get(key);
            if (!record || record.expiresAt < now) {
                record = { count: 0, expiresAt: now + profile.windowMs };
            }
            record.count += 1;
            store.set(key, record);
            if (record.count > profile.maxRequests) {
                throw new RateLimitError("Too Many Requests");
            }
        },
    };
}
