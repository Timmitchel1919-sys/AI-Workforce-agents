/**
 * EO-4.7 — Execution Control Center over the Control Plane HTTP API.
 *
 * Read models are authoritative (sessions, receipts, audit timeline,
 * verifications, releases, environment status), project-scoped (IDOR →
 * 404), bounded, redacted — and mutation stays on the typed, audited
 * cancel/kill commands. No execute/shell endpoint exists.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON response bodies are asserted field by field */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createControlPlaneApi } from "../api/index.js";
import {
  FirebaseOperatorDirectory,
  createPlatformAdapters,
  type DecodedTokenLike,
  type FirebaseAuthLike,
} from "../adapters/index.js";
import {
  AgentOperationalStore,
  WorkflowControlStore,
  WorkforceCommandService,
  WorkforceQueryService,
  type ControlPlaneContext,
} from "../control/index.js";
import {
  EnvironmentAdapterRegistry,
  InMemoryExecutionReceiptStore,
  InMemoryOperatorAccountStore,
  PermissionSystem,
  ProjectRegistry,
  TaskSystem,
  WorkflowSystem,
  type OperatorPrincipal,
  type ProjectAdapter,
} from "../core/index.js";
import {
  ADMIN,
  BETA_OPERATOR,
  FAKE_SECRET,
  OPERATOR,
  VIEWER,
  harness,
} from "./fixtures/execution.js";

class FakeAuth implements FirebaseAuthLike {
  async verifyIdToken(token: string): Promise<DecodedTokenLike> {
    if (!token.startsWith("tok-")) throw new Error("invalid token");
    return {
      uid: token.slice(4),
      email: `${token.slice(4)}@example.test`,
      email_verified: true,
    };
  }
}

const stubAdapter = (projectId: string): ProjectAdapter => ({
  projectId,
  async describe() {
    return { name: projectId, capabilities: [] };
  },
  async execute() {
    return {};
  },
});

