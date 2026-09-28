/**
 * Control Plane HTTP API. Driven through a real `http.Server` on an ephemeral
 * port with fake query / command services and a fake `OperatorDirectory`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { createControlPlaneApi, type ApiHandler } from "../api/index.js";
import {
  PermissionDeniedError,
  type OperatorDirectory,
  type OperatorPrincipal,
} from "../contracts/index.js";
import {
  type WorkforceCommandService,
  type WorkforceQueryService,
} from "../control/index.js";

const PRINCIPAL: OperatorPrincipal = {
  id: "op-1",
  role: "operator",
  allowedProjects: "*",
};

const directory: OperatorDirectory = {
  async resolve(credential) {
    return credential === "good" ? PRINCIPAL : null;
  },
};

interface Recorder {
  taskQuery?: unknown;
  workflowQuery?: unknown;
  auditQuery?: unknown;
  projectAgentsCall?: { projectId: string };
  commandCalls: Array<{
    method: string;
    input: unknown;
    correlationId: string;
  }>;
  throwOnStatus: boolean;
}

function fakes(rec: Recorder) {
  const query = {
    getWorkforceStatus: () => {
      if (rec.throwOnStatus) throw new PermissionDeniedError("nope");
      return { counts: {}, status: "unknown" };
    },
    getSystemHealth: () => ({ status: "unknown", components: [] }),
    getDashboardSnapshot: async () => ({ generatedAt: "t" }),
    getAgents: () => [{ agentId: "a1" }],
    getAgent: (_p: unknown, id: string) =>
      id === "a1" ? { agentId: "a1" } : undefined,
    getTasks: (_p: unknown, q: unknown) => {
      rec.taskQuery = q;
      return { items: [], total: 0, nextCursor: null };
    },
    getTask: () => undefined,
    getWorkflows: (_p: unknown, q: unknown) => {
      rec.workflowQuery = q;
      return { items: [], total: 0, nextCursor: null };
    },
    getWorkflow: () => undefined,
    getApprovals: () => [],
    getProjects: async () => [],
    getProject: async () => undefined,
    getProjectAgents: async (_p: unknown, projectId: string) => {
      rec.projectAgentsCall = { projectId };
      if (projectId === "ghost") return undefined;
      return projectId === "p1" ? [{ agentId: "a1" }] : [];
    },
    getTools: () => [],
    getTool: () => undefined,
    getAuditEvents: (_p: unknown, q: unknown) => {
      rec.auditQuery = q;
      return { items: [], total: 0, nextCursor: null };
    },
  } as unknown as WorkforceQueryService;

  const command = {
    approve: async (
      _p: unknown,
      input: unknown,
      opts: { correlationId: string },
    ) => {
      rec.commandCalls.push({
        method: "approve",
        input,
        correlationId: opts.correlationId,
      });
      return {
        command: "approve",
        outcome: "executed",
        ok: true,
        reason: "ok",
        correlationId: opts.correlationId,
        details: {},
        auditEventId: "e1",
        timestamp: "t",
      };
    },
    cancelTask: async (
      _p: unknown,
      input: unknown,
      opts: { correlationId: string },
    ) => {
      rec.commandCalls.push({
        method: "cancelTask",
        input,
        correlationId: opts.correlationId,
      });
      return {
        command: "cancel_task",
        outcome: "denied",
        ok: false,
        errorKind: "forbidden",
        reason: "no",
        correlationId: opts.correlationId,
        details: {},
        auditEventId: "e2",
        timestamp: "t",
      };
    },
  } as unknown as WorkforceCommandService;

  return { query, command };
}

async function withServer<T>(
  handler: ApiHandler,
  fn: (base: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function makeApi(rec: Partial<Recorder> = {}): ApiHandler {
  const recorder: Recorder = {
    commandCalls: [],
    throwOnStatus: false,
    ...rec,
  };
  const { query, command } = fakes(recorder);
  const handler = createControlPlaneApi({
    query,
    command,
    operatorDirectory: directory,
  });
  (handler as unknown as { _rec: Recorder })._rec = recorder;
  return handler;
}
function rec(handler: ApiHandler): Recorder {
  return (handler as unknown as { _rec: Recorder })._rec;
}

test("api: /api/health needs no auth", async () => {
  await withServer(makeApi(), async (base) => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });
});

test("api: unauthenticated and bad-token requests are 401", async () => {
  await withServer(makeApi(), async (base) => {
    const noAuth = await fetch(`${base}/api/status`);
    assert.equal(noAuth.status, 401);
    const badAuth = await fetch(`${base}/api/status`, {
      headers: { authorization: "Bearer nope" },
    });
    assert.equal(badAuth.status, 401);
  });
});

test("api: an authenticated GET returns data and echoes the correlation id", async () => {
  await withServer(makeApi(), async (base) => {
    const res = await fetch(`${base}/api/agents`, {
      headers: { authorization: "Bearer good", "x-correlation-id": "trace-9" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{ agentId: "a1" }]);
    assert.equal(res.headers.get("x-correlation-id"), "trace-9");
  });
});

test("api: unknown resource id is 404", async () => {
  await withServer(makeApi(), async (base) => {
    const res = await fetch(`${base}/api/agents/ghost`, {
      headers: { authorization: "Bearer good" },
    });
    assert.equal(res.status, 404);
  });
});

test("api: GET /projects/:projectId/agents returns the resolved Agents", async () => {
  const api = makeApi();
  await withServer(api, async (base) => {
    const res = await fetch(`${base}/api/projects/p1/agents`, {
      headers: { authorization: "Bearer good" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{ agentId: "a1" }]);
  });
  assert.deepEqual(rec(api).projectAgentsCall, { projectId: "p1" });
});

test("api: GET /projects/:projectId/agents is 404 for an unknown/inaccessible project", async () => {
  await withServer(makeApi(), async (base) => {
    const res = await fetch(`${base}/api/projects/ghost/agents`, {
      headers: { authorization: "Bearer good" },
    });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), {
      error: { message: "resource not found" },
    });
  });
});

test("api: GET /projects/:projectId/agents requires authentication", async () => {
  await withServer(makeApi(), async (base) => {
    const res = await fetch(`${base}/api/projects/p1/agents`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), {
      error: { message: "authentication required" },
    });
  });
});

test("api: GET /projects/:projectId/<other> and deep project paths are 404", async () => {
  await withServer(makeApi(), async (base) => {
    const other = await fetch(`${base}/api/projects/p1/tasks`, {
      headers: { authorization: "Bearer good" },
    });
    assert.equal(other.status, 404);
    const deep = await fetch(`${base}/api/projects/p1/agents/more`, {
      headers: { authorization: "Bearer good" },
    });
    assert.equal(deep.status, 404);
  });
});

test("api: workflow query-string filters reach the query service", async () => {
  const api = makeApi();
  await withServer(api, async (base) => {
    await fetch(`${base}/api/workflows?projectId=parent&limit=10&cursor=5`, {
      headers: { authorization: "Bearer good" },
    });
  });
  assert.deepEqual(rec(api).workflowQuery, {
    projectId: "parent",
    limit: 10,
    cursor: "5",
  });
});

test("api: invalid workflow limit is dropped; oversized limit passes to the service to be clamped", async () => {
  const api = makeApi();
  await withServer(api, async (base) => {
    await fetch(`${base}/api/workflows?projectId=parent&limit=banana`, {
      headers: { authorization: "Bearer good" },
    });
    await fetch(`${base}/api/workflows?projectId=parent&limit=1000000`, {
      headers: { authorization: "Bearer good" },
    });
  });
  assert.deepEqual(rec(api).workflowQuery, {
    projectId: "parent",
    limit: 1000000,
  });
});

test("api: query-string filters reach the query service", async () => {
  const api = makeApi();
  await withServer(api, async (base) => {
    await fetch(`${base}/api/tasks?status=failed&limit=5&failedOnly=true`, {
      headers: { authorization: "Bearer good" },
    });
  });
  assert.deepEqual(rec(api).taskQuery, {
    status: "failed",
    limit: 5,
    failedOnly: true,
  });
});

test("api: a thrown PermissionDeniedError becomes 403 with a message, no stack", async () => {
  await withServer(makeApi({ throwOnStatus: true }), async (base) => {
    const res = await fetch(`${base}/api/status`, {
      headers: { authorization: "Bearer good" },
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: { message: string } };
    assert.equal(body.error.message, "nope");
    assert.ok(!JSON.stringify(body).includes("at "));
  });
});

test("api: POST /api/commands/approve dispatches with principal + body + correlation id", async () => {
  const api = makeApi();
  await withServer(api, async (base) => {
    const res = await fetch(`${base}/api/commands/approve`, {
      method: "POST",
      headers: {
        authorization: "Bearer good",
        "content-type": "application/json",
        "x-correlation-id": "req-77",
      },
      body: JSON.stringify({ approvalId: "ap-1", note: "ok" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      outcome: string;
      correlationId: string;
    };
    assert.equal(body.outcome, "executed");
    assert.equal(body.correlationId, "req-77");
  });
  assert.deepEqual(rec(api).commandCalls, [
    {
      method: "approve",
      input: { approvalId: "ap-1", note: "ok" },
      correlationId: "req-77",
    },
  ]);
});

test("api: a command errorKind maps to the right status", async () => {
  await withServer(makeApi(), async (base) => {
    const res = await fetch(`${base}/api/commands/cancel-task`, {
      method: "POST",
      headers: {
        authorization: "Bearer good",
        "content-type": "application/json",
      },
      body: JSON.stringify({ taskId: "t-1" }),
    });
    assert.equal(res.status, 403);
    assert.equal(
      ((await res.json()) as { errorKind: string }).errorKind,
      "forbidden",
    );
  });
});

test("api: unknown command and malformed body", async () => {
  await withServer(makeApi(), async (base) => {
    const unknown = await fetch(`${base}/api/commands/nuke`, {
      method: "POST",
      headers: {
        authorization: "Bearer good",
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(unknown.status, 404);

    const bad = await fetch(`${base}/api/commands/approve`, {
      method: "POST",
      headers: {
        authorization: "Bearer good",
        "content-type": "application/json",
      },
      body: "{not json",
    });
    assert.equal(bad.status, 400);
  });
});

test("api: unknown route is 404", async () => {
  await withServer(makeApi(), async (base) => {
    const res = await fetch(`${base}/api/nope`, {
      headers: { authorization: "Bearer good" },
    });
    assert.equal(res.status, 404);
  });
});

/* ---- EO-5.6 conditional graph poll (?since=<revision>) ---- */

