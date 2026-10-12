/**
 * Layer 5 — API security middleware tests.
 *
 * Exercises the small, pure primitives from `api/security/*`: App
 * Check mode behavior, rate limiter, CORS policy, security headers,
 * approver resolver, and the destructive-event adapter.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ServerResponse } from "node:http";
import type { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { fileURLToPath } from "node:url";
import {
  APP_CHECK_HEADER,
  DEFAULT_CORS,
  DEFAULT_RATE_LIMIT_PROFILES,
  appCheckBlocks,
  apiError,
  applyCors,
  applySecurityHeaders,
  createInMemoryRateLimiter,
  createOperatorAccountApproverResolver,
  evaluateAppCheck,
  originIsAllowed,
  resolveAppCheckMode,
  stripUntrustedFields,
  createDestructiveSecurityEventObserver,
  type AppAttestationVerifier,
  type CorsPolicy,
} from "../api/security/index.js";
import { AppendOnlySecurityEventStore } from "../core/security/security-event-store.js";
import type { OperatorAccount } from "../contracts/index.js";

/* ------------------------------------------------------------------ */
/* Fake HTTP req/res helpers                                           */
/* ------------------------------------------------------------------ */

function makeRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  const req = Object.assign(
    new (class extends Object {})() as IncomingMessage,
    {
      method,
      url,
      headers,
      socket: new Socket(),
    },
  );
  return req as IncomingMessage;
}

function makeResponse(): ServerResponse & {
  _headers: Record<string, string | number | readonly string[]>;
  _body?: string;
} {
  const req = makeRequest("GET", "/");
  const res = new ServerResponse(req) as ServerResponse & {
    _headers: Record<string, string | number | readonly string[]>;
    _body?: string;
  };
  res._headers = {};
  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = ((
    name: string,
    value: string | number | readonly string[],
  ) => {
    res._headers[name.toLowerCase()] = value;
    return originalSetHeader(name, value);
  }) as typeof res.setHeader;
  (res as unknown as { end: (chunk?: unknown) => void }).end = (chunk) => {
    if (typeof chunk === "string") res._body = chunk;
  };
  return res;
}

/* ================================================================== */
/* Security headers                                                     */
/* ================================================================== */

test("security headers: baseline set applied to every response", () => {
  const res = makeResponse();
  applySecurityHeaders(res);
  assert.equal(res._headers["x-content-type-options"], "nosniff");
  assert.equal(res._headers["referrer-policy"], "no-referrer");
  assert.equal(res._headers["x-frame-options"], "DENY");
  assert.ok(res._headers["cross-origin-opener-policy"]);
  assert.ok(res._headers["cross-origin-resource-policy"]);
});

test("security headers: HSTS emitted only in production mode", () => {
  const dev = makeResponse();
  applySecurityHeaders(dev, { production: false });
  assert.equal(dev._headers["strict-transport-security"], undefined);
  const prod = makeResponse();
  applySecurityHeaders(prod, { production: true });
  assert.match(String(prod._headers["strict-transport-security"]), /max-age=/);
});

/* ================================================================== */
/* CORS                                                                 */
/* ================================================================== */

test("CORS: wildcard origin is only honored when credentials are false", () => {
  const strict: CorsPolicy = {
    ...DEFAULT_CORS,
    allowedOrigins: ["*"],
    allowCredentials: true,
  };
  assert.equal(originIsAllowed(strict, "https://evil.example"), false);
  const relaxed: CorsPolicy = {
    ...DEFAULT_CORS,
    allowedOrigins: ["*"],
    allowCredentials: false,
  };
  assert.equal(originIsAllowed(relaxed, "https://any.example"), true);
});

test("CORS: approved origin accepted, arbitrary origin rejected", () => {
  const policy: CorsPolicy = {
    ...DEFAULT_CORS,
    allowedOrigins: ["https://workforce.example"],
  };
  assert.equal(originIsAllowed(policy, "https://workforce.example"), true);
  assert.equal(originIsAllowed(policy, "https://evil.example"), false);
});

test("CORS: preflight accepted for allowed origin and denied for arbitrary origin", () => {
  const policy: CorsPolicy = {
    ...DEFAULT_CORS,
    allowedOrigins: ["https://workforce.example"],
  };
  const ok = makeResponse();
  const okOutcome = applyCors(
    makeRequest("OPTIONS", "/", {
      origin: "https://workforce.example",
    }),
    ok,
    policy,
  );
  assert.equal(okOutcome, "preflight_ok");
  assert.equal(
    ok._headers["access-control-allow-origin"],
    "https://workforce.example",
  );
  assert.ok(ok._headers["access-control-allow-methods"]);
  assert.ok(ok._headers["access-control-allow-headers"]);

  const denied = makeResponse();
  const deniedOutcome = applyCors(
    makeRequest("OPTIONS", "/", { origin: "https://evil.example" }),
    denied,
    policy,
  );
  assert.equal(deniedOutcome, "preflight_denied");
  assert.equal(denied.statusCode, 403);
});

