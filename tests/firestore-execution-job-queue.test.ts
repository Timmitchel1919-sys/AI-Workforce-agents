import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FirestoreExecutionJobQueue } from "../adapters/index.js";
import type { ExecutionJob } from "../contracts/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

function job(overrides: Partial<ExecutionJob> = {}): ExecutionJob {
  const t = "2026-10-17T12:00:00.000Z";
  return {
    jobId: "j-1",
    idempotencyKey: "idem-1",
    projectId: "p-1",
    taskId: "t-1",
    agentId: "a-1",
    executionId: "exec-1",
    tool: {
      toolId: "workspace.filesystem",
      action: "read",
      input: { action: "read", path: "a.txt" },
      requiredCapability: "workspace.read",
    },
    status: "queued",
    attempt: 0,
    maxAttempts: 3,
    createdAt: t,
    availableAt: t,
    updatedAt: t,
    ...overrides,
  };
}

test("enqueue persists a job and is idempotent on duplicate jobId", async () => {
  const firestore = new FakeFirestore();
  const queue = new FirestoreExecutionJobQueue(firestore);
  await queue.enqueue({ job: job({ jobId: "j-A" }) });
  // Second call with same jobId must not throw.
  await queue.enqueue({ job: job({ jobId: "j-A" }) });
  const stored = await queue.get("j-A");
  assert.equal(stored?.jobId, "j-A");
});

test("acquire atomically leases a queued job to one worker", async () => {
  const firestore = new FakeFirestore();
  const queue = new FirestoreExecutionJobQueue(firestore);
  await queue.enqueue({ job: job({ jobId: "j-C" }) });
  const first = await queue.acquire({
    workerId: "w-1",
    leaseTtlMs: 60_000,
  });
  assert.equal(first?.jobId, "j-C");
  assert.equal(first?.status, "leased");
  assert.equal(first?.lease?.workerId, "w-1");

  // A second worker trying to acquire finds nothing eligible.
  const second = await queue.acquire({ workerId: "w-2", leaseTtlMs: 60_000 });
  assert.equal(second, undefined);
});

test("acquire sweeps expired leases back to queued and re-leases", async () => {
  const firestore = new FakeFirestore();
  const queue = new FirestoreExecutionJobQueue(firestore);
  await queue.enqueue({ job: job({ jobId: "j-S" }) });
  const first = await queue.acquire({
    workerId: "crashed-worker",
    leaseTtlMs: 10,
    now: new Date("2026-10-17T12:00:00.000Z"),
  });
  assert.equal(first?.lease?.workerId, "crashed-worker");

  // Simulate time passing well beyond the lease TTL.
  const second = await queue.acquire({
    workerId: "fresh-worker",
    leaseTtlMs: 60_000,
    now: new Date("2026-10-17T12:05:00.000Z"),
  });
  assert.equal(second?.jobId, "j-S");
  assert.equal(second?.lease?.workerId, "fresh-worker");
  assert.equal(second?.attempt, 1);
});

test("complete transitions a leased job to succeeded only for the owner", async () => {
  const firestore = new FakeFirestore();
  const queue = new FirestoreExecutionJobQueue(firestore);
  await queue.enqueue({ job: job({ jobId: "j-O" }) });
  await queue.acquire({ workerId: "owner", leaseTtlMs: 60_000 });
  await assert.rejects(
    () =>
      queue.complete({
        jobId: "j-O",
        workerId: "someone-else",
        status: "succeeded",
      }),
  );
  await queue.complete({
    jobId: "j-O",
    workerId: "owner",
    status: "succeeded",
    executionReceiptId: "rcpt-1",
  });
  const stored = await queue.get("j-O");
  assert.equal(stored?.status, "succeeded");
  assert.equal(stored?.executionReceiptId, "rcpt-1");
});

test("requestCancellation flips the flag so the worker can stop early", async () => {
  const firestore = new FakeFirestore();
  const queue = new FirestoreExecutionJobQueue(firestore);
  await queue.enqueue({ job: job({ jobId: "j-X" }) });
  await queue.requestCancellation("j-X", "operator asked");
  const stored = await queue.get("j-X");
  assert.equal(stored?.cancellationRequested, true);
  assert.equal(stored?.cancellationReason, "operator asked");
});

test("findByIdempotencyKey returns the existing job if one exists", async () => {
  const firestore = new FakeFirestore();
  const queue = new FirestoreExecutionJobQueue(firestore);
  await queue.enqueue({ job: job({ jobId: "j-K", idempotencyKey: "key-42" }) });
  const found = await queue.findByIdempotencyKey("key-42");
  assert.equal(found?.jobId, "j-K");
  const missing = await queue.findByIdempotencyKey("key-does-not-exist");
  assert.equal(missing, undefined);
});
