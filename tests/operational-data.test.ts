import assert from "node:assert/strict";
import test from "node:test";

import {
  AuditLog,
  InMemoryRepository,
  OperationalAuditSink,
  OperationalDataSystem,
  ValidationError,
  type OperationalEvent,
  type OperationalOutcome,
} from "../core/index.js";

const TIME = "2026-09-29T12:00:00.000Z";

function system() {
  return new OperationalDataSystem({
    events: new InMemoryRepository<OperationalEvent>(),
    outcomes: new InMemoryRepository<OperationalOutcome>(),
    clock: () => TIME,
  });
}

function event(id: string, projectId = "aims"): OperationalEvent {
  return {
    id,
    projectId,
    kind: "task_lifecycle",
    observedAt: "2026-09-20T12:00:00.000Z",
    recordedAt: TIME,
    provenance: { source: "workforce", sourceId: `audit-${id}` },
    dimensions: { state: "completed", durationMs: 1200 },
  };
}

function outcome(id: string, projectId = "aims"): OperationalOutcome {
  return {
    id,
    projectId,
    domain: "delivery",
    status: "succeeded",
    occurredAt: "2026-09-21T12:00:00.000Z",
    recordedAt: TIME,
    provenance: { source: "workforce", sourceId: `task-${id}` },
    actual: { durationMs: 1200 },
  };
}

test("operational facts are immutable, validated, and project-isolated", () => {
  const data = system();
  data.recordEvent(event("event-1"));
  data.recordOutcome(outcome("outcome-1"));
  data.recordEvent(event("event-2", "money-mind"));

  assert.equal(data.eventsForProject("aims").length, 1);
  assert.equal(data.outcomesForProject("aims").length, 1);
  assert.equal(data.eventsForProject("money-mind").length, 1);
  assert.throws(() => data.recordEvent(event("event-1")), ValidationError);
  assert.throws(
    () =>
      data.recordEvent({ ...event("secret"), dimensions: { apiKey: "no" } }),
    /sensitive data/,
  );
});

test("readiness is unknown without a domain policy and never treats no data as zero", () => {
  const data = system();
  const assessment = data.assessReadiness({
    projectId: "aims",
    domain: "cost",
  });
  assert.equal(assessment.status, "unknown");
  assert.equal(assessment.eventCount, 0);
  assert.equal(assessment.outcomeCount, 0);
});

test("readiness is domain-specific and marks partial evidence as limited", () => {
  const data = system();
  data.recordEvent(event("event-1"));
  const limited = data.assessReadiness({
    projectId: "aims",
    domain: "delivery",
    policy: { minEvents: 2, minOutcomes: 1, requireOutcomes: true },
  });
  assert.equal(limited.status, "limited");
  assert.match(limited.reasons.join(" "), /outcome/);

  data.recordEvent(event("event-2"));
  data.recordOutcome(outcome("outcome-1"));
  const ready = data.assessReadiness({
    projectId: "aims",
    domain: "delivery",
    policy: { minEvents: 2, minOutcomes: 1, minHistoryMs: 86_400_000 },
  });
  assert.equal(ready.status, "ready");
});

test("the audit sink records only project-scoped, redacted observations", () => {
  const data = system();
  const audit = new AuditLog(new OperationalAuditSink(data));
  audit.record("task_completed", {
    projectId: "aims",
    taskId: "task-1",
    data: {},
  });
  audit.record("model_execution_started", { data: {} });

  const records = data.eventsForProject("aims");
  assert.equal(records.length, 1);
  assert.equal(records[0]?.kind, "audit_observation");
  assert.equal(records[0]?.dimensions.auditType, "task_completed");
  assert.equal(
    Object.keys(records[0]?.dimensions ?? {}).includes("token"),
    false,
  );
});
