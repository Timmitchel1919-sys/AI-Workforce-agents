/**
 * `NodeMoneyMindRepo` — the real filesystem-backed `MoneyMindRepoPort`.
 *
 * Every test here uses a throwaway temp directory seeded with synthetic
 * content (never a real Money Mind checkout, never network access) — the
 * same offline discipline `tests/persistence.test.ts` uses for
 * `JsonFileRepository`. This is deliberately kept separate from
 * `tests/money-mind-adapter.test.ts` (which exercises the adapter's own
 * logic entirely through the in-memory fixture) per Phase 6 §22: real
 * filesystem/process behavior is an integration concern, isolated here.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NotFoundError, ValidationError } from "../core/index.js";
import { NodeMoneyMindRepo } from "../adapters/index.js";

const scratch = () => mkdtempSync(join(tmpdir(), "workforce-money-mind-"));

function seed(dir: string): void {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "fs-fixture",
      version: "0.0.0",
      scripts: { build: 'node -e "process.exit(0)"' },
    }),
  );
  writeFileSync(join(dir, "README.md"), "# fs fixture\n");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "main.js"), "// fixture\n");
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(
    join(dir, "node_modules", "ignored.js"),
    "// should never be read\n",
  );
  writeFileSync(join(dir, ".env"), "SECRET=should-never-be-readable\n");
}

test("fs repo: reads a real file under the configured root", async () => {
  const dir = scratch();
  try {
    seed(dir);
    const repo = new NodeMoneyMindRepo({ repoPath: dir });
    assert.equal(await repo.exists("README.md"), true);
    assert.equal(await repo.readTextFile("README.md"), "# fs fixture\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fs repo: lists a directory without descending automatically", async () => {
  const dir = scratch();
  try {
    seed(dir);
    const repo = new NodeMoneyMindRepo({ repoPath: dir });
    const entries = await repo.listDirectory("");
    const names = entries.map((e) => e.name).sort();
    assert.ok(names.includes("src"));
    assert.ok(names.includes("package.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fs repo: path traversal is rejected before touching the filesystem", async () => {
  const dir = scratch();
  try {
    seed(dir);
    const repo = new NodeMoneyMindRepo({ repoPath: dir });
    await assert.rejects(
      () => repo.readTextFile("../outside.txt"),
      ValidationError,
    );
    await assert.rejects(
      () => repo.readTextFile("..\\outside.txt"),
      ValidationError,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fs repo: a sensitive file (.env, node_modules) is rejected even though it exists on disk", async () => {
  const dir = scratch();
  try {
    seed(dir);
    const repo = new NodeMoneyMindRepo({ repoPath: dir });
    await assert.rejects(() => repo.readTextFile(".env"), ValidationError);
    await assert.rejects(
      () => repo.readTextFile("node_modules/ignored.js"),
      ValidationError,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fs repo: hasScript reflects the real package.json", async () => {
  const dir = scratch();
  try {
    seed(dir);
    const repo = new NodeMoneyMindRepo({ repoPath: dir });
    assert.equal(await repo.hasScript("build"), true);
    assert.equal(await repo.hasScript("test"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fs repo: runScript actually spawns npm and reports a real exit code", async () => {
  const dir = scratch();
  try {
    seed(dir);
    const repo = new NodeMoneyMindRepo({ repoPath: dir });
    const result = await repo.runScript("build", 30_000);
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fs repo: an unconfigured / missing repository path fails safely, never crashes", async () => {
  const repo = new NodeMoneyMindRepo({
    repoPath: join(tmpdir(), "money-mind-does-not-exist-42"),
  });
  await assert.rejects(() => repo.readTextFile("README.md"), NotFoundError);
  assert.equal(await repo.exists("README.md"), false);
});

test("fs repo: constructing with a blank path is rejected immediately", () => {
  assert.throws(() => new NodeMoneyMindRepo({ repoPath: "" }), ValidationError);
  assert.throws(
    () => new NodeMoneyMindRepo({ repoPath: "   " }),
    ValidationError,
  );
});
