import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InMemoryRepository, type Task } from "../core/index.js";
import { JsonFilePersistence, JsonFileRepository } from "../adapters/index.js";

interface Row {
  id: string;
  value: number;
}

const scratch = () => mkdtempSync(join(tmpdir(), "workforce-persist-"));

/* ------------------------------------------------------------------ */
/* InMemoryRepository                                                 */
/* ------------------------------------------------------------------ */

test("in-memory repo: save, load, update, delete", () => {
  const repo = new InMemoryRepository<Row>();
  repo.upsert({ id: "a", value: 1 });
  assert.deepEqual(repo.findById("a"), { id: "a", value: 1 });

  repo.upsert({ id: "a", value: 2 });
  assert.equal(repo.findById("a")?.value, 2);
  assert.equal(repo.list().length, 1);

  assert.equal(repo.delete("a"), true);
  assert.equal(repo.delete("a"), false);
  assert.equal(repo.findById("a"), undefined);
});

test("in-memory repo: missing record returns undefined, not a throw", () => {
  const repo = new InMemoryRepository<Row>();
  assert.equal(repo.findById("nope"), undefined);
  assert.deepEqual(repo.list(), []);
});

test("in-memory repo: reads and writes are copies, not references", () => {
  const repo = new InMemoryRepository<Row>();
  const input = { id: "a", value: 1 };
  repo.upsert(input);
  input.value = 99; // mutate the caller's object after writing
  assert.equal(repo.findById("a")?.value, 1);

  const readBack = repo.findById("a")!;
  readBack.value = 42; // mutate a read result
  assert.equal(repo.findById("a")?.value, 1);
});

/* ------------------------------------------------------------------ */
/* JsonFileRepository                                                 */
/* ------------------------------------------------------------------ */

test("json file repo: state survives a fresh instance on the same file", () => {
  const dir = scratch();
  try {
    const file = join(dir, "rows.json");
    const first = new JsonFileRepository<Row>(file);
    first.upsert({ id: "a", value: 1 });
    first.upsert({ id: "b", value: 2 });

    // simulate a process restart: brand new object, same file
    const reloaded = new JsonFileRepository<Row>(file);
    assert.equal(reloaded.list().length, 2);
    assert.equal(reloaded.findById("b")?.value, 2);

    reloaded.upsert({ id: "b", value: 20 });
    reloaded.delete("a");

    const third = new JsonFileRepository<Row>(file);
    assert.equal(third.findById("a"), undefined);
    assert.equal(third.findById("b")?.value, 20);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("json file repo: absent file loads as empty", () => {
  const dir = scratch();
  try {
    const repo = new JsonFileRepository<Row>(join(dir, "nested", "rows.json"));
    assert.deepEqual(repo.list(), []);
    assert.equal(repo.findById("x"), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("json file repo: two files are isolated from each other", () => {
  const dir = scratch();
  try {
    const left = new JsonFileRepository<Row>(join(dir, "left.json"));
    const right = new JsonFileRepository<Row>(join(dir, "right.json"));
    left.upsert({ id: "a", value: 1 });
    assert.deepEqual(right.list(), []);
    assert.equal(right.findById("a"), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("json file repo: a corrupt file fails loudly instead of dropping data", () => {
  const dir = scratch();
  try {
    const file = join(dir, "rows.json");
    writeFileSync(file, "{ not json", "utf8");
    assert.throws(() => new JsonFileRepository<Row>(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* JsonFilePersistence                                                */
/* ------------------------------------------------------------------ */

test("json persistence: creates one file per collection and isolates them", () => {
  const dir = scratch();
  try {
    const persistence = new JsonFilePersistence(dir);
    const task: Task = {
      id: "task_1",
      type: "implementation",
      description: "Build",
      projectId: "money-mind",
      priority: "normal",
      status: "created",
      input: null,
      errors: [],
      requiredPermissions: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      metadata: {},
    };
    persistence.tasks.upsert(task);

    assert.ok(existsSync(join(dir, "tasks.json")));
    assert.equal(persistence.agents.list().length, 0);

    const reopened = new JsonFilePersistence(dir);
    assert.equal(reopened.tasks.findById("task_1")?.description, "Build");
    assert.equal(reopened.approvals.list().length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