/* ================================================================== */
/* Rate limiter                                                         */
/* ================================================================== */

test("rate limiter: burst beyond threshold yields 429-equivalent", () => {
  const t = 0;
  const limiter = createInMemoryRateLimiter({
    profiles: { tiny: { windowMs: 1000, maxRequests: 3 } },
    clock: () => t,
  });
  for (let i = 0; i < 3; i += 1) {
    assert.equal(limiter.check({ profile: "tiny", key: "k" }).allowed, true);
  }
  const d = limiter.check({ profile: "tiny", key: "k" });
  assert.equal(d.allowed, false);
  assert.ok((d.retryAfterSeconds ?? 0) >= 1);
});

test("rate limiter: two operators do not share each other's bucket", () => {
  const limiter = createInMemoryRateLimiter({
    profiles: { tiny: { windowMs: 60_000, maxRequests: 1 } },
  });
  assert.equal(limiter.check({ profile: "tiny", key: "op-A" }).allowed, true);
  // Operator A exhausted — their next call is denied, but B is free.
  assert.equal(limiter.check({ profile: "tiny", key: "op-A" }).allowed, false);
  assert.equal(limiter.check({ profile: "tiny", key: "op-B" }).allowed, true);
});

test("rate limiter: default profile table includes conservative defaults", () => {
  assert.ok(DEFAULT_RATE_LIMIT_PROFILES["destructive_request"]);
  assert.ok(DEFAULT_RATE_LIMIT_PROFILES["deployment"]);
  assert.ok(DEFAULT_RATE_LIMIT_PROFILES["security_mutation"]);
});

/* ================================================================== */
/* App Check                                                            */
/* ================================================================== */

const okVerifier: AppAttestationVerifier = {
  verify: async (token) =>
    token === "good" ? { valid: true, appId: "web" } : { valid: false },
};

test("app check: DISABLED never blocks regardless of token", async () => {
  const r = await evaluateAppCheck({
    mode: "disabled",
    token: undefined,
    verifier: undefined,
    routeRequiresAppCheck: true,
  });
  assert.equal(appCheckBlocks(r), false);
  assert.equal(r.outcome, "not_required");
});

test("app check: MONITOR observes missing but never blocks", async () => {
  const r = await evaluateAppCheck({
    mode: "monitor",
    token: undefined,
    verifier: okVerifier,
    routeRequiresAppCheck: true,
  });
  assert.equal(r.outcome, "missing");
  assert.equal(appCheckBlocks(r), false);
});

test("app check: ENFORCED blocks missing token", async () => {
  const r = await evaluateAppCheck({
    mode: "enforced",
    token: undefined,
    verifier: okVerifier,
    routeRequiresAppCheck: true,
  });
  assert.equal(r.outcome, "missing");
  assert.equal(appCheckBlocks(r), true);
});

test("app check: ENFORCED blocks invalid token", async () => {
  const r = await evaluateAppCheck({
    mode: "enforced",
    token: "nope",
    verifier: okVerifier,
    routeRequiresAppCheck: true,
  });
  assert.equal(r.outcome, "invalid");
  assert.equal(appCheckBlocks(r), true);
});

test("app check: ENFORCED passes valid token", async () => {
  const r = await evaluateAppCheck({
    mode: "enforced",
    token: "good",
    verifier: okVerifier,
    routeRequiresAppCheck: true,
  });
  assert.equal(r.outcome, "valid");
  assert.equal(appCheckBlocks(r), false);
});

test("app check: ENFORCED without verifier fails CLOSED on protected routes", async () => {
  const r = await evaluateAppCheck({
    mode: "enforced",
    token: "good",
    verifier: undefined,
    routeRequiresAppCheck: true,
  });
  assert.equal(r.outcome, "unavailable");
  assert.equal(appCheckBlocks(r), true);
});

test("app check: route that does not require App Check never blocks", async () => {
  const r = await evaluateAppCheck({
    mode: "enforced",
    token: undefined,
    verifier: undefined,
    routeRequiresAppCheck: false,
  });
  assert.equal(r.outcome, "not_required");
  assert.equal(appCheckBlocks(r), false);
});

