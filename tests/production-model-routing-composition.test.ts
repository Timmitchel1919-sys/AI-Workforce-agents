/**
 * EO-7 — Model Routing & Intelligent Execution Selection, in the PRODUCTION
 * composition root.
 *
 * Production has exactly one real provider (OpenAI, behind the
 * control-plane-analysis agent) and no configured API key in this test
 * environment — CONNECTED != CAPABLE, and AVAILABLE (a provider factory is
 * registered) != CONFIGURED (it can actually reach OpenAI). The Model
 * Router correctly says the candidate is AVAILABLE and SELECTED; the actual
 * provider call then fails closed for its own, separate reason (no
 * `OPENAI_API_KEY`) — this test proves the two facts are distinct and both
 * honestly reported, and that a routing decision is persisted regardless of
 * whether the eventual call succeeds.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createProductionControlPlaneRuntime } from "../api/index.js";
import { CONTROL_PLANE_ANALYSIS_AGENT_ID } from "../agents/control-plane-analysis/index.js";
import type { FirebaseAuthLike, FirebaseServices } from "../adapters/index.js";
import { AgentExecutionError, type Task } from "../contracts/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

class FakeAuth implements FirebaseAuthLike {
  async verifyIdToken(token: string) {
    if (["admin", "mm", "aiw"].includes(token)) return { uid: `${token}-1` };
    throw new Error("invalid token");
  }
}

function seeded(): FakeFirestore {
  const firestore = new FakeFirestore();
  const operators = firestore.collection("operators");
  const T = "2026-09-27T00:00:00.000Z";
  const base = {
    emailVerified: true,
    requestedAt: T,
    updatedAt: T,
    revision: 1,
    status: "active",
  };
  operators.values.set("admin-1", {
    ...base,
    id: "admin-1",
    role: "admin",
    allowedProjects: "*",
  });
  operators.values.set("mm-1", {
    ...base,
    id: "mm-1",
    role: "operator",
    allowedProjects: ["money-mind"],
  });
  operators.values.set("aiw-1", {
    ...base,
    id: "aiw-1",
    role: "operator",
    allowedProjects: ["ai-workforce"],
  });
  return firestore;
}

interface Body {
  configured?: boolean;
  decisions?: { routingDecisionId: string; selectedProvider?: string }[];
  decision?: { routingDecisionId: string; projectId: string };
}
type Runtime = Awaited<ReturnType<typeof createProductionControlPlaneRuntime>>;
async function withServer<T>(
  runtime: Runtime,
  fn: (
    get: (
      path: string,
      token?: string,
    ) => Promise<{ status: number; json: Body }>,
  ) => Promise<T>,
): Promise<T> {
  const server = http.createServer(runtime.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(async (path, token) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      const text = await res.text();
      let json: Body;
      try {
        json = JSON.parse(text) as Body;
      } catch {
        json = text as unknown as Body;
      }
      return { status: res.status, json };
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
const services = (): FirebaseServices => ({
  firestore: seeded(),
  auth: new FakeAuth(),
  storage: {} as FirebaseServices["storage"],
  config: {
    projectId: "ai-workforce-agents",
    storageBucket: "ai-workforce-agents.appspot.com",
    emulated: true,
  },
});

function task(): Task {
  return {
    id: "task_routing_composition_test",
    type: "control-plane-analysis",
    description: "Assess runtime readiness.",
    projectId: "money-mind",
    priority: "normal",
    status: "running",
    input: { objective: "Assess runtime readiness." },
    errors: [],
    requiredPermissions: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("EO-7: the control-plane-analysis agent's executor is upgraded to the ROUTED, governed one — routing runs even though the eventual call fails closed for its own separate reason (no OPENAI_API_KEY here)", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  try {
    const rt = await createProductionControlPlaneRuntime({
      services: services(),
    });
    const agent = rt.context.agents.get(CONTROL_PLANE_ANALYSIS_AGENT_ID)!;
    assert.ok(agent, "the agent is registered");
    assert.ok(rt.bootstrap.agentExecutors.has(CONTROL_PLANE_ANALYSIS_AGENT_ID));

    // ProviderConfigError (no OPENAI_API_KEY) is a ValidationError subtype, so the executor's
    // existing error mapping reports it as "invalid_result" — pre-existing behavior, unrelated to
    // routing; the point here is that it fails closed for a DIFFERENT reason than routing itself.
    await assert.rejects(
      () => rt.bootstrap.agentExecutors.execute(agent, task()),
      (error: unknown) =>
        error instanceof AgentExecutionError &&
        error.reason === "invalid_result",
    );

    // Routing itself succeeded (a real candidate was selected) — only the ACTUAL call failed,
    // and for a DIFFERENT, later reason. The decision is persisted regardless.
    const history = await rt.routing.router.listByProject("money-mind");
    assert.equal(history.length, 1);
    assert.equal(history[0]!.selectedProvider, "openai");
    assert.deepEqual(history[0]!.rejectedCandidates, []);

    // No usage was recorded — the provider never actually returned a response to bill.
    const cost = await rt.context.costCenter!.usage.listByProject(
      { id: "admin-1", role: "admin", allowedProjects: "*" },
      "money-mind",
    );
    assert.deepEqual(cost, []);
    await rt.flush();
  } finally {
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    if (originalModel !== undefined) process.env.OPENAI_MODEL = originalModel;
  }
});

test("EO-7: costCenterCapabilities.enforcement is honestly true (a real provider is registered) even though nothing has actually been billed yet", async () => {
  const rt = await createProductionControlPlaneRuntime({
    services: services(),
  });
  assert.equal(rt.context.costCenterCapabilities?.enforcement, true);
  assert.deepEqual(rt.context.costCenterCapabilities?.providerIds, ["openai"]);
  await rt.flush();
});

test("EO-7 HTTP: routing-decision history and PROJECT ISOLATION — an operator scoped to a different project cannot read money-mind's routing decisions, even a real, valid decision id", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const rt = await createProductionControlPlaneRuntime({
      services: services(),
    });
    const agent = rt.context.agents.get(CONTROL_PLANE_ANALYSIS_AGENT_ID)!;
    await assert.rejects(() =>
      rt.bootstrap.agentExecutors.execute(agent, task()),
    );
    const [decision] = await rt.routing.router.listByProject("money-mind");

    await withServer(rt, async (get) => {
      const unauth = await get("/api/projects/money-mind/routing-decisions");
      assert.equal(unauth.status, 401);

      const own = await get("/api/projects/money-mind/routing-decisions", "mm");
      assert.equal(own.status, 200);
      assert.equal(own.json.configured, true);
      assert.equal(own.json.decisions?.length, 1);

      const ownOne = await get(
        `/api/projects/money-mind/routing-decisions/${decision!.routingDecisionId}`,
        "mm",
      );
      assert.equal(ownOne.status, 200);
      assert.equal(
        ownOne.json.decision?.routingDecisionId,
        decision!.routingDecisionId,
      );

      // A different operator, scoped to a DIFFERENT project, cannot read money-mind's history at all.
      const foreign = await get(
        "/api/projects/money-mind/routing-decisions",
        "aiw",
      );
      assert.equal(foreign.status, 404);

      // Nor fetch the SAME, real, valid decision id directly — the route itself denies the project first.
      const foreignOne = await get(
        `/api/projects/money-mind/routing-decisions/${decision!.routingDecisionId}`,
        "aiw",
      );
      assert.equal(foreignOne.status, 404);
    });
    await rt.flush();
  } finally {
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
  }
});
