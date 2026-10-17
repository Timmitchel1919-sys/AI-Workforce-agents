import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FirestoreWriteScopeLeaseRepository } from "../adapters/index.js";
import type { WriteScopeLease } from "../contracts/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

function lease(overrides: Partial<WriteScopeLease> = {}): WriteScopeLease {
  return {
    leaseId: "l-1",
    projectId: "p-1",
    taskId: "t-1",
    agentId: "agent-1",
    workspaceId: "ws-1",
    scope: ["src/feature"],
    status: "active",
    acquiredAt: "2026-10-17T12:00:00.000Z",
    expiresAt: "2026-10-17T13:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

test("FirestoreWriteScopeLeaseRepository persists leases and rehydrates on reconstruction", async () => {
  const firestore = new FakeFirestore();
  const repo1 = new FirestoreWriteScopeLeaseRepository(firestore);
  await repo1.ready;

  repo1.upsert(lease({ leaseId: "l-1" }));
  repo1.upsert(lease({ leaseId: "l-2", scope: ["src/other"] }));
  await repo1.flush();

  const repo2 = new FirestoreWriteScopeLeaseRepository(firestore);
  await repo2.ready;

  assert.equal(repo2.list().length, 2);
  assert.deepEqual(repo2.findById("l-2")?.scope, ["src/other"]);
});

test("FirestoreWriteScopeLeaseRepository upsert updates status + version transitions", async () => {
  const firestore = new FakeFirestore();
  const repo = new FirestoreWriteScopeLeaseRepository(firestore);
  await repo.ready;

  repo.upsert(lease({ leaseId: "l-1", status: "active", version: 1 }));
  repo.upsert(lease({ leaseId: "l-1", status: "released", version: 2 }));
  await repo.flush();

  assert.equal(repo.findById("l-1")?.status, "released");
  assert.equal(repo.findById("l-1")?.version, 2);

  const repo2 = new FirestoreWriteScopeLeaseRepository(firestore);
  await repo2.ready;
  assert.equal(repo2.findById("l-1")?.status, "released");
});

test("FirestoreWriteScopeLeaseRepository surfaces background write failures through onError", async () => {
  const firestore = new FakeFirestore();
  const errors: Array<{ leaseId: string }> = [];
  const repo = new FirestoreWriteScopeLeaseRepository(firestore, {
    onError: (_error, context) => errors.push(context),
  });
  await repo.ready;

  const col = firestore.collection("write_scope_leases");
  const originalDoc = col.doc.bind(col);
  col.doc = (id: string) => {
    const ref = originalDoc(id);
    ref.set = async () => {
      throw new Error("firestore down");
    };
    return ref;
  };

  repo.upsert(lease({ leaseId: "l-fail" }));
  await repo.flush();

  assert.equal(errors.length, 1);
  assert.equal(errors[0].leaseId, "l-fail");
});
