import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FirestoreExecutionReceiptStore } from "../adapters/index.js";
import { ValidationError, type ExecutionReceipt } from "../contracts/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

function receipt(overrides: Partial<ExecutionReceipt> = {}): ExecutionReceipt {
  return {
    receiptId: "r-1",
    sessionId: "s-1",
    attemptId: "att-1",
    projectId: "p-1",
    plan: { planId: "plan-1", revision: 1 },
    stageId: "stage-1",
    agentId: "agent-1",
    environmentInstanceId: "env-1",
    toolId: "tool-1",
    operationId: "op-1",
    policy: { policyId: "policy-1", version: 1 },
    approvalIds: [],
    startedAt: "2026-10-17T12:00:00.000Z",
    endedAt: "2026-10-17T12:00:01.000Z",
    outcome: "succeeded",
    exitClass: "ok",
    artifacts: [],
    logRefs: [],
    resources: { wallClockMs: 1000, outputBytes: 0, outputTruncated: false },
    redaction: { applied: true, redactedValues: 0 },
    simulated: false,
    ...overrides,
  } as unknown as ExecutionReceipt;
}

test("FirestoreExecutionReceiptStore persists receipts and rehydrates on reconstruction", async () => {
  const firestore = new FakeFirestore();
  const store1 = new FirestoreExecutionReceiptStore(firestore);
  await store1.ready;

  store1.record(receipt({ receiptId: "r-1", sessionId: "s-1" }));
  store1.record(receipt({ receiptId: "r-2", sessionId: "s-1" }));
  store1.record(receipt({ receiptId: "r-3", sessionId: "s-2" }));
  await store1.flush();

  const store2 = new FirestoreExecutionReceiptStore(firestore);
  await store2.ready;

  assert.equal(store2.get("r-1")?.sessionId, "s-1");
  assert.equal(store2.forSession("s-1").length, 2);
  assert.equal(store2.forSession("s-2").length, 1);
});

test("FirestoreExecutionReceiptStore rejects duplicate receiptId synchronously", async () => {
  const firestore = new FakeFirestore();
  const store = new FirestoreExecutionReceiptStore(firestore);
  await store.ready;

  store.record(receipt({ receiptId: "r-dup" }));
  await store.flush();

  assert.throws(
    () => store.record(receipt({ receiptId: "r-dup" })),
    (error: unknown) =>
      error instanceof ValidationError &&
      /already exists; receipts are immutable/.test(error.message),
  );
});

test("FirestoreExecutionReceiptStore rejects duplicate receiptId after rehydrate", async () => {
  const firestore = new FakeFirestore();
  const store1 = new FirestoreExecutionReceiptStore(firestore);
  await store1.ready;
  store1.record(receipt({ receiptId: "r-dup" }));
  await store1.flush();

  const store2 = new FirestoreExecutionReceiptStore(firestore);
  await store2.ready;
  assert.throws(
    () => store2.record(receipt({ receiptId: "r-dup" })),
    (error: unknown) => error instanceof ValidationError,
  );
});

test("FirestoreExecutionReceiptStore returns a deep-frozen receipt", async () => {
  const firestore = new FakeFirestore();
  const store = new FirestoreExecutionReceiptStore(firestore);
  await store.ready;

  const stored = store.record(receipt({ receiptId: "r-frozen" }));
  assert.equal(Object.isFrozen(stored), true);
});
