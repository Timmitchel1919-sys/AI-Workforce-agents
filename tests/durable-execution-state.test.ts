/**
 * EO-4.8 — durable execution state.
 *
 * Firestore is exercised through the in-memory FakeFirestore test double
 * (transactions, create-only writes, equality queries). Two store instances
 * over the SAME fake model two Control Plane instances / a restart.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import test from "node:test";

import {
  FirestoreExecutionRecordStore,
  FirestoreExecutionSessionStore,
} from "../adapters/index.js";
import {
  RecordExistsError,
  StateTransitionError,
  NotFoundError,
  type ExecutionReceipt,
  type ExecutionSession,
  type VerificationResult,
} from "../contracts/index.js";
import {
  AgentOperationalStore,
  getExecutionSessionDetail,
  type ControlPlaneContext,
} from "../control/index.js";
import {
  DurableLedger,
  ExecutionManager,
  InMemoryExecutionRecordStore,
  VerificationService,
  ArtifactManager,
} from "../core/index.js";
import { holdResponseUntilFlushed } from "../functions/control-plane-function.js";
import {
  ADMIN,
  BETA_OPERATOR,
  FAKE_SECRET,
  OPERATOR,
  harness,
} from "./fixtures/execution.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

function session(overrides: Partial<ExecutionSession> = {}): ExecutionSession {
  return {
    sessionId: "exs_1",
    projectId: "alpha",
    plan: { planId: "plan-1", version: 1, executionPlanId: "plan-1@v1" },
    stageId: "build:web",
    stageKind: "build",
    operationId: "web.build",
    toolId: "wf.web-build",
    agentId: "web-agent",
    environmentInstanceId: "web-1",
    policy: { policyId: "p", version: 1 },
    approvalIds: [],
    risk: "low",
    workspace: {
      workspaceId: "ews_1",
      sessionId: "exs_1",
      projectId: "alpha",
      rootRef: "workspace://alpha/ews_1",
      mode: "read_only",
      status: "requested",
    },
    grants: [],
    limits: {
      sessionTimeoutMs: 1,
      operationTimeoutMs: 1,
      maxOutputBytes: 1,
      maxArtifactBytes: 1,
      maxToolCalls: 1,
    },
    limitEnforcement: {} as ExecutionSession["limitEnforcement"],
    network: { mode: "deny_all" },
    status: "ready",
    reasons: [],
    requestedBy: "op-1",
    idempotencyKey: "key-1",
    attempts: [],
    createdAt: "2026-09-24T12:00:00.000Z",
    revision: 1,
    ...overrides,
  };
}

test("EO-4.8 1 SESSIONS: Firestore store is transactional, idempotent and shared across instances", async () => {
  const fs = new FakeFirestore();
  const a = new FirestoreExecutionSessionStore(fs);
  const b = new FirestoreExecutionSessionStore(fs); // a second Control Plane instance
  assert.equal(await a.commit(session()), "committed");
  assert.equal(
    await b.commit(session()),
    "conflict",
    "same session id cannot be inserted twice",
  );
  assert.equal(
    await b.commit(session({ sessionId: "exs_2" })),
    "conflict",
    "idempotency key is unique per operator",
  );
  assert.equal(
    await b.commit(session({ sessionId: "exs_3", requestedBy: "op-2" })),
    "committed",
    "keys are per operator",
  );
  assert.equal((await b.get("exs_1"))!.status, "ready");
  assert.equal(
    (await b.findByIdempotencyKey("op-1", "key-1"))!.sessionId,
    "exs_1",
  );
  // Compare-and-swap: stale revisions never win.
  assert.equal(
    await b.commit(session({ status: "running", revision: 2 }), 1),
    "committed",
  );
  assert.equal(
    await a.commit(session({ status: "cancelled", revision: 2 }), 1),
    "conflict",
  );
  assert.equal((await a.get("exs_1"))!.status, "running");
  assert.deepEqual(
    (await a.listByProject("alpha")).map((s) => s.sessionId).sort(),
    ["exs_1", "exs_3"],
  );
  assert.deepEqual(await a.listByProject("beta"), []);
});

test("EO-4.8 2 SESSIONS: concurrent transitions from two instances — exactly one wins", async () => {
  const fs = new FakeFirestore();
  const a = new FirestoreExecutionSessionStore(fs);
  const b = new FirestoreExecutionSessionStore(fs);
  await a.commit(session());
  const results = await Promise.all([
    a.commit(session({ status: "running", revision: 2 }), 1),
    b.commit(session({ status: "cancelled", revision: 2 }), 1),
  ]);
  assert.deepEqual([...results].sort(), ["committed", "conflict"]);
});

test("EO-4.8 3 RECORDS: create-only evidence, advancing records, bounded newest-first lookups", async () => {
  const fs = new FakeFirestore();
  const store = new FirestoreExecutionRecordStore(fs);
  await store.create(
    "receipt:rcp/1",
    {
      projectId: "alpha",
      kind: "receipt",
      sessionId: "exs_1",
      createdAt: "2026-09-24T12:00:01.000Z",
    },
    { receiptId: "rcp/1", nested: [[1, 2]], optional: undefined },
  );
  await assert.rejects(
    store.create(
      "receipt:rcp/1",
      { projectId: "alpha", kind: "receipt", createdAt: "x" },
      {},
    ),
    RecordExistsError,
  );
  await store.create(
    "receipt:rcp_2",
    {
      projectId: "alpha",
      kind: "receipt",
      sessionId: "exs_1",
      createdAt: "2026-09-24T12:00:02.000Z",
    },
    { receiptId: "rcp_2" },
  );
  await store.put(
    "release:rel_1",
    {
      projectId: "alpha",
      kind: "release",
      createdAt: "2026-09-24T12:00:00.000Z",
    },
    { status: "deploying" },
  );
  await store.put(
    "release:rel_1",
    {
      projectId: "alpha",
      kind: "release",
      createdAt: "2026-09-24T12:00:00.000Z",
    },
    { status: "healthy" },
  );
  assert.deepEqual(await store.get("release:rel_1"), { status: "healthy" });
  const receipts = await store.listBy<{
    receiptId: string;
    nested?: number[][];
  }>("sessionId", "exs_1", { kind: "receipt", limit: 10 });
  assert.deepEqual(
    receipts.map((r) => r.receiptId),
    ["rcp_2", "rcp/1"],
    "newest first",
  );
  assert.deepEqual(
    receipts[1]!.nested,
    [[1, 2]],
    "nested arrays survive (JSON payload)",
  );
  assert.equal(
    (await store.listBy("sessionId", "exs_1", { kind: "receipt", limit: 1 }))
      .length,
    1,
    "bounded",
  );
  assert.equal(
    (await store.listBy("projectId", "alpha", { kind: "release", limit: 10 }))
      .length,
    1,
  );
  assert.deepEqual(
    await store.listBy("projectId", "beta", { limit: 10 }),
    [],
    "project scoped",
  );
  // Documents are index fields + a JSON payload; ids are hashed (no "/" paths).
  const docs = [...fs.collection("execution_records").values.entries()];
  assert.ok(docs.every(([id]) => /^[0-9a-f]{64}$/.test(id)));
  assert.ok(
    docs.every(
      ([, d]) => typeof d.json === "string" && typeof d.projectId === "string",
    ),
  );
});

test("EO-4.8 4 RESTART: sessions and receipts survive a new Control Plane instance; idempotent replay; CAS cancel", async () => {
  const fs = new FakeFirestore();
  const h = await harness({
    sessions: new FirestoreExecutionSessionStore(fs),
    receiptStore: new FirestoreExecutionRecordStore(fs),
  });
  const { session: created } = await h.manager.createSession(
    OPERATOR,
    h.request(),
    "restart-key",
  );
  // No tool engine in this harness: the invocation is DENIED but still leaves durable evidence.
  const denied = await h.manager.invoke(OPERATOR, {
    sessionId: created.sessionId,
    invocationId: "inv-1",
    toolId: "wf.web-build",
    operationId: "web.build",
    input: { profile: "production", outDir: "dist" },
  });
  assert.equal(denied.exitClass, "denied");

  // "Restart": a brand-new manager + stores over the same Firestore.
  const records = new FirestoreExecutionRecordStore(fs);
  const restarted = new ExecutionManager({
    ...h.managerOptions,
    sessions: new FirestoreExecutionSessionStore(fs),
    receiptStore: records,
    idFactory: (p) => `${p}_r${Math.random().toString(36).slice(2, 8)}`,
  });
  assert.equal(
    (await restarted.getSession(OPERATOR, created.sessionId)).sessionId,
    created.sessionId,
  );
  const replay = await restarted.createSession(
    OPERATOR,
    h.request(),
    "restart-key",
  );
  assert.equal(
    replay.replayed,
    true,
    "idempotency survives the restart — no duplicate session",
  );
  assert.equal(replay.session.sessionId, created.sessionId);
  const receipts = await records.listBy<ExecutionReceipt>(
    "sessionId",
    created.sessionId,
    { kind: "receipt", limit: 10 },
  );
  assert.deepEqual(
    receipts.map((r) => r.receiptId),
    [denied.receiptId],
  );
  const cancelled = await restarted.cancel(
    OPERATOR,
    created.sessionId,
    "operator stop",
    "cancel",
  );
  assert.equal(cancelled.session.status, "cancelled");
  assert.equal(
    (await new FirestoreExecutionSessionStore(fs).get(created.sessionId))!
      .status,
    "cancelled",
  );

  // The Control Center reads the durable receipts after the restart.
  const ctx = {
    execution: restarted,
    executionRecords: records,
    audit: h.fixture.audit,
    agents: h.fixture.agents,
    agentOps: new AgentOperationalStore(),
    environments: h.fixture.registry,
  } as unknown as ControlPlaneContext;
  const detail = await getExecutionSessionDetail(
    ctx,
    OPERATOR,
    "alpha",
    created.sessionId,
  );
  assert.deepEqual(
    detail!.receipts.map((r) => r.receiptId),
    [denied.receiptId],
  );
  await assert.rejects(
    getExecutionSessionDetail(ctx, BETA_OPERATOR, "alpha", created.sessionId),
    NotFoundError,
  );
  assert.ok(
    !JSON.stringify([
      ...fs.collection("execution_records").values.values(),
    ]).includes(FAKE_SECRET),
  );
});

test("EO-4.8 5 LEDGER: create-only idempotency reservations hold across instances; failures are retryable", async () => {
  const store = new InMemoryExecutionRecordStore();
  let now = Date.parse("2026-09-24T12:00:00.000Z");
  const clock = () => new Date(now).toISOString();
  const a = new DurableLedger(store, clock);
  const b = new DurableLedger(store, clock); // another instance
  assert.equal(
    await a.claim("push", "op-1", "k1", "alpha"),
    undefined,
    "a owns the reservation",
  );
  await assert.rejects(
    b.claim("push", "op-1", "k1", "alpha"),
    StateTransitionError,
    "b cannot run the same push",
  );
  await a.settle("push", "op-1", "k1", "alpha", "psr_1");
  assert.equal(
    await b.claim("push", "op-1", "k1", "alpha"),
    "psr_1",
    "finished request replays everywhere",
  );
  assert.equal(await a.claim("push", "op-1", "k2", "alpha"), undefined);
  await a.settle("push", "op-1", "k2", "alpha");
  assert.equal(
    await b.claim("push", "op-1", "k2", "alpha"),
    undefined,
    "a failed request can be retried",
  );
  assert.equal(await a.claim("deploy", "op-1", "k3", "alpha"), undefined);
  now += 11 * 60_000;
  assert.equal(
    await b.claim("deploy", "op-1", "k3", "alpha"),
    undefined,
    "an abandoned reservation is reclaimable",
  );
  await a.reserveUnique(
    "commit_of_stage_set",
    "stg_1",
    "alpha",
    "already committed",
  );
  await assert.rejects(
    b.reserveUnique(
      "commit_of_stage_set",
      "stg_1",
      "alpha",
      "already committed",
    ),
    StateTransitionError,
  );
  await a.save("commit", "cmr_1", "alpha", clock(), {
    receiptId: "cmr_1",
    projectId: "alpha",
    createdAt: clock(),
  });
  assert.deepEqual(await b.find("commit", "cmr_1"), {
    receiptId: "cmr_1",
    projectId: "alpha",
    createdAt: clock(),
  });
  assert.equal(
    (
      await b.list<{ receiptId: string; projectId: string; createdAt: string }>(
        "commit",
        "alpha",
        10,
        (r) => r.receiptId,
      )
    ).length,
    1,
  );
});

test("EO-4.8 6 VERIFICATION HISTORY: durable results are listed and loadable after a restart; project-scoped", async () => {
  const store = new InMemoryExecutionRecordStore();
  const result = {
    verificationId: "vrf_old",
    projectId: "alpha",
    plan: { planId: "plan-1", version: 1, executionPlanId: "plan-1@v1" },
    sourceFingerprint: "f".repeat(64),
    toolchains: [],
    isolation: "none_ran",
    stages: [],
    artifactIds: [],
    status: "passed",
    reasons: [],
    unverifiedStageIds: [],
    requestedBy: "op-1",
    createdAt: "2026-09-24T11:00:00.000Z",
    completedAt: "2026-09-24T11:05:00.000Z",
  } as unknown as VerificationResult;
  await store.create(
    "vrf_old",
    { projectId: "alpha", kind: "verification", createdAt: result.createdAt },
    result,
  );
  const h = await harness();
  const service = new VerificationService({
    manager: h.manager,
    planning: h.fixture.planning,
    operations: { get: () => undefined },
    environments: h.fixture.registry,
    sandboxes: { get: () => undefined },
    projects: { has: (id) => id === "alpha" || id === "beta" },
    audit: h.fixture.audit,
    artifacts: new ArtifactManager({
      source: { digestFile: async () => ({ sha256: "x", size: 1 }) },
      maxArtifactBytes: 10,
    }),
    store,
  });
  assert.deepEqual(
    (await service.listHistory(OPERATOR, "alpha")).map((v) => v.verificationId),
    ["vrf_old"],
  );
  assert.equal((await service.load(ADMIN, "vrf_old")).status, "passed");
  assert.ok(
    Object.isFrozen(await service.load(ADMIN, "vrf_old")),
    "durable evidence is immutable",
  );
  await assert.rejects(service.load(BETA_OPERATOR, "vrf_old"), NotFoundError);
  await assert.rejects(service.load(OPERATOR, "vrf_missing"), NotFoundError);
});

class FakeResponse extends EventEmitter {
  ended: unknown[] | undefined;
  headersSent = false;
  writableEnded = false;
  end(...args: unknown[]) {
    this.ended = args;
    this.writableEnded = true;
    return this;
  }
}

test("EO-4.8 7 FUNCTIONS: a response is released only after pending writes are flushed (bounded)", async () => {
  const res = new FakeResponse();
  let resolveFlush!: () => void;
  holdResponseUntilFlushed(
    res as unknown as ServerResponse,
    () => new Promise<void>((r) => (resolveFlush = r)),
    1_000,
  );
  (res as unknown as ServerResponse).end("body");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(res.ended, undefined, "held while writes are pending");
  resolveFlush();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(res.ended, ["body"]);

  const slow = new FakeResponse();
  holdResponseUntilFlushed(
    slow as unknown as ServerResponse,
    () => new Promise<void>(() => {}),
    30,
  );
  (slow as unknown as ServerResponse).end("late");
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(
    slow.ended,
    ["late"],
    "a stuck flush never blocks the response forever",
  );

  const failing = new FakeResponse();
  holdResponseUntilFlushed(
    failing as unknown as ServerResponse,
    () => Promise.reject(new Error("firestore down")),
    1_000,
  );
  (failing as unknown as ServerResponse).end("x");
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(failing.ended, ["x"]);
});
