/**
 * R2B — admin execution-job endpoints.
 *
 * `/execution-jobs` is the Control Plane's enqueue path for the Cloud
 * Run worker. These tests pin the policy surface:
 *   - 503 fail-closed when EXECUTION_WORKER_ENABLED is false
 *   - 403 for non-admin principals
 *   - 403 cross-project for a scoped admin
 *   - 202 enqueues and returns a jobId
 *   - 200 round-trips the job via GET
 *   - idempotency key dedup returns the existing job
 *   - cancellation flips the flag
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createControlPlaneApi } from "../api/index.js";
import { FirestoreExecutionJobQueue } from "../adapters/index.js";
import {
  AgentOperationalStore,
  WorkflowControlStore,
  WorkforceCommandService,
  WorkforceQueryService,
  type ControlPlaneContext,
} from "../control/index.js";
import {
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  PermissionSystem,
  ProjectRegistry,
  TaskSystem,
  ToolRegistry,
  WorkflowSystem,
  type OperatorPrincipal,
  type ProjectAdapter,
} from "../core/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

const PRINCIPALS: Record<string, OperatorPrincipal> = {
  admin: { id: "admin-1", role: "admin", allowedProjects: "*" },
  "admin-scoped": {
    id: "admin-2",
    role: "admin",
    allowedProjects: ["r2b-live"],
  },
  operator: { id: "op-1", role: "operator", allowedProjects: "*" },
};

function stubAdapter(projectId: string): ProjectAdapter {
  return {
    projectId,
    async describe() {
      return { name: projectId, capabilities: [] };
    },
    async execute() {
      return {};
    },
  };
}

async function harness(options: {
  executionWorkerEnabled?: boolean;
  queue?: FirestoreExecutionJobQueue;
}) {
  const audit = new AuditLog();
  const projects = new ProjectRegistry();
  projects.register(stubAdapter("r2b-live"));
  projects.register(stubAdapter("other"));
  const ctx: ControlPlaneContext = {
    agents: new AgentRegistry(),
    tasks: new TaskSystem(),
    workflows: new WorkflowSystem(),
    approvals: new ApprovalSystem(),
    permissions: new PermissionSystem([]),
    tools: new ToolRegistry(audit),
    projects,
    audit,
    agentOps: new AgentOperationalStore(),
    workflowControl: new WorkflowControlStore(),
  };
  const server = http.createServer(
    createControlPlaneApi({
      query: new WorkforceQueryService(ctx),
      command: new WorkforceCommandService(ctx),
      operatorDirectory: { resolve: async (t) => PRINCIPALS[t] ?? null },
      executionJobQueue: options.queue,
      executionWorkerEnabled: options.executionWorkerEnabled,
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const call = async (
    method: string,
    path: string,
    token = "admin",
    body?: unknown,
  ) => {
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    };
  };
  return {
    call,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const sampleTool = {
  toolId: "workspace.filesystem",
  action: "write",
  input: { action: "write", path: "r2b.txt", content: "hello" },
  requiredCapability: "workspace.write",
};

test("POST /execution-jobs returns 503 when the backend flag is off", async () => {
  const h = await harness({ executionWorkerEnabled: false });
  const { status, body } = await h.call("POST", "/execution-jobs", "admin", {
    projectId: "r2b-live",
    tool: sampleTool,
  });
  assert.equal(status, 503);
  assert.match(JSON.stringify(body), /execution worker disabled/);
  await h.close();
});

test("POST /execution-jobs returns 403 for a non-admin principal", async () => {
  const queue = new FirestoreExecutionJobQueue(new FakeFirestore());
  const h = await harness({ executionWorkerEnabled: true, queue });
  const { status } = await h.call("POST", "/execution-jobs", "operator", {
    projectId: "r2b-live",
    tool: sampleTool,
  });
  assert.equal(status, 403);
  await h.close();
});

test("POST /execution-jobs enqueues a job and returns 202 with jobId", async () => {
  const queue = new FirestoreExecutionJobQueue(new FakeFirestore());
  const h = await harness({ executionWorkerEnabled: true, queue });
  const { status, body } = await h.call("POST", "/execution-jobs", "admin", {
    projectId: "r2b-live",
    tool: sampleTool,
  });
  assert.equal(status, 202);
  assert.ok(typeof body?.jobId === "string" && (body.jobId as string).startsWith("job_"));
  assert.equal(body?.status, "queued");

  // Round-trip via GET /execution-jobs/{jobId}
  const read = await h.call("GET", `/execution-jobs/${body!.jobId}`, "admin");
  assert.equal(read.status, 200);
  assert.equal(
    (read.body?.job as { jobId: string }).jobId,
    body!.jobId,
  );
  await h.close();
});

test("POST /execution-jobs refuses a project outside the admin's scope", async () => {
  const queue = new FirestoreExecutionJobQueue(new FakeFirestore());
  const h = await harness({ executionWorkerEnabled: true, queue });
  const { status } = await h.call(
    "POST",
    "/execution-jobs",
    "admin-scoped",
    { projectId: "other", tool: sampleTool },
  );
  assert.equal(status, 403);
  await h.close();
});

test("POST /execution-jobs with duplicate idempotencyKey returns the existing job", async () => {
  const queue = new FirestoreExecutionJobQueue(new FakeFirestore());
  const h = await harness({ executionWorkerEnabled: true, queue });
  const payload = {
    projectId: "r2b-live",
    tool: sampleTool,
    idempotencyKey: "fixed-key-1",
  };
  const first = await h.call("POST", "/execution-jobs", "admin", payload);
  assert.equal(first.status, 202);
  const second = await h.call("POST", "/execution-jobs", "admin", payload);
  assert.equal(second.status, 200);
  assert.equal(second.body?.deduped, true);
  assert.equal(second.body?.jobId, first.body?.jobId);
  await h.close();
});

test("POST /execution-jobs/{id}/cancel marks the job for cancellation", async () => {
  const queue = new FirestoreExecutionJobQueue(new FakeFirestore());
  const h = await harness({ executionWorkerEnabled: true, queue });
  const { body } = await h.call("POST", "/execution-jobs", "admin", {
    projectId: "r2b-live",
    tool: sampleTool,
  });
  const jobId = body?.jobId as string;
  const cancel = await h.call(
    "POST",
    `/execution-jobs/${jobId}/cancel`,
    "admin",
    { reason: "integration test" },
  );
  assert.equal(cancel.status, 202);
  assert.equal(cancel.body?.cancellationRequested, true);

  const read = await h.call("GET", `/execution-jobs/${jobId}`, "admin");
  assert.equal((read.body?.job as { cancellationRequested?: boolean }).cancellationRequested, true);
  await h.close();
});
