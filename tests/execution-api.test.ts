/**
 * EO-4.1 — execution control boundary over the Control Plane HTTP API.
 *
 * Only preparatory surfaces exist: pre-flight, session metadata, and
 * cancel/kill commands. There is no execute / shell / terminal endpoint.
 * Denials are 200 DENIED (data) or 403/404 — never 500.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createControlPlaneApi } from "../api/index.js";
import {
  FirebaseOperatorDirectory,
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

async function api(options: { sandbox?: boolean } = {}) {
  const h = await harness(options);
  // A Firebase-authenticated user whose operator account is still PENDING.
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
      body: (text ? JSON.parse(text) : null) as Record<string, unknown>,
    };
  };
  return {
    ...h,
    call,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

test("api: authentication, pending access and authorization gate pre-flight", async () => {
  const a = await api();
  try {
    assert.equal(
      (await a.call("POST", "/execution/preflight", undefined, a.request()))
        .status,
      401,
    );
    assert.equal(
      (
        await a.call(
          "POST",
          "/execution/preflight",
          "tok-nobody-invalid-x",
          a.request(),
        )
      ).status,
      401,
    );
    // Firebase-authenticated but PENDING → no principal → denied.
    assert.equal(
      (
        await a.call(
          "POST",
          "/execution/preflight",
          "tok-pending-uid",
          a.request(),
        )
      ).status,
      401,
    );
    // Authenticated + active, but not authorized to prepare execution.
    assert.equal(
      (await a.call("POST", "/execution/preflight", "viewer", a.request()))
        .status,
      403,
    );
    const ok = await a.call(
      "POST",
      "/execution/preflight",
      "operator",
      a.request(),
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.body.decision, "ELIGIBLE");
    assert.equal(ok.body.executionAvailable, false);
  } finally {
    await a.close();
  }
});

test("api: denials are data (200 DENIED), malformed requests 400, never 500", async () => {
  const a = await api({ sandbox: false });
  try {
    const denied = await a.call(
      "POST",
      "/execution/preflight",
      "operator",
      a.request(),
    );
    assert.equal(denied.status, 200);
    assert.equal(denied.body.decision, "DENIED");
    assert.deepEqual(
      (denied.body.reasons as { code: string }[]).map((r) => r.code),
      ["SANDBOX_UNAVAILABLE"],
    );
    const raw = await a.call("POST", "/execution/preflight", "operator", {
      ...a.request(),
      command: "npm run build",
    });
    assert.equal(raw.status, 400);
    const bad = await a.call("POST", "/execution/preflight", "operator", {
      projectId: "alpha",
    });
    assert.equal(bad.status, 400);
  } finally {
    await a.close();
  }
});

test("api: no general execution surface exists", async () => {
  const a = await api();
  try {
    for (const path of [
      "/execute-command",
      "/shell",
      "/terminal",
      "/powershell",
      "/bash",
      "/execution/run",
      "/execution/execute",
    ]) {
      const res = await a.call("POST", path, "admin", { command: "whoami" });
      assert.equal(res.status, 404, path);
    }
    for (const name of ["execute", "run-shell", "execute-command", "shell"]) {
      assert.equal(
        (
          await a.call("POST", `/commands/${name}`, "admin", {
            command: "whoami",
          })
        ).status,
        404,
        name,
      );
    }
    const ops = await a.call("GET", "/execution/operations", "viewer");
    assert.equal(ops.status, 200);
    assert.ok(JSON.stringify(ops.body).indexOf("command") === -1);
  } finally {
    await a.close();
  }
});

test("api: project isolation — no IDOR on project, plan, session or workspace", async () => {
  const a = await api();
  try {
    const { session } = await a.manager.createSession(
      OPERATOR,
      a.request(),
      "api-key-1",
    );
    // Plan of alpha addressed under beta, or by a beta operator → 404.
    assert.equal(
      (await a.call("POST", "/execution/preflight", "beta", a.request()))
        .status,
      404,
    );
    assert.equal(
      (
        await a.call(
          "POST",
          "/execution/preflight",
          "admin",
          a.request({ projectId: "beta" }),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await a.call(
          "POST",
          "/execution/preflight",
          "admin",
          a.request({ planId: "plan_999" }),
        )
      ).status,
      404,
    );
    // Sessions: readable in scope, invisible (404) out of scope, no enumeration.
    const own = await a.call(
      "GET",
      `/execution/sessions/${session.sessionId}`,
      "operator",
    );
    assert.equal(own.status, 200);
    assert.equal(
      (own.body.workspace as { projectId: string }).projectId,
      "alpha",
    );
    assert.equal(
      (await a.call("GET", `/execution/sessions/${session.sessionId}`, "beta"))
        .status,
      404,
    );
    assert.equal(
      (await a.call("GET", "/execution/sessions/exs_does_not_exist", "admin"))
        .status,
      404,
    );
    assert.equal(
      (await a.call("GET", "/projects/alpha/execution-sessions", "beta"))
        .status,
      404,
    );
    const list = await a.call(
      "GET",
      "/projects/alpha/execution-sessions",
      "operator",
    );
    assert.equal((list.body as unknown as unknown[]).length, 1);
    assert.deepEqual(
      await a
        .call("GET", "/projects/beta/execution-sessions", "beta")
        .then((r) => r.body),
      [],
    );
    // Cancel/kill across projects → 404, not a state change.
    const cross = await a.call("POST", "/commands/cancel-execution", "beta", {
      sessionId: session.sessionId,
      reason: "x",
    });
    assert.equal(cross.status, 404);
  } finally {
    await a.close();
  }
});

test("api: cancel is idempotent and audited; kill is administrators only", async () => {
  const a = await api();
  try {
    const { session } = await a.manager.createSession(
      OPERATOR,
      a.request(),
      "api-key-2",
    );
    const first = await a.call(
      "POST",
      "/commands/cancel-execution",
      "operator",
      { sessionId: session.sessionId, reason: "not needed" },
    );
    assert.equal(first.status, 200);
    assert.deepEqual(
      [first.body.command, first.body.outcome],
      ["cancel_execution", "executed"],
    );
    assert.equal(
      (first.body.details as { outcome: string }).outcome,
      "cancelled",
    );
    const again = await a.call(
      "POST",
      "/commands/cancel-execution",
      "operator",
      { sessionId: session.sessionId, reason: "again" },
    );
    assert.equal(
      (again.body.details as { outcome: string }).outcome,
      "already_cancelled",
    );
    assert.equal(
      (
        await a.call("POST", "/commands/kill-execution", "operator", {
          sessionId: session.sessionId,
          reason: "x",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await a.call("POST", "/commands/cancel-execution", "viewer", {
          sessionId: session.sessionId,
          reason: "x",
        })
      ).status,
      403,
    );
    const kill = await a.call("POST", "/commands/kill-execution", "admin", {
      sessionId: session.sessionId,
      reason: "emergency",
    });
    assert.equal(kill.status, 200);
    assert.equal(
      (
        await a.call("POST", "/commands/cancel-execution", "operator", {
          sessionId: session.sessionId,
        })
      ).status,
      400,
    );
    const audit = a.fixture.audit
      .query({ type: "control_command" })
      .map((e) => e.data.command);
    assert.ok(
      audit.includes("cancel_execution") && audit.includes("kill_execution"),
    );
  } finally {
    await a.close();
  }
});