function graphApi(revision: number) {
  const projection = {
    projectId: "p1",
    mode: "EXECUTION",
    revision,
    generatedAt: "2026-01-01T00:00:00.000Z",
    nodes: [{ id: "n" }],
    edges: [],
    truncated: false,
    appliedLimits: { depth: 3, maxNodes: 250, maxEdges: 1500 },
  };
  const { query, command } = fakes({ commandCalls: [], throwOnStatus: false });
  return createControlPlaneApi({
    query,
    command,
    operatorDirectory: directory,
    graphQuery: {
      getWorkforceGraph: async () => projection,
    } as unknown as import("../control/index.js").GraphQueryService,
  });
}
const auth = { authorization: "Bearer good" };

test("api graph: since=<current revision> returns a content-free 'unchanged' reply", async () => {
  await withServer(graphApi(42), async (base) => {
    const res = await fetch(
      `${base}/api/projects/p1/graph?mode=EXECUTION&since=42`,
      { headers: auth },
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.unchanged, true);
    assert.equal(body.revision, 42);
    assert.equal(
      "nodes" in body,
      false,
      "no graph content on an unchanged reply",
    );
  });
});

test("api graph: a stale or absent since returns the full projection", async () => {
  await withServer(graphApi(42), async (base) => {
    for (const q of ["since=41", "since=", ""]) {
      const res = await fetch(
        `${base}/api/projects/p1/graph?mode=EXECUTION&${q}`,
        { headers: auth },
      );
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(res.status, 200);
      assert.equal(body.unchanged, undefined, q);
      assert.ok(Array.isArray(body.nodes), q);
    }
  });
});