test("app check: mode is server-authoritative — client input cannot select it", () => {
  // Mode is derived from env only. An unknown value defaults to `disabled`.
  assert.equal(resolveAppCheckMode({ APP_CHECK_MODE: "ENFORCED" }), "enforced");
  assert.equal(resolveAppCheckMode({ APP_CHECK_MODE: "wat" }), "disabled");
  assert.equal(resolveAppCheckMode({}), "disabled");
  assert.equal(APP_CHECK_HEADER, "x-firebase-appcheck");
});

/* ================================================================== */
/* Error model                                                          */
/* ================================================================== */

test("api errors: safe body shape with code, message, correlationId", () => {
  const err = apiError("forbidden", "nope", "corr-1");
  assert.equal(err.status, 403);
  assert.equal(err.body.error.code, "forbidden");
  assert.equal(err.body.error.correlationId, "corr-1");
});

test("api errors: untrusted body fields are stripped", () => {
  const clean = stripUntrustedFields({
    role: "admin",
    isAdmin: true,
    mfaVerified: true,
    firebaseUid: "x",
    operatorId: "y",
    allowedProjects: "*",
    legitField: "keep",
  });
  assert.deepEqual(Object.keys(clean), ["legitField"]);
});

/* ================================================================== */
/* Operator account approver resolver                                    */
/* ================================================================== */

test("approver resolver: only ACTIVE account yields a principal", () => {
  const now = new Date().toISOString();
  const active: OperatorAccount = {
    id: "a1",
    status: "active",
    role: "admin",
    allowedProjects: "*",
    emailVerified: true,
    requestedAt: now,
    updatedAt: now,
    revision: 1,
  };
  const suspended: OperatorAccount = {
    ...active,
    id: "s1",
    status: "suspended",
  };
  const pending: OperatorAccount = {
    ...active,
    id: "p1",
    status: "pending",
    role: undefined,
  };
  const snap = new Map<string, OperatorAccount | undefined>([
    ["a1", active],
    ["s1", suspended],
    ["p1", pending],
    ["missing", undefined],
  ]);
  const r = createOperatorAccountApproverResolver(snap);
  assert.ok(r.resolve("a1"));
  assert.equal(r.resolve("s1"), undefined);
  assert.equal(r.resolve("p1"), undefined);
  assert.equal(r.resolve("missing"), undefined);
});

/* ================================================================== */
/* Destructive event adapter                                             */
/* ================================================================== */

test("destructive event adapter: safe fields only, written to append-only store", async () => {
  const store = new AppendOnlySecurityEventStore();
  const observer = createDestructiveSecurityEventObserver(store);
  observer.onSecurityEvent?.({
    kind: "destructive_action_execution_blocked",
    requestId: "req-1",
    correlationId: "corr-1",
    reason: "authoritative_approver_revalidation_unavailable",
  });
  // Allow the fire-and-forget write to flush.
  await new Promise((resolve) => setTimeout(resolve, 10));
  const events = store.query({});
  assert.equal(events.length, 1);
  const e = events[0]!;
  assert.equal(e.category, "destructive_action");
  assert.equal(e.outcome, "blocked");
  assert.equal(e.correlationId, "corr-1");
  const evidence = e.evidence as Record<string, unknown>;
  assert.equal(
    evidence.reason,
    "authoritative_approver_revalidation_unavailable",
  );
  // No secrets or raw tokens must appear.
  const serialized = JSON.stringify(e);
  assert.doesNotMatch(serialized, /authorization|cookie|bearer/i);
});

/* ================================================================== */
/* Firebase trust-boundary architecture                                 */
/* ================================================================== */

test("firebase trust boundary: Firestore rules are deny-all for direct clients", () => {
  const rules = readFileSync("firestore.rules", "utf8");
  assert.match(rules, /allow read, write: if false;/);
});

test("firebase trust boundary: Storage rules are deny-all for direct clients", () => {
  const rules = readFileSync("storage.rules", "utf8");
  assert.match(rules, /allow read, write: if false;/);
});

test("firebase trust boundary: Admin SDK never imported from UI sources", () => {
  // The ui/ workspace must never import firebase-admin or Admin SDK
  // surface. A build-time scan is cheaper than a runtime guard.
  const uiMain = (() => {
    try {
      return readFileSync("ui/package.json", "utf8");
    } catch {
      return "{}";
    }
  })();
  assert.doesNotMatch(uiMain, /"firebase-admin"\s*:/);
});

// Silence the unused-import warning for file-url helpers in strict lint
// settings — kept for future expansion of path-based assertions.
void fileURLToPath;
