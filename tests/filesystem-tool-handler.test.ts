import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EphemeralLocalWorkspaceManager } from "../adapters/index.js";
import { FilesystemToolHandler } from "../adapters/index.js";
import type { WorkerWorkspaceLease } from "../core/index.js";
import { ValidationError } from "../contracts/index.js";

async function workspace(): Promise<WorkerWorkspaceLease> {
  const base = await mkdtemp(join(tmpdir(), "aw-fs-"));
  const mgr = new EphemeralLocalWorkspaceManager({ baseDir: base });
  return mgr.acquire({ workspaceId: "fs-test", projectId: "p-1" });
}

test("write + read round-trip", async () => {
  const lease = await workspace();
  const handler = new FilesystemToolHandler();
  await handler.run(lease, {
    action: "write",
    path: "greet.txt",
    content: "hello",
  });
  const result = await handler.run(lease, {
    action: "read",
    path: "greet.txt",
  });
  assert.equal(result.action, "read");
  if (result.action === "read") {
    assert.equal(result.content, "hello");
    assert.equal(result.bytes, 5);
    assert.equal(result.truncated, false);
  }
  await lease.release();
});

test("exists returns correct kind", async () => {
  const lease = await workspace();
  const handler = new FilesystemToolHandler();
  const missing = await handler.run(lease, {
    action: "exists",
    path: "nope.txt",
  });
  assert.deepEqual(missing, { action: "exists", kind: "missing" });

  await handler.run(lease, {
    action: "write",
    path: "there.txt",
    content: "x",
  });
  const file = await handler.run(lease, {
    action: "exists",
    path: "there.txt",
  });
  assert.deepEqual(file, { action: "exists", kind: "file" });
  await lease.release();
});

test("list returns bounded entries", async () => {
  const lease = await workspace();
  const handler = new FilesystemToolHandler();
  await handler.run(lease, { action: "write", path: "a.txt", content: "a" });
  await handler.run(lease, { action: "write", path: "b.txt", content: "b" });
  const result = await handler.run(lease, { action: "list", path: "." });
  assert.equal(result.action, "list");
  if (result.action === "list") {
    assert.ok(result.entries.some((e) => e.name === "a.txt"));
    assert.ok(result.entries.some((e) => e.name === "b.txt"));
  }
  await lease.release();
});

test("path confinement rejects traversal and absolute paths", async () => {
  const lease = await workspace();
  const handler = new FilesystemToolHandler();
  await assert.rejects(() =>
    handler.run(lease, { action: "read", path: "../etc/passwd" }),
  );
  await assert.rejects(() =>
    handler.run(lease, { action: "read", path: "/etc/passwd" }),
  );
  await assert.rejects(() =>
    handler.run(lease, { action: "write", path: "../x", content: "evil" }),
  );
  await lease.release();
});

test("write to secret-classified path is denied", async () => {
  const lease = await workspace();
  const handler = new FilesystemToolHandler();
  await assert.rejects(
    () =>
      handler.run(lease, {
        action: "write",
        path: ".env",
        content: "SECRET=x",
      }),
    (e: unknown) =>
      e instanceof ValidationError && /classified as secret/.test(e.message),
  );
  await lease.release();
});

test("write that exceeds policy maxWriteBytes is denied", async () => {
  const lease = await workspace();
  const handler = new FilesystemToolHandler({
    policy: {
      maxReadBytes: 10,
      maxWriteBytes: 10,
      maxListEntries: 10,
      maxSearchResults: 10,
      maxSearchFiles: 10,
      maxSearchFileBytes: 10,
      maxChangedFiles: 10,
      secretPatterns: [],
      protectedPatterns: [],
      generatedPatterns: [],
    },
  });
  await assert.rejects(
    () =>
      handler.run(lease, {
        action: "write",
        path: "big.txt",
        content: "x".repeat(100),
      }),
    (e: unknown) =>
      e instanceof ValidationError && /exceeds maxWriteBytes/.test(e.message),
  );
  await lease.release();
});