test("api graph: a malformed since is a 400, never a silent full read", async () => {
  await withServer(graphApi(42), async (base) => {
    for (const q of [
      "since=abc",
      "since=-1",
      "since=1e3",
      "since=99999999999999",
    ]) {
      const res = await fetch(`${base}/api/projects/p1/graph?${q}`, {
        headers: auth,
      });
      assert.equal(res.status, 400, q);
    }
  });
});

test("api graph: since never bypasses authentication", async () => {
  await withServer(graphApi(42), async (base) => {
    const res = await fetch(`${base}/api/projects/p1/graph?since=42`);
    assert.equal(res.status, 401);
  });
});

test("api graph: responses are never stored by shared caches, and a bad since does no work", async () => {
  let projected = 0;
  const { query, command } = fakes({ commandCalls: [], throwOnStatus: false });
  const api = createControlPlaneApi({
    query,
    command,
    operatorDirectory: directory,
    graphQuery: {
      getWorkforceGraph: async () => {
        projected += 1;
        return {
          projectId: "p1",
          mode: "WORKFORCE",
          revision: 1,
          generatedAt: "t",
          nodes: [],
          edges: [],
        };
      },
    } as unknown as import("../control/index.js").GraphQueryService,
  });
  await withServer(api, async (base) => {
    const bad = await fetch(`${base}/api/projects/p1/graph?since=abc`, {
      headers: auth,
    });
    assert.equal(bad.status, 400);
    assert.equal(projected, 0, "validated before any projection work");
    const ok = await fetch(`${base}/api/projects/p1/graph`, { headers: auth });
    assert.equal(ok.headers.get("cache-control"), "no-store");
  });
});
