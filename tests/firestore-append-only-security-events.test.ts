import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FirestoreAppendOnlySecurityEventStore } from "../adapters/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    eventId: "evt-1",
    schemaVersion: 1 as const,
    occurredAt: "2026-10-10T12:00:00.000Z",
    category: "authorization" as const,
    type: "permission_decision",
    severity: "info" as const,
    outcome: "allowed" as const,
    actor: { kind: "agent", id: "agent-1" },
    source: { kind: "workforce" },
    ...overrides,
  };
}

test("Firestore security event store appends through transaction create only", async () => {
  const firestore = new FakeFirestore();
  const store = new FirestoreAppendOnlySecurityEventStore(firestore);

  await store.append(event({ projectId: "project-a" }));
  assert.equal(firestore.transactions, 1);
  assert.equal("delete" in store, false);
  assert.equal("update" in store, false);
  assert.equal("set" in store, false);

  await assert.rejects(() => store.append(event({ projectId: "project-a" })));
});

test("Firestore security event store queries by project and returns newest first", async () => {
  const firestore = new FakeFirestore();
  const store = new FirestoreAppendOnlySecurityEventStore(firestore);

  await store.append(event({ projectId: "project-a" }));
  await store.append(
    event({
      id: "evt-2",
      eventId: "evt-2",
      projectId: "project-a",
      occurredAt: "2026-10-10T13:00:00.000Z",
    }),
  );
  await store.append(
    event({
      id: "evt-3",
      eventId: "evt-3",
      projectId: "project-b",
    }),
  );

  const events = await store.query({ projectId: "project-a" });
  assert.deepEqual(
    events.map((item) => item.eventId),
    ["evt-2", "evt-1"],
  );
});
