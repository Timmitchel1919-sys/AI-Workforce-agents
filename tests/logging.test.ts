import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryLogSink,
  Logger,
  createLogger,
  redact,
} from "../core/index.js";

test("logging: redact removes sensitive keys recursively", () => {
  const safe = redact({
    userId: "u1",
    password: "hunter2",
    nested: { apiKey: "sk-123", ok: true },
    tokens: ["a", "b"],
  }) as Record<string, unknown>;

  assert.equal(safe.userId, "u1");
  assert.equal(safe.password, "[REDACTED]");
  assert.deepEqual(safe.nested, { apiKey: "[REDACTED]", ok: true });
  assert.equal(safe.tokens, "[REDACTED]");
});

test("logging: redact tolerates circular references", () => {
  const circular: Record<string, unknown> = { name: "x" };
  circular.self = circular;
  const safe = redact(circular) as Record<string, unknown>;
  assert.equal(safe.name, "x");
  assert.equal(safe.self, "[Circular]");
});

test("logging: level threshold suppresses lower-severity records", () => {
  const sink = new InMemoryLogSink();
  const logger = new Logger({ scope: "t", level: "WARN", sink });

  logger.debug("d");
  logger.info("i");
  logger.warn("w");
  logger.error("e");

  assert.deepEqual(
    sink.records.map((r) => r.level),
    ["WARN", "ERROR"],
  );
  assert.equal(logger.isLevelEnabled("INFO"), false);
  assert.equal(logger.isLevelEnabled("ERROR"), true);
});

test("logging: child binds metadata merged into every record", () => {
  const sink = new InMemoryLogSink();
  const child = createLogger("svc", { sink }).child({ projectId: "p1" });

  child.info("created", { extra: 1 });

  assert.equal(sink.records.length, 1);
  const record = sink.records[0]!;
  assert.equal(record.scope, "svc");
  assert.equal(record.context.projectId, "p1");
  assert.equal(record.context.extra, 1);
  assert.ok(record.timestamp);
});

test("logging: emitted context is redacted before reaching the sink", () => {
  const sink = new InMemoryLogSink();
  const logger = new Logger({ sink });

  logger.info("auth", { userId: "u1", accessToken: "secret-value" });

  assert.equal(sink.records[0]!.context.accessToken, "[REDACTED]");
  assert.equal(sink.records[0]!.context.userId, "u1");
});
