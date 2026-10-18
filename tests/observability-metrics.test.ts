import assert from "node:assert/strict";
import test from "node:test";

import {
  createJsonLineMetrics,
  noopMetrics,
} from "../core/observability/metrics.js";
import { EnvSecretBroker } from "../adapters/vault/env-secret-broker.js";
import type { SecretReference } from "../contracts/index.js";

test("R11: json-line metrics emit kind + value + labels + timestamp", () => {
  const lines: string[] = [];
  const metrics = createJsonLineMetrics({
    writer: (line) => lines.push(line),
    clock: () => "2026-10-18T12:00:00.000Z",
  });
  metrics.counter("deploy_completed", { project: "p1" });
  metrics.counter("deploy_completed", { project: "p1" }, 3);
  metrics.duration("firebase_deploy_duration", 1234, { project: "p1" });
  assert.equal(lines.length, 3);
  const first = JSON.parse(lines[0]!);
  assert.equal(first.metric, "deploy_completed");
  assert.equal(first.kind, "counter");
  assert.equal(first.value, 1);
  assert.deepEqual(first.labels, { project: "p1" });
  assert.equal(first.at, "2026-10-18T12:00:00.000Z");
  const third = JSON.parse(lines[2]!);
  assert.equal(third.kind, "duration_ms");
  assert.equal(third.value, 1234);
});

test("R11: label values are sanitized against known secret shapes", () => {
  const lines: string[] = [];
  const metrics = createJsonLineMetrics({ writer: (line) => lines.push(line) });
  // A GitHub PAT-shape token must never land in a metric label.
  metrics.counter("probe", { token: "ghp_1234567890abcdefghij1234567890abcdef" });
  const parsed = JSON.parse(lines[0]!);
  assert.equal(parsed.labels.token, "[redacted]");
});

test("R11: EnvSecretBroker emits secret_resolution_{ok,denied}", async () => {
  const events: Array<{ metric: string; labels: Record<string, unknown> }> = [];
  const metrics = {
    counter: (name: string, labels: Record<string, unknown> = {}) => {
      events.push({ metric: name, labels });
    },
    duration: () => {},
  };
  const okBroker = new EnvSecretBroker({
    env: () => ({ AIW_SECRET_FIREBASE_TOKEN: "x" }),
    metrics,
  });
  await okBroker.resolve("secret://firebase-token" as SecretReference);
  const denyBroker = new EnvSecretBroker({ env: () => ({}), metrics });
  await denyBroker
    .resolve("secret://firebase-token" as SecretReference)
    .catch(() => {});
  assert.deepEqual(
    events.map((e) => e.metric),
    ["secret_resolution_ok", "secret_resolution_denied"],
  );
});

test("R11: noopMetrics is a safe default", () => {
  // Any valid signature with any args must be a no-throw no-op.
  noopMetrics.counter("x");
  noopMetrics.counter("x", { a: 1 }, 10);
  noopMetrics.duration("y", 100, { b: "c" });
});