async function api() {
  const h = await harness();
  const accounts = new InMemoryOperatorAccountStore();
  await accounts.commit({
    kind: "create_pending",
    account: {
      id: "pending-uid",
      status: "pending",
      allowedProjects: [],
      emailVerified: true,
      requestedAt: "2026-09-24T00:00:00.000Z",
      updatedAt: "2026-09-24T00:00:00.000Z",
      revision: 1,
    },
  });
  const firebase = new FirebaseOperatorDirectory(new FakeAuth(), accounts);
  const principals: Record<string, OperatorPrincipal> = {
    admin: ADMIN,
    operator: OPERATOR,
    viewer: VIEWER,
    beta: BETA_OPERATOR,
  };
  const projects = new ProjectRegistry();
  projects.register(stubAdapter("alpha"));
  projects.register(stubAdapter("beta"));
  const environmentAdapters = new EnvironmentAdapterRegistry({
    environments: h.fixture.registry,
  });
  createPlatformAdapters({
    containerPolicy: { approvedImages: [], requireDigest: true },
  }).forEach((a) => environmentAdapters.registerAdapter(a));
  const ctx: ControlPlaneContext = {
    agents: h.fixture.agents,
    tasks: new TaskSystem(),
    workflows: new WorkflowSystem(),
    approvals: h.fixture.approvals,
    permissions: new PermissionSystem([]),
    tools: h.tools,
    projects,
    audit: h.fixture.audit,
    agentOps: new AgentOperationalStore(),
    workflowControl: new WorkflowControlStore(),
    environments: h.fixture.registry,
    planning: h.fixture.planning,
    execution: h.manager,
    executionReceipts: new InMemoryExecutionReceiptStore(),
    environmentAdapters,
  };
  const server = http.createServer(
    createControlPlaneApi({
      query: new WorkforceQueryService(ctx),
      command: new WorkforceCommandService(ctx),
      operatorDirectory: {
        resolve: async (token) =>
          principals[token] ?? (await firebase.resolve(token)),
      },
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const call = async (
    method: string,
    path: string,
    token?: string,
    body?: unknown,
  ) => {
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: (text ? JSON.parse(text) : null) as Record<string, unknown> & {
        items?: Record<string, unknown>[];
      },
    };
  };
  let keys = 0;
  const newSession = async () =>
    (await h.manager.createSession(OPERATOR, h.request(), `cc-${++keys}`))
      .session;
  return {
    ...h,
    ctx,
    call,
    newSession,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

test("EO-4.7 63/65/64 AUTH: unauthenticated 401, pending access 401, cross-project 404, viewer may read", async () => {
  const a = await api();
  try {
    await a.newSession();
    for (const path of [
      "/projects/alpha/executions",
      "/projects/alpha/execution-overview",
      "/projects/alpha/verifications",
      "/projects/alpha/releases",
      "/execution/environments",
    ]) {
      assert.equal((await a.call("GET", path)).status, 401, path);
      assert.equal(
        (await a.call("GET", path, "tok-pending-uid")).status,
        401,
        `${path} pending`,
      );
    }
    assert.equal(
      (await a.call("GET", "/projects/alpha/executions", "beta")).status,
      404,
    );
    assert.equal(
      (await a.call("GET", "/projects/alpha/releases", "beta")).status,
      404,
    );
    assert.equal(
      (await a.call("GET", "/projects/alpha/executions", "viewer")).status,
      200,
    );
  } finally {
    await a.close();
  }
});

test("EO-4.7 90/69 SESSION LIST: project-scoped, newest first, bounded pagination", async () => {
  const a = await api();
  try {
    const first = await a.newSession();
    const second = await a.newSession();
    const page = await a.call(
      "GET",
      "/projects/alpha/executions?limit=1",
      "operator",
    );
    assert.equal(page.status, 200);
    assert.equal(page.body.total, 2);
    assert.equal(page.body.items!.length, 1);
    assert.equal(page.body.items![0]!.sessionId, second.sessionId);
    const next = await a.call(
      "GET",
      "/projects/alpha/executions?limit=1&offset=1",
      "operator",
    );
    assert.equal(next.body.items![0]!.sessionId, first.sessionId);
    assert.equal(
      (
        await a.call(
          "GET",
          "/projects/alpha/executions?limit=100000",
          "operator",
        )
      ).body.limit,
      100,
      "server caps page size",
    );
    assert.equal(
      (await a.call("GET", "/projects/alpha/executions?limit=-1", "operator"))
        .status,
      400,
    );
    assert.equal(
      (await a.call("GET", "/projects/beta/executions", "beta")).body.total,
      0,
      "no leakage into beta",
    );
  } finally {
    await a.close();
  }
});

test("EO-4.7 91/92/105/12 SESSION DETAIL: authoritative data, agent ≠ model, real timeline only; IDOR is 404", async () => {
  const a = await api();
  try {
    const s = await a.newSession();
    const detail = await a.call(
      "GET",
      `/projects/alpha/executions/${s.sessionId}`,
      "operator",
    );
    assert.equal(detail.status, 200);
    const body = detail.body as Record<string, any>;
    assert.equal(body.session.sessionId, s.sessionId);
    assert.equal(body.session.plan.planId, s.plan.planId);
    assert.equal(body.agent.agentId, s.agentId);
    assert.ok(!("model" in body.agent), "agent and model are separate");
    assert.equal(
      body.environment.environmentInstanceId,
      s.environmentInstanceId,
    );
    assert.deepEqual(
      body.receipts,
      [],
      "no invocations → no receipts (nothing fabricated)",
    );
    const actions = (body.timeline.items as { action: string }[]).map(
      (e) => e.action,
    );
    assert.ok(actions.includes("session_created"));
    assert.ok(
      !actions.includes("operation_completed"),
      "only events that happened",
    );
    // IDOR: a valid session id under another project (or another operator's project).
    assert.equal(
      (await a.call("GET", `/projects/beta/executions/${s.sessionId}`, "admin"))
        .status,
      404,
    );
    assert.equal(
      (await a.call("GET", `/projects/alpha/executions/${s.sessionId}`, "beta"))
        .status,
      404,
    );
    assert.equal(
      (
        await a.call(
          "GET",
          `/projects/alpha/executions/exs_nonexistent`,
          "operator",
        )
      ).status,
      404,
    );
  } finally {
    await a.close();
  }
});

test("EO-4.7 93/94/95/53/57 CANCEL: unauthorized 403; authorized cancels + audits; stale cancel is safe; kill is admin-only", async () => {
  const a = await api();
  try {
    const s = await a.newSession();
    assert.equal(
      (
        await a.call("POST", "/commands/cancel-execution", "viewer", {
          sessionId: s.sessionId,
          reason: "x",
        })
      ).status,
      403,
    );
    const ok = await a.call("POST", "/commands/cancel-execution", "operator", {
      sessionId: s.sessionId,
      reason: "operator stop",
    });
    assert.equal(ok.status, 200);
    const detail = (
      await a.call(
        "GET",
        `/projects/alpha/executions/${s.sessionId}`,
        "operator",
      )
    ).body as Record<string, any>;
    assert.equal(detail.session.status, "cancelled");
    assert.equal(detail.session.cancellation.kind, "cancel");
    assert.ok(
      (detail.timeline.items as { action: string }[]).some((e) =>
        /cancel/.test(e.action),
      ),
      "audited",
    );
    const again = await a.call(
      "POST",
      "/commands/cancel-execution",
      "operator",
      { sessionId: s.sessionId, reason: "again" },
    );
    assert.equal(again.status, 200);
    assert.equal(
      (again.body.details as { outcome: string }).outcome,
      "already_cancelled",
      "no second state change",
    );
    const other = await a.newSession();
    assert.equal(
      (
        await a.call("POST", "/commands/kill-execution", "operator", {
          sessionId: other.sessionId,
          reason: "x",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await a.call("POST", "/commands/kill-execution", "admin", {
          sessionId: other.sessionId,
          reason: "emergency",
        })
      ).status,
      200,
    );
  } finally {
    await a.close();
  }
});

test("EO-4.7 5/16/95 OVERVIEW + ENVIRONMENTS: real counts only; contracts are never reported as operational", async () => {
  const a = await api();
  try {
    await a.newSession();
    const overview = (
      await a.call("GET", "/projects/alpha/execution-overview", "operator")
    ).body as Record<string, any>;
    assert.equal(overview.sessions.total, 1);
    assert.deepEqual(overview.verifications, { configured: false });
    assert.deepEqual(overview.releases, { configured: false });
    const env = (await a.call("GET", "/execution/environments", "viewer"))
      .body as Record<string, any>;
    assert.equal(env.configured, true);
    assert.ok(
      (env.families as { status: string }[]).every(
        (f) => f.status === "not_configured",
      ),
    );
    const verifications = (
      await a.call("GET", "/projects/alpha/verifications", "operator")
    ).body;
    assert.deepEqual(verifications, { configured: false, items: [] });
    const releases = (
      await a.call("GET", "/projects/alpha/releases", "operator")
    ).body as Record<string, any>;
    assert.deepEqual(
      [releases.sourceControl.configured, releases.deployments.configured],
      [false, false],
    );
  } finally {
    await a.close();
  }
});

test("EO-4.7 103/48 LOG REDACTION: secrets in audit data never reach the timeline", async () => {
  const a = await api();
  try {
    const s = await a.newSession();
    a.ctx.audit.record("execution_event", {
      projectId: "alpha",
      data: {
        action: "operation_failed",
        execution: s.sessionId,
        detail: `leak ${FAKE_SECRET}`,
        apiToken: "abc",
      },
    });
    const detail = await a.call(
      "GET",
      `/projects/alpha/executions/${s.sessionId}`,
      "operator",
    );
    const text = JSON.stringify(detail.body);
    assert.ok(!text.includes(FAKE_SECRET));
    assert.ok(!text.includes('"abc"'));
    const timeline = (detail.body as Record<string, any>).timeline;
    assert.equal(timeline.total, timeline.items.length);
    const bounded = await a.call(
      "GET",
      `/projects/alpha/executions/${s.sessionId}?timelineLimit=1`,
      "operator",
    );
    assert.equal(
      ((bounded.body as Record<string, any>).timeline.items as unknown[])
        .length,
      1,
    );
  } finally {
    await a.close();
  }
});

test("EO-4.7 113 NO RAW EXECUTION: there is no execute/shell/deploy endpoint", async () => {
  const a = await api();
  try {
    for (const [method, path] of [
      ["POST", "/execution/execute"],
      ["POST", "/execution/run"],
      ["POST", "/commands/execute"],
      ["POST", "/commands/shell"],
      ["POST", "/commands/deploy"],
      ["POST", "/projects/alpha/executions"],
    ] as const) {
      const res = await a.call(method, path, "admin", { command: "rm -rf /" });
      assert.ok(
        [400, 404, 405].includes(res.status),
        `${method} ${path} → ${res.status}`,
      );
    }
  } finally {
    await a.close();
  }
});
