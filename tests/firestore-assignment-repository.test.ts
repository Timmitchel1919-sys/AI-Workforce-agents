import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FirestoreAssignmentRepository } from "../adapters/index.js";
import type { Assignment } from "../contracts/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    assignmentId: "a-1",
    projectId: "p-1",
    taskId: "t-1",
    agentId: "agent-1",
    descriptorVersion: 1,
    qualification: {
      qualified: true,
      descriptorVersion: 1,
      matchedCapabilities: [],
      missingCapabilities: [],
      reasonCodes: [],
      consideredLimitations: [],
      evaluatedAt: "2026-10-17T12:00:00.000Z",
    },
    status: "assigned",
    assignedAt: "2026-10-17T12:00:00.000Z",
    assignedBy: "operator-1",
    updatedAt: "2026-10-17T12:00:00.000Z",
    ...overrides,
  } as Assignment;
}

test("FirestoreAssignmentRepository persists assignments and rehydrates on reconstruction", async () => {
  const firestore = new FakeFirestore();
  const repo1 = new FirestoreAssignmentRepository(firestore);
  await repo1.ready;

  repo1.upsert(assignment({ assignmentId: "a-1" }));
  repo1.upsert(assignment({ assignmentId: "a-2", taskId: "t-2" }));
  await repo1.flush();

  // Simulate function cold start: a new repository instance against the same backing store.
  const repo2 = new FirestoreAssignmentRepository(firestore);
  await repo2.ready;

  assert.equal(repo2.list().length, 2);
  assert.equal(repo2.findById("a-1")?.taskId, "t-1");
  assert.equal(repo2.findById("a-2")?.taskId, "t-2");
});

test("FirestoreAssignmentRepository upsert overwrites in both cache and durable store", async () => {
  const firestore = new FakeFirestore();
  const repo = new FirestoreAssignmentRepository(firestore);
  await repo.ready;

  repo.upsert(assignment({ assignmentId: "a-1", status: "assigned" }));
  repo.upsert(assignment({ assignmentId: "a-1", status: "reassigned" }));
  await repo.flush();

  assert.equal(repo.findById("a-1")?.status, "reassigned");

  const repo2 = new FirestoreAssignmentRepository(firestore);
  await repo2.ready;
  assert.equal(repo2.findById("a-1")?.status, "reassigned");
});

test("FirestoreAssignmentRepository currentForTask returns the most recent non-reassigned assignment", async () => {
  const firestore = new FakeFirestore();
  const repo = new FirestoreAssignmentRepository(firestore);
  await repo.ready;

  repo.upsert(
    assignment({
      assignmentId: "a-1",
      taskId: "t-1",
      status: "reassigned",
      assignedAt: "2026-10-17T12:00:00.000Z",
    }),
  );
  repo.upsert(
    assignment({
      assignmentId: "a-2",
      taskId: "t-1",
      status: "assigned",
      assignedAt: "2026-10-17T13:00:00.000Z",
    }),
  );

  const current = repo.currentForTask("t-1");
  assert.equal(current?.assignmentId, "a-2");
  assert.equal(repo.historyForTask("t-1").length, 2);
});

test("FirestoreAssignmentRepository surfaces background write failures through onError", async () => {
  const firestore = new FakeFirestore();
  const errors: Array<{ error: unknown; assignmentId: string }> = [];
  const repo = new FirestoreAssignmentRepository(firestore, {
    onError: (error, context) => errors.push({ error, ...context }),
  });
  await repo.ready;

  // Monkey-patch the underlying collection so the next set() rejects.
  const col = firestore.collection("assignments");
  const originalDoc = col.doc.bind(col);
  col.doc = (id: string) => {
    const ref = originalDoc(id);
    ref.set = async () => {
      throw new Error("firestore down");
    };
    return ref;
  };

  repo.upsert(assignment({ assignmentId: "a-fail" }));
  await repo.flush();

  assert.equal(errors.length, 1);
  assert.equal(errors[0].assignmentId, "a-fail");
});
