import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryRateLimiter,
  DEFAULT_RATE_LIMIT_PROFILES,
} from "../api/security/rate-limit.js";

test("R7: operator_mutation profile exists with a tight bound", () => {
  const profile = DEFAULT_RATE_LIMIT_PROFILES["operator_mutation"];
  assert.ok(profile, "operator_mutation profile is registered");
  assert.ok(profile.windowMs > 0 && profile.windowMs <= 60_000);
  // Tighter than authenticated_default (600) so a compromised token can't
  // issue thousands of mutations per minute.
  assert.ok(profile.maxRequests <= 300);
});

test("R7: operator_mutation enforces per-operator bucket, returns Retry-After", () => {
  const now = { v: 1_000_000 };
  const limiter = createInMemoryRateLimiter({
    profiles: {
      ...DEFAULT_RATE_LIMIT_PROFILES,
      // Shrink for a deterministic test.
      operator_mutation: { windowMs: 1_000, maxRequests: 3 },
    },
    clock: () => now.v,
  });
  const key = "operator:op-123";

  // Three allowed within the window.
  for (let i = 0; i < 3; i += 1) {
    const d = limiter.check({ profile: "operator_mutation", key });
    assert.equal(d.allowed, true, `request #${i + 1} should be allowed`);
  }

  // Fourth is blocked with a Retry-After hint.
  const blocked = limiter.check({ profile: "operator_mutation", key });
  assert.equal(blocked.allowed, false);
  assert.ok(
    (blocked.retryAfterSeconds ?? 0) >= 1,
    "Retry-After must be at least 1s",
  );

  // A DIFFERENT operator shares no bucket.
  const other = limiter.check({
    profile: "operator_mutation",
    key: "operator:op-999",
  });
  assert.equal(other.allowed, true);

  // After the window elapses, the bucket resets.
  now.v += 2_000;
  const after = limiter.check({ profile: "operator_mutation", key });
  assert.equal(after.allowed, true);
});
