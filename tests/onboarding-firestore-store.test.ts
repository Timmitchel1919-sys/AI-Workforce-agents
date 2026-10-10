/**
 * Store contract: the same claim / revision semantics must hold for the
 * in-memory stores and the Firestore stores (driven through a fake
 * transactional Firestore that serialises transactions like the real one).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryOnboardingSessionStore,
  InMemoryProvisionedProjectStore,
  type OnboardingSessionStore,
  type ProvisionedProject,
  type ProvisionedProjectStore,
  type OnboardingSession,
} from "../core/index.js";
import {
  FirestoreOnboardingSessionStore,
  FirestoreProvisionedProjectStore,
  type TransactionalFirestoreLike,
} from "../adapters/firebase/index.js";

function fakeFirestore(): TransactionalFirestoreLike {
  const data = new Map<string, Record<string, unknown>>();
  let queue: Promise<unknown> = Promise.resolve();
  const ref = (path: string) => ({
    id: path.split("/").pop()!,
    path,
    async get() {
      const value = data.get(path);
      return {
        exists: value !== undefined,
        data: () => (value ? structuredClone(value) : undefined),
      };
    },
  });
  const collection = (name: string) => ({
    doc: (id: string) => ref(`${name}/${id}`),
    async get() {
      const docs = [...data.entries()]
        .filter(([key]) => key.startsWith(`${name}/`))
        .map(([, value]) => ({ data: () => structuredClone(value) }));
      return { docs };
    },
    async listDocuments() {
      return [];
    },
    where: () => ({ get: async () => ({ docs: [] }) }),
  });
  return {
    collection,
    runTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      const run = async () => {
        const writes: Array<() => void> = [];
        const tx = {
          get: (r: { get(): Promise<unknown> }) => r.get(),
          create: (r: { path: string }, value: Record<string, unknown>) => {
            writes.push(() => {
              if (data.has(r.path)) throw new Error("already exists");
              data.set(r.path, structuredClone(value));
            });
          },
          set: (r: { path: string }, value: Record<string, unknown>) => {
            writes.push(() => void data.set(r.path, structuredClone(value)));
          },
        };
        const result = await fn(tx as never);
        writes.forEach((w) => w());
        return result;
      };
      const next = queue.then(run, run);
      queue = next.catch(() => undefined);
      return next as Promise<T>;
    },
  } as unknown as TransactionalFirestoreLike;
}

const project = (
  id: string,
  code: string,
  repositoryKey?: string,
  onboardingId = id,
): ProvisionedProject =>
  ({
    id,
    code,
    displayName: id,
    onboardingId,
    createdBy: "a",
    createdAt: "t",
    readiness: "blocked",
    ...(repositoryKey ? { repositoryKey } : {}),
    plan: {} as never,
    baseline: {} as never,
    blocking: [],
    revision: 1,
  }) as ProvisionedProject;

const session = (id: string, revision = 1): OnboardingSession =>
  ({ id, revision }) as OnboardingSession;

const projectStores: Array<[string, () => ProvisionedProjectStore]> = [
  ["memory", () => new InMemoryProvisionedProjectStore()],
  ["firestore", () => new FirestoreProvisionedProjectStore(fakeFirestore())],
];
for (const [name, make] of projectStores) {
  test(`project store (${name}): claims, idempotency, concurrent duplicates`, async () => {
    const store = make();
    assert.deepEqual(
      await store.create(project("p1", "AA", "github.com/a/b")),
      { result: "created" },
    );
    assert.deepEqual(
      await store.create(project("p1", "AA", "github.com/a/b")),
      { result: "exists", sameOnboarding: true },
    );
    assert.deepEqual(
      await store.create(project("p1", "ZZ", undefined, "other")),
      { result: "exists", sameOnboarding: false },
    );
    assert.deepEqual(await store.create(project("p2", "AA")), {
      result: "conflict",
      reason: "code",
    });
    assert.deepEqual(
      await store.create(project("p3", "BB", "github.com/a/b")),
      { result: "conflict", reason: "repository" },
    );
    const [x, y] = await Promise.all([
      store.create(project("p4", "CC", "github.com/c/d")),
      store.create(project("p5", "DD", "github.com/c/d")),
    ]);
    assert.deepEqual([x.result, y.result].sort(), ["conflict", "created"]);
    assert.equal((await store.list()).length, 2);
    const p = (await store.get("p1"))!;
    assert.equal(await store.replace({ ...p, revision: 2 }, 5), false);
    assert.equal(await store.replace({ ...p, revision: 2 }, 1), true);
  });
}

const sessionStores: Array<[string, () => OnboardingSessionStore]> = [
  ["memory", () => new InMemoryOnboardingSessionStore()],
  ["firestore", () => new FirestoreOnboardingSessionStore(fakeFirestore())],
];
for (const [name, make] of sessionStores) {
  test(`session store (${name}): create-only and revision CAS`, async () => {
    const store = make();
    assert.equal(await store.create(session("s1")), true);
    assert.equal(await store.create(session("s1")), false);
    const results = await Promise.all([
      store.replace(session("s1", 2), 1),
      store.replace(session("s1", 2), 1),
    ]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal((await store.get("s1"))!.revision, 2);
  });
}
