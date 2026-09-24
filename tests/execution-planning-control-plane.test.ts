/**
 * EO-3.1 — Execution planning through the Control Plane.
 *
 * Planning flows UI → Control Plane API → Query/Command service → Planning
 * service → Repository. The backend is authoritative for authentication,
 * authorization, project isolation and every derived planning fact. There is
 * no execution route.
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
  ApprovalSystem,
  AuditLog,
  PermissionSystem,
  ProjectRegistry,
  TaskSystem,
  ToolRegistry,
  WorkflowSystem,
  type OperatorDirectory,
  type OperatorPrincipal,
  type ProjectAdapter,
} from "../core/index.js";
import {
  WEB_AGENT,
  WEB_HOST,
  WEB_INSTANCE,
  agent,
  planningFixture,
  webRequest,
} from "./fixtures/planning.js";

const PRINCIPALS: Record<string, OperatorPrincipal> = {
  admin: { id: "admin-1", role: "admin", allowedProjects: "*" },
  alphaOperator: {
    id: "op-alpha",
    role: "operator",
    allowedProjects: ["alpha"],
  },
  betaOperator: { id: "op-beta", role: "operator", allowedProjects: ["beta"] },
  viewer: { id: "viewer-1", role: "viewer", allowedProjects: "*" },
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
  const approvals = new ApprovalSystem();
  const fixture = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [WEB_AGENT, agent("sec-agent", ["security_review"])],
    audit,
    approvals,
  });
  const projects = new ProjectRegistry();
  projects.register(stubAdapter("alpha"));
  projects.register(stubAdapter("beta"));
  const tasks = new TaskSystem();
  const ctx: ControlPlaneContext = {
    agents: fixture.agents,
    tasks,
    workflows: new WorkflowSystem(),
    approvals,
    permissions: new PermissionSystem([]),
    tools: new ToolRegistry(audit),
    projects,
    audit,
    agentOps: new AgentOperationalStore(),
    workflowControl: new WorkflowControlStore(),
    environments: fixture.registry,
    planning: fixture.planning,
  };
  // "pending" = authenticated in Firebase but no AI Workforce role claim:
  // the directory resolves it to null, exactly like FirebaseOperatorDirectory.
  const directory: OperatorDirectory = {
    async resolve(token) {
      return PRINCIPALS[token] ?? null;
    },
  };
  const handler = createControlPlaneApi({
    query: new WorkforceQueryService(ctx),
    command: new WorkforceCommandService(ctx),
    operatorDirectory: directory,
  });
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api`;

  async function call(
    method: "GET" | "POST",
    path: string,
    token: string | undefined,
    body?: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      json: (await response.json()) as Record<string, unknown>,
    };
  }

  return {
    ctx,
    fixture,
    tasks,
    call,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function productionRequest(projectId: string) {
  return {
    ...webRequest(projectId),
    deployments: [
      {
        componentId: "web",
        targetType: "firebase_hosting",
        stage: "production",
        credentialRef: {
          kind: "secret_manager",
          ref: "projects/ai-workforce-agents/secrets/hosting-deployer",
        },
      },
    ],
  };
}

test("create: an authorized operator creates a persisted, audited plan; client status is ignored", async () => {
  const h = await harness();
  try {
    const res = await h.call(
      "POST",
      "/commands/create-execution-plan",
      "alphaOperator",
      {
        ...webRequest("alpha"),
        status: "approved",
        agentId: "someone-else",
      },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.outcome, "executed");
    const planDocId = res.json.resourceId as string;
    const plan = h.fixture.planning.get(planDocId)!;
    assert.equal(plan.status, "ready");
    assert.equal(plan.agents[0]!.agentId, "web-agent");
    assert.ok(
      h.ctx.audit
        .list()
        .some(
          (e) =>
            e.type === "control_command" &&
            e.data.command === "create_execution_plan",
        ),
    );
    assert.ok(
      h.ctx.audit
        .list()
        .some(
          (e) =>
            e.type === "execution_plan_event" && e.data.action === "created",
        ),
    );
  } finally {
    await h.close();
  }
});

test("create: viewer is forbidden, missing project is 404, invalid body is 400", async () => {
  const h = await harness();
  try {
    const viewer = await h.call(
      "POST",
      "/commands/create-execution-plan",
      "viewer",
      webRequest("alpha"),
    );
    assert.equal(viewer.status, 403);
    const ghost = await h.call(
      "POST",
      "/commands/create-execution-plan",
      "admin",
      webRequest("ghost"),
    );
    assert.equal(ghost.status, 404);
    const invalid = await h.call(
      "POST",
      "/commands/create-execution-plan",
      "admin",
      {
        projectId: "alpha",
        title: "x",
        components: [],
      },
    );
    assert.equal(invalid.status, 400);
    assert.deepEqual(h.fixture.planning.listByProject("alpha"), []);
    assert.deepEqual(h.fixture.planning.listByProject("ghost"), []);
  } finally {
    await h.close();
  }
});

test("awaiting access: authenticated without a role claim gets 401 on every planning route", async () => {
  const h = await harness();
  try {
    assert.equal(
      (await h.call("GET", "/projects/alpha/execution-plans", "pending"))
        .status,
      401,
    );
    assert.equal(
      (
        await h.call(
          "POST",
          "/commands/create-execution-plan",
          "pending",
          webRequest("alpha"),
        )
      ).status,
      401,
    );
    assert.equal(
      (await h.call("GET", "/projects/alpha/execution-plans", undefined))
        .status,
      401,
    );
  } finally {
    await h.close();
  }
});

test("project isolation: a project-A operator cannot create, read, list or replan project-B plans", async () => {
  const h = await harness();
  try {
    const created = await h.call(
      "POST",
      "/commands/create-execution-plan",
      "betaOperator",
      webRequest("beta"),
    );
    const betaPlan = h.fixture.planning.get(created.json.resourceId as string)!;

    const createB = await h.call(
      "POST",
      "/commands/create-execution-plan",
      "alphaOperator",
      webRequest("beta"),
    );
    assert.equal(createB.status, 403);
    assert.equal(h.fixture.planning.listByProject("beta").length, 1);

    assert.equal(
      (await h.call("GET", "/projects/beta/execution-plans", "alphaOperator"))
        .status,
      404,
    );
    assert.equal(
      (
        await h.call(
          "GET",
          `/projects/beta/execution-plans/${betaPlan.planId}`,
          "alphaOperator",
        )
      ).status,
      404,
    );
    // IDOR: a B plan id under an A path is indistinguishable from a missing plan.
    assert.equal(
      (
        await h.call(
          "GET",
          `/projects/alpha/execution-plans/${betaPlan.planId}`,
          "alphaOperator",
        )
      ).status,
      404,
    );
    const replan = await h.call(
      "POST",
      "/commands/replan-execution-plan",
      "alphaOperator",
      {
        planId: betaPlan.planId,
      },
    );
    assert.equal(replan.status, 403);

    const own = await h.call(
      "GET",
      `/projects/beta/execution-plans/${betaPlan.planId}`,
      "betaOperator",
    );
    assert.equal(own.status, 200);
  } finally {
    await h.close();
  }
});

test("views: credential references are hidden and execution is explicitly unavailable", async () => {
  const h = await harness();
  try {
    const created = await h.call(
      "POST",
      "/commands/create-execution-plan",
      "admin",
      productionRequest("alpha"),
    );
    const plan = h.fixture.planning.get(created.json.resourceId as string)!;
    const res = await h.call(
      "GET",
      `/projects/alpha/execution-plans/${plan.planId}`,
      "viewer",
    );
    assert.equal(res.status, 200);
    const body = JSON.stringify(res.json);
    assert.doesNotMatch(body, /hosting-deployer/);
    assert.equal(
      (res.json.execution as { available: boolean }).available,
      false,
    );
    assert.equal(res.json.current, true);
    const badVersion = await h.call(
      "GET",
      `/projects/alpha/execution-plans/${plan.planId}?version=abc`,
      "viewer",
    );
    assert.equal(badVersion.status, 400);
  } finally {
    await h.close();
  }
});

test("approval: submit → existing approve command → plan APPROVED; nothing is executed", async () => {
  const h = await harness();
  try {
    const created = await h.call(
      "POST",
      "/commands/create-execution-plan",
      "alphaOperator",
      productionRequest("alpha"),
    );
    const plan = h.fixture.planning.get(created.json.resourceId as string)!;
    assert.equal(plan.status, "ready");

    const submitted = await h.call(
      "POST",
      "/commands/submit-execution-plan",
      "alphaOperator",
      {
        planId: plan.planId,
      },
    );
    assert.equal(submitted.status, 200);
    const approvalId = (submitted.json.details as { approvalId: string })
      .approvalId;

    // A project-B operator cannot decide a project-A plan approval.
    const foreign = await h.call("POST", "/commands/approve", "betaOperator", {
      approvalId,
    });
    assert.equal(foreign.status, 403);

    const approved = await h.call(
      "POST",
      "/commands/approve",
      "alphaOperator",
      { approvalId },
    );
    assert.equal(approved.status, 200);
    assert.equal(h.fixture.planning.latest(plan.planId)?.status, "approved");
    assert.deepEqual(h.tasks.list(), []);
  } finally {
    await h.close();
  }
});

test("no execution API exists", async () => {
  const h = await harness();
  try {
    for (const name of [
      "execute-execution-plan",
      "run-execution-plan",
      "deploy",
      "shell",
    ]) {
      assert.equal(
        (await h.call("POST", `/commands/${name}`, "admin", {})).status,
        404,
      );
    }
    assert.equal(
      (await h.call("POST", "/projects/alpha/execution-plans", "admin", {}))
        .status,
      404,
    );
  } finally {
    await h.close();
  }
});

test("pagination: bounded pages, stable order, next cursor, malformed cursor → first page", async () => {
  const h = await harness();
  try {
    for (let i = 0; i < 3; i += 1) {
      await h.call(
        "POST",
        "/commands/create-execution-plan",
        "admin",
        webRequest("alpha"),
      );
    }
    await h.call(
      "POST",
      "/commands/create-execution-plan",
      "admin",
      webRequest("beta"),
    );
    const first = await h.call(
      "GET",
      "/projects/alpha/execution-plans?limit=2",
      "admin",
    );
    assert.equal(first.status, 200);
    assert.equal(first.json.total, 3);
    const items = first.json.items as { id: string; projectId: string }[];
    assert.equal(items.length, 2);
    assert.ok(items.every((i) => i.projectId === "alpha"));
    assert.ok(first.json.nextCursor);
    const second = await h.call(
      "GET",
      `/projects/alpha/execution-plans?limit=2&cursor=${first.json.nextCursor as string}`,
      "admin",
    );
    const rest = second.json.items as { id: string }[];
    assert.equal(rest.length, 1);
    assert.equal(second.json.nextCursor, null);
    assert.ok(!items.some((i) => i.id === rest[0]!.id));
    const malformed = await h.call(
      "GET",
      "/projects/alpha/execution-plans?limit=2&cursor=%%%",
      "admin",
    );
    assert.deepEqual(
      (malformed.json.items as { id: string }[]).map((i) => i.id),
      items.map((i) => i.id),
    );
  } finally {
    await h.close();
  }
});
