/**
 * `CachedRepository` — the async→sync persistence bridge (ADR-0011).
 * Exercised against a fake `AsyncRepository`; no Firebase.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { CachedRepository } from "../core/index.js";
import type { AsyncRepository, Entity } from "../contracts/index.js";

interface Row extends Entity {
  id: string;
  value: number;
}

class FakeAsyncRepo<T extends Entity> implements AsyncRepository<T> {
  readonly writes: string[] = [];
  failNext = false;
  private readonly map = new Map<string, T>();

  constructor(seed: readonly T[] = []) {
    for (const row of seed) this.map.set(row.id, structuredClone(row));
  }
  async upsert(entity: T): Promise<void> {
    this.maybeFail();
    this.writes.push(`upsert:${entity.id}`);
    this.map.set(entity.id, structuredClone(entity));
  }
  async findById(id: string): Promise<T | undefined> {
    const v = this.map.get(id);
    return v ? structuredClone(v) : undefined;
  }
  async list(): Promise<T[]> {
    return [...this.map.values()].map((v) => structuredClone(v));
  }
  async delete(id: string): Promise<boolean> {
    this.maybeFail();
    this.writes.push(`delete:${id}`);
    return this.map.delete(id);
  }
  async clear(): Promise<void> {
    this.maybeFail();
    this.writes.push("clear");
    this.map.clear();
  }
  private maybeFail() {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("backing store unavailable");
    }
  }
}

test("cached-repo: throws if read before hydrate()", () => {
  const repo = new CachedRepository<Row>(new FakeAsyncRepo<Row>());
  assert.throws(() => repo.list(), /before hydrate/);
  assert.throws(() => repo.findById("x"), /before hydrate/);
});

test("cached-repo: hydrate loads the backing collection; reads are local", async () => {
  const backing = new FakeAsyncRepo<Row>([
    { id: "a", value: 1 },
    { id: "b", value: 2 },
  ]);
  const repo = await new CachedRepository<Row>(backing).hydrate();
  assert.equal(repo.list().length, 2);
  assert.equal(repo.findById("a")?.value, 1);
  // reads did not touch the backing store
  assert.deepEqual(backing.writes, []);
});

test("cached-repo: writes are visible immediately and flushed in order", async () => {
  const backing = new FakeAsyncRepo<Row>();
  const repo = await new CachedRepository<Row>(backing).hydrate();

  repo.upsert({ id: "a", value: 1 });
  repo.upsert({ id: "a", value: 9 });
  repo.delete("a");

  // in-memory reflects the final state at once
  assert.equal(repo.findById("a"), undefined);
  assert.ok(repo.pendingWrites > 0);

  await repo.flush();
  assert.equal(repo.pendingWrites, 0);
  assert.deepEqual(backing.writes, ["upsert:a", "upsert:a", "delete:a"]);
});

test("cached-repo: a mutation is a defensive copy", async () => {
  const backing = new FakeAsyncRepo<Row>();
  const repo = await new CachedRepository<Row>(backing).hydrate();
  const row: Row = { id: "a", value: 1 };
  repo.upsert(row);
  row.value = 999;
  await repo.flush();
  assert.equal(repo.findById("a")?.value, 1);
});

test("cached-repo: a backing-store write failure is reported, never thrown", async () => {
  const errors: Array<[string, unknown]> = [];
  const backing = new FakeAsyncRepo<Row>();
  const repo = await new CachedRepository<Row>(backing, {
    onError: (op, err) => errors.push([op, err]),
  }).hydrate();

  backing.failNext = true;
  assert.doesNotThrow(() => repo.upsert({ id: "a", value: 1 }));
  await repo.flush();

  assert.equal(errors.length, 1);
  assert.equal(errors[0]![0], "upsert");
  // the local cache still has the write
  assert.equal(repo.findById("a")?.value, 1);
  // and the queue recovered for the next write
  repo.upsert({ id: "b", value: 2 });
  await repo.flush();
  assert.deepEqual(backing.writes, ["upsert:b"]);
});

test("cached-repo: delete reports prior existence from the cache", async () => {
  const backing = new FakeAsyncRepo<Row>([{ id: "a", value: 1 }]);
  const repo = await new CachedRepository<Row>(backing).hydrate();
  assert.equal(repo.delete("a"), true);
  assert.equal(repo.delete("a"), false);
  await repo.flush();
});

test("cached-repo: clear empties cache and backing", async () => {
  const backing = new FakeAsyncRepo<Row>([{ id: "a", value: 1 }]);
  const repo = await new CachedRepository<Row>(backing).hydrate();
  repo.clear();
  assert.deepEqual(repo.list(), []);
  await repo.flush();
  assert.equal((await backing.list()).length, 0);
});
