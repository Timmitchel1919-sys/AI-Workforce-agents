/**
 * End-to-end R2 demonstration: Control Plane enqueues a filesystem-write
 * job; the in-process worker loop acquires it, dispatches to the real
 * filesystem handler, writes a file inside an ephemeral workspace, and
 * completes the job. Proves the full pipeline:
 *
 *   enqueue → acquire → workspace → tool handler → complete.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EphemeralLocalWorkspaceManager,
  FilesystemToolHandler,
  FirestoreExecutionJobQueue,
} from "../adapters/index.js";
import {
  ToolActionDispatcher,
  runOnce,
  type ExecutionJob,
} from "../core/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

test("worker end-to-end: enqueue a filesystem.write job and drain it to succeeded", async () => {
  const firestore = new FakeFirestore();
  const queue = new FirestoreExecutionJobQueue(firestore);
  const base = await mkdtemp(join(tmpdir(), "aw-e2e-"));
  const workspace = new EphemeralLocalWorkspaceManager({ baseDir: base });
  const filesystem = new FilesystemToolHandler();
  const dispatcher = new ToolActionDispatcher({ workspace });
  dispatcher.register(
    { toolId: "workspace.filesystem", action: "write" },
    ({ workspace, job }) => filesystem.run(workspace, job.tool.input as never),
  );

  const t = new Date().toISOString();
  const job: ExecutionJob = {
    jobId: "e2e-1",
    idempotencyKey: "e2e-key-1",
    projectId: "project-e2e",
    taskId: "task-e2e",
    agentId: "agent-e2e",
    executionId: "exec-e2e",
    tool: {
      toolId: "workspace.filesystem",
      action: "write",
      input: {
        action: "write",
        path: "note.txt",
        content: "e2e lives",
      },
      requiredCapability: "workspace.write",
    },
    status: "queued",
    attempt: 0,
    maxAttempts: 3,
    createdAt: t,
    availableAt: t,
    updatedAt: t,
  };
  await queue.enqueue({ job });

  // Drain exactly one job through the worker loop.
  const drained = await runOnce({
    workerId: "e2e-worker",
    queue,
    dispatcher,
    leaseTtlMs: 60_000,
  });
  assert.equal(drained?.jobId, "e2e-1");

  const stored = await queue.get("e2e-1");
  assert.equal(stored?.status, "succeeded");

  // Workspace is cleaned up on release, so the file no longer exists on disk,
  // but we already know the handler returned success — if it hadn't the queue
  // would be in `failed`.
});

test("worker end-to-end: unknown tool action fails job with structured error", async () => {
  const firestore = new FakeFirestore();
  const queue = new FirestoreExecutionJobQueue(firestore);
  const base = await mkdtemp(join(tmpdir(), "aw-e2e-"));
  const workspace = new EphemeralLocalWorkspaceManager({ baseDir: base });
  const dispatcher = new ToolActionDispatcher({ workspace });
  // Register nothing.

  const t = new Date().toISOString();
  await queue.enqueue({
    job: {
      jobId: "e2e-unknown",
      idempotencyKey: "e2e-unknown-key",
      projectId: "p",
      taskId: "t",
      agentId: "a",
      executionId: "e",
      tool: {
        toolId: "mystery",
        action: "do",
        input: {},
        requiredCapability: "none",
      },
      status: "queued",
      attempt: 0,
      maxAttempts: 1,
      createdAt: t,
      availableAt: t,
      updatedAt: t,
    },
  });
  await runOnce({
    workerId: "e2e",
    queue,
    dispatcher,
    leaseTtlMs: 60_000,
  });
  const stored = await queue.get("e2e-unknown");
  assert.equal(stored?.status, "failed");
  assert.equal(stored?.lastError?.code, "unknown_tool_action");
  assert.equal(stored?.lastError?.retryable, false);
});
