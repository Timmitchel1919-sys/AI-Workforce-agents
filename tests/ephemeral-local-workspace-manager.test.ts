import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, access, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EphemeralLocalWorkspaceManager } from "../adapters/index.js";
import { ValidationError } from "../contracts/index.js";

async function manager(): Promise<EphemeralLocalWorkspaceManager> {
  const base = await mkdtemp(join(tmpdir(), "aw-wm-"));
  return new EphemeralLocalWorkspaceManager({ baseDir: base, prefix: "ws" });
}

test("acquire creates an isolated workspace with a canonical rootPath", async () => {
  const mgr = await manager();
  const lease = await mgr.acquire({ workspaceId: "job-1", projectId: "p-1" });
  const info = await stat(lease.rootPath);
  assert.ok(info.isDirectory());
  assert.equal(lease.workspaceId, "job-1");
  assert.equal(lease.projectId, "p-1");
  await lease.release();
});

test("release removes the workspace directory", async () => {
  const mgr = await manager();
  const lease = await mgr.acquire({ workspaceId: "job-2", projectId: "p-1" });
  const file = await lease.resolveInside("hello.txt");
  await writeFile(file, "hi");
  await lease.release();
  await assert.rejects(() => access(file));
  assert.equal(mgr.activeCount(), 0);
});

test("resolveInside rejects path escapes", async () => {
  const mgr = await manager();
  const lease = await mgr.acquire({ workspaceId: "job-3", projectId: "p-1" });
  await assert.rejects(
    () => lease.resolveInside("../outside"),
    (e: unknown) => e instanceof ValidationError,
  );
  await assert.rejects(
    () => lease.resolveInside("/absolute"),
    (e: unknown) => e instanceof ValidationError,
  );
  await lease.release();
});

test("acquire validates workspaceId and refuses duplicates", async () => {
  const mgr = await manager();
  await assert.rejects(
    () => mgr.acquire({ workspaceId: "", projectId: "p-1" }),
    (e: unknown) => e instanceof ValidationError,
  );
  await assert.rejects(
    () => mgr.acquire({ workspaceId: "a/b", projectId: "p-1" }),
    (e: unknown) => e instanceof ValidationError,
  );
  const lease = await mgr.acquire({ workspaceId: "ok-1", projectId: "p-1" });
  await assert.rejects(
    () => mgr.acquire({ workspaceId: "ok-1", projectId: "p-1" }),
    (e: unknown) => e instanceof ValidationError,
  );
  await lease.release();
});

test("round-trip: write + read inside the workspace", async () => {
  const mgr = await manager();
  const lease = await mgr.acquire({ workspaceId: "rt-1", projectId: "p-1" });
  const file = await lease.resolveInside("note.txt");
  await writeFile(file, "contents");
  const bytes = await readFile(file, "utf8");
  assert.equal(bytes, "contents");
  await lease.release();
});
