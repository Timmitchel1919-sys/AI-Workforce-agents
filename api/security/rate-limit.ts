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
export const DEFAULT_RATE_LIMIT_PROFILES: Record<string, RateLimitProfile> = {
  public_default: { windowMs: 60_000, maxRequests: 60 },
  authenticated_default: { windowMs: 60_000, maxRequests: 600 },
  auth_sensitive: { windowMs: 60_000, maxRequests: 20 },
  security_read: { windowMs: 60_000, maxRequests: 120 },
  security_mutation: { windowMs: 60_000, maxRequests: 30 },
  destructive_request: { windowMs: 60_000, maxRequests: 20 },
  destructive_approval: { windowMs: 60_000, maxRequests: 60 },
  deployment: { windowMs: 60_000, maxRequests: 10 },
  access_management: { windowMs: 60_000, maxRequests: 30 },
  // R7 (ADR-0034): post-auth per-operator cap on every non-GET route. Sits
  // on top of the existing route+IP bucket and the Function `maxInstances`.
  // Tighter than `authenticated_default` because mutations are the ones a
  // compromised token can meaningfully abuse.
  operator_mutation: { windowMs: 60_000, maxRequests: 120 },
};

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Pure in-memory limiter. One instance per API composition root.
 */
export function createInMemoryRateLimiter(
  options: {
    profiles?: Record<string, RateLimitProfile>;
    clock?: () => number;
  } = {},
): RateLimiter {
  const profiles = options.profiles ?? DEFAULT_RATE_LIMIT_PROFILES;
  const clock = options.clock ?? (() => Date.now());
  const buckets = new Map<string, Bucket>();

  return {
    check(input) {
      const profile =
        profiles[input.profile] ?? profiles["authenticated_default"];
      if (!profile) {
        return { allowed: true, profile: input.profile };
      }
      const now = input.now ?? clock();
      const key = `${input.profile}:${input.key}`;
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + profile.windowMs };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      if (bucket.count > profile.maxRequests) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((bucket.resetAt - now) / 1000),
        );
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds,
          profile: input.profile,
        };
      }
      return {
        allowed: true,
        remaining: Math.max(0, profile.maxRequests - bucket.count),
        profile: input.profile,
      };
    },
  };
}
