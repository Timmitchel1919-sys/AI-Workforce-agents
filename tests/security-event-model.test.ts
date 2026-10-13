/**
 * Canonical Security Event model (Layer 4) — expanded taxonomy,
 * strengthened redaction, bounded evidence, extended query filters.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  AppendOnlySecurityEventStore,
  normalizeSecurityEvent,
  SECURITY_EVENT_LIMITS,
  SECURITY_EVENT_GENESIS_HASH,
  verifySecurityEventIntegrity,
} from "../core/index.js";
import {
  SECURITY_EVENT_CATEGORIES,
  SECURITY_EVENT_OUTCOMES,
  SECURITY_EVENT_TYPES,
} from "../contracts/index.js";

function baseEvent(
  overrides: Partial<Parameters<typeof normalizeSecurityEvent>[0]>,
) {
  return normalizeSecurityEvent({
    eventId: "evt-1",
    occurredAt: "2026-10-12T00:00:00.000Z",
    category: "authorization",
    type: SECURITY_EVENT_TYPES.AUTHZ_DENIED,
    severity: "high",
    outcome: "denied",
    actor: { kind: "agent", id: "a-1" },
    source: { kind: "api", id: "control-plane" },
    projectId: "p1",
    ...overrides,
  });
}

test("security-event: expanded categories include destructive_action, secrets, deployment, etc.", () => {
  for (const c of [
    "destructive_action",
    "secrets",
    "deployment",
    "data_access",
    "configuration",
    "integrity",
    "prompt_injection",
  ]) {
    assert.ok(
      (SECURITY_EVENT_CATEGORIES as readonly string[]).includes(c),
      `missing category ${c}`,
    );
  }
});

test("security-event: expanded outcomes include succeeded/pending/escalated/contained", () => {
  for (const o of ["succeeded", "pending", "escalated", "contained"]) {
    assert.ok(
      (SECURITY_EVENT_OUTCOMES as readonly string[]).includes(o),
      `missing outcome ${o}`,
    );
  }
});

test("security-event: redaction scrubs secret keys and token-shaped values", () => {
  const event = baseEvent({
    evidence: {
      password: "p",
      apiKey: "k",
      accessToken: "t",
      Authorization: "Bearer eyJhbGciOiJIUzI1NiJ",
      note: "sk-live-should-be-redacted-xxxxxxxx",
      pem: "-----BEGIN RSA PRIVATE KEY-----MIIEo…-----END RSA PRIVATE KEY-----",
    },
  });
  const evidence = event.evidence as Record<string, unknown>;
  assert.equal(evidence.password, "[REDACTED]");
  assert.equal(evidence.apiKey, "[REDACTED]");
  assert.equal(evidence.accessToken, "[REDACTED]");
  assert.equal(evidence.Authorization, "[REDACTED]");
  assert.match(evidence.note as string, /\[REDACTED\]/);
  assert.match(evidence.pem as string, /\[REDACTED\]/);
});

test("security-event: evidence depth, array length and string length are bounded", () => {
  const deepObject: Record<string, unknown> = { leaf: "ok" };
  // Build a nested chain deeper than SECURITY_EVENT_LIMITS.maxDepth.
  let node: Record<string, unknown> = deepObject;
  for (let i = 0; i < SECURITY_EVENT_LIMITS.maxDepth + 3; i += 1) {
    const next: Record<string, unknown> = { leaf: "ok" };
    node.deeper = next;
    node = next;
  }
  const longArray = new Array(SECURITY_EVENT_LIMITS.maxArrayItems + 5)
    .fill(0)
    .map((_, i) => `item-${i}`);
  const longString = "x".repeat(SECURITY_EVENT_LIMITS.maxStringLength + 100);
  const event = baseEvent({
    evidence: {
      nested: deepObject,
      items: longArray,
      message: longString,
    } as Record<string, unknown>,
  });
  const ev = event.evidence as Record<string, unknown>;
  assert.ok(JSON.stringify(ev).includes("[TRUNCATED_DEPTH]"));
  assert.ok(
    (ev.items as unknown[]).some((v) => v === "[TRUNCATED_ARRAY]"),
    "array truncation marker expected",
  );
  assert.ok(
    (ev.message as string).endsWith("…[TRUNCATED]"),
    "string truncation marker expected",
  );
});

test("security-event: duplicate eventId is rejected", () => {
  const store = new AppendOnlySecurityEventStore();
  store.append(baseEvent({ eventId: "same" }));
  assert.throws(() => store.append(baseEvent({ eventId: "same" })));
});

test("security-event: store exposes no update/delete surface", () => {
  const store = new AppendOnlySecurityEventStore();
  // Only append + query are on the public API.
  assert.equal(
    typeof (store as unknown as Record<string, unknown>).update,
    "undefined",
  );
  assert.equal(
    typeof (store as unknown as Record<string, unknown>).delete,
    "undefined",
  );
  assert.equal(
    typeof (store as unknown as Record<string, unknown>).remove,
    "undefined",
  );
  assert.equal(
    typeof (store as unknown as Record<string, unknown>).clear,
    "undefined",
  );
});

test("security-event: stored event is a clone — mutating input never leaks in", () => {
  const store = new AppendOnlySecurityEventStore();
  const input = baseEvent({ eventId: "clone-1" });
  store.append(input);
  // Attempt to mutate via the input object. Casting away readonly is safe
  // here because we are deliberately testing the store's defensive copy.
  (input as unknown as { severity: string }).severity = "info";
  const stored = store.query({ projectId: "p1" })[0];
  assert.equal(stored?.severity, "high");
});

test("security-event: append-only store creates a verifiable per-project hash chain", () => {
  const store = new AppendOnlySecurityEventStore();
  store.append(baseEvent({ eventId: "chain-1", projectId: "p1" }));
  store.append(
    baseEvent({
      eventId: "chain-2",
      projectId: "p1",
      occurredAt: "2026-10-12T00:00:01.000Z",
    }),
  );
  store.append(baseEvent({ eventId: "other-1", projectId: "p2" }));

  const p1 = store.query({ projectId: "p1" }).reverse();
  const p2 = store.query({ projectId: "p2" });
  assert.equal(p1[0]?.previousEventHash, SECURITY_EVENT_GENESIS_HASH);
  assert.equal(p1[1]?.previousEventHash, p1[0]?.eventHash);
  assert.equal(p2[0]?.previousEventHash, SECURITY_EVENT_GENESIS_HASH);
  assert.ok(p1.every(verifySecurityEventIntegrity));

  const tampered = { ...p1[1]!, outcome: "allowed" as const };
  assert.equal(verifySecurityEventIntegrity(tampered), false);
});

test("security-event: query filter by correlationId narrows results", () => {
  const store = new AppendOnlySecurityEventStore();
  store.append(baseEvent({ eventId: "a", correlationId: "corr-1" }));
  store.append(baseEvent({ eventId: "b", correlationId: "corr-2" }));
  const matched = store.query({ correlationId: "corr-1" });
  assert.equal(matched.length, 1);
  assert.equal(matched[0]?.eventId, "a");
});

test("security-event: query filter by destructiveActionId reads evidence shape", () => {
  const store = new AppendOnlySecurityEventStore();
  store.append(
    baseEvent({
      eventId: "d1",
      category: "destructive_action",
      type: SECURITY_EVENT_TYPES.DESTRUCTIVE_APPROVED,
      evidence: { destructiveActionId: "destructive_1" },
    }),
  );
  store.append(
    baseEvent({
      eventId: "d2",
      category: "destructive_action",
      type: SECURITY_EVENT_TYPES.DESTRUCTIVE_APPROVED,
      evidence: { destructiveActionId: "destructive_2" },
    }),
  );
  const matched = store.query({ destructiveActionId: "destructive_1" });
  assert.equal(matched.length, 1);
});
