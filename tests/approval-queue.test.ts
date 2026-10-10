/**
 * Approval queue (Approvals screen): `GET /api/approvals` is server-filtered
 * (status, project) and cursor-paginated, and approvals stay inside project
 * isolation even when their metadata only names a task.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createControlPlaneApi } from "../api/index.js";
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

const PRINCIPALS: Record<string, OperatorPrincipal> = {
  admin: { id: "admin-1", role: "admin", allowedProjects: "*" },
  beta: { id: "op-beta", role: "operator", allowedProjects: ["beta"] },
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

async function harness() {
  const audit = new AuditLog();
  const tasks = new TaskSystem();
  const approvals = new ApprovalSystem();
  const projects = new ProjectRegistry();
  projects.register(stubAdapter("alpha"));
  projects.register(stubAdapter("beta"));
  const ctx: ControlPlaneContext = {
    agents: new AgentRegistry(),
    tasks,
    workflows: new WorkflowSystem(),
    approvals,
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
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const get = async (path: string, token = "admin") => {
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return {
      status: res.status,
      body: (await res.json()) as Record<string, unknown>,
    };
  };
  return {
    tasks,
    approvals,
    get,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

type Item = {
  approvalId: string;
  projectId?: string;
  status: string;
  executionPlanId?: string;
  planVersion?: number;
};

test("approvals: a task-only approval inherits its task's project and stays isolated", async () => {
  const h = await harness();
  try {
    const task = h.tasks.create({
      type: "ops",
      description: "deploy",
      projectId: "alpha",
    });
    h.approvals.request({
      action: "deploy_release",
      requestedBy: "orchestrator",
      reason: "production deploy",
      metadata: { taskId: task.id },
    });

    const admin = await h.get("/approvals");
    const items = admin.body.items as Item[];
    assert.equal(items.length, 1);
    assert.equal(items[0]!.projectId, "alpha");

    // Operator scoped to beta must not see alpha's task approval.
    const beta = await h.get("/approvals", "beta");
    assert.equal(beta.body.total, 0);
  } finally {
    await h.close();
  }
});

test("approvals: status + project filters and bounded cursor pagination, newest first", async () => {
  const h = await harness();
  try {
    for (let i = 0; i < 5; i += 1) {
      h.approvals.request({
        action: `action_${i}`,
        requestedBy: "system",
        reason: "r",
        metadata: { projectId: i % 2 === 0 ? "alpha" : "beta" },
      });
    }
    const decided = h.approvals.list()[0]!;
    h.approvals.decide(decided.id, "approved", "admin-1");

    const pending = await h.get("/approvals?status=requested&limit=2");
    assert.equal(pending.body.total, 4);
    assert.equal((pending.body.items as Item[]).length, 2);
    assert.ok(pending.body.nextCursor);
    const next = await h.get(
      `/approvals?status=requested&limit=2&cursor=${pending.body.nextCursor as string}`,
    );
    assert.equal((next.body.items as Item[]).length, 2);
    assert.equal(next.body.nextCursor, null);

    const alpha = await h.get("/approvals?projectId=alpha");
    assert.ok(
      (alpha.body.items as Item[]).every((i) => i.projectId === "alpha"),
    );
    assert.equal(alpha.body.total, 3);
    // A foreign project filter yields nothing for a scoped operator.
    const foreign = await h.get("/approvals?projectId=alpha", "beta");
    assert.equal(foreign.body.total, 0);
  } finally {
    await h.close();
  }
});

test("approvals: plan approvals expose the exact plan revision they gate", async () => {
  const h = await harness();
  try {
    h.approvals.request({
      action: "execution_plan.approve",
      requestedBy: "op-1",
      reason: "Execution plan plan_1 v2 requires approval",
      metadata: {
        executionPlanId: "plan_1@v2",
        projectId: "alpha",
        planVersion: 2,
      },
    });
    const res = await h.get("/approvals");
    const item = (res.body.items as Item[])[0]!;
    assert.equal(item.executionPlanId, "plan_1@v2");
    assert.equal(item.planVersion, 2);
  } finally {
    await h.close();
  }
});
