/**
 * EO-6.2 — the AI Cost Center & rule-based Auditor in the PRODUCTION composition root.
 *
 * Production registers no model provider at all: the ledger, budget gate and rule auditor are
 * genuinely composed (not stubbed), but ENFORCEMENT is honestly INERT until one registers.
 * CONNECTED != CAPABLE. RECORDED != ENFORCED. RULE-BASED != MODEL-ASSISTED.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createProductionControlPlaneRuntime } from "../api/index.js";
import type { FirebaseAuthLike, FirebaseServices } from "../adapters/index.js";
import { inertCostCenterCapabilities, type ModelProvider, type ModelRequest, type ModelResponse } from "../contracts/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

class FakeAuth implements FirebaseAuthLike {
  async verifyIdToken(token: string) {
    if (["admin", "mm", "aiw"].includes(token)) return { uid: `${token}-1` };
    throw new Error("invalid token");
  }
}

class FakeProvider implements ModelProvider {
  readonly id = "fake";
  async generate(_request: ModelRequest): Promise<ModelResponse> {
    return { content: "ok", model: "claude-sonnet-5", usage: { inputTokens: 1, outputTokens: 1 } };
  }
}

interface Body {
  configured?: boolean;
  budgetPolicy?: unknown;
  evaluation?: { status?: string };
  usage?: unknown[];
  capabilities?: { enforcement?: boolean; providerIds?: string[] };
  findings?: unknown[];
  rulesRun?: string[];
  error?: { message: string };
}

function seeded(): FakeFirestore {
  const firestore = new FakeFirestore();
  const operators = firestore.collection("operators");
  const T = "2026-09-27T00:00:00.000Z";
  const base = { emailVerified: true, requestedAt: T, updatedAt: T, revision: 1, status: "active" };
  operators.values.set("admin-1", { ...base, id: "admin-1", role: "admin", allowedProjects: "*" });
  operators.values.set("mm-1", { ...base, id: "mm-1", role: "operator", allowedProjects: ["money-mind"] });
  operators.values.set("aiw-1", { ...base, id: "aiw-1", role: "operator", allowedProjects: ["ai-workforce"] });
  return firestore;
}
const services = (): FirebaseServices => ({
  firestore: seeded(),
  auth: new FakeAuth(),
  storage: {} as FirebaseServices["storage"],
  config: { projectId: "ai-workforce-agents", storageBucket: "ai-workforce-agents.appspot.com", emulated: true },
});

type Runtime = Awaited<ReturnType<typeof createProductionControlPlaneRuntime>>;
async function withServer<T>(runtime: Runtime, fn: (get: (path: string, token?: string) => Promise<{ status: number; json: Body; headers: Headers }>) => Promise<T>): Promise<T> {
  const server = http.createServer(runtime.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(async (path, token) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      const text = await res.text();
      let json: Body;
      try { json = JSON.parse(text) as Body; } catch { json = text as unknown as Body; }
      return { status: res.status, json, headers: res.headers };
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("the production runtime composes the Cost Center for real (ledger, budget gate, rule auditor) even with zero providers", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  assert.ok(rt.context.costCenter, "the Cost Center is composed, not absent");
  assert.ok(rt.context.auditor, "the rule auditor is composed");
  const caps = rt.context.costCenterCapabilities!;
  assert.equal(caps.enforcement, false, "no provider is registered in production => enforcement is honestly inert");
  assert.deepEqual(caps.providerIds, []);
  assert.deepEqual(inertCostCenterCapabilities(caps), ["enforcement"]);
  await rt.flush();
});

test("registering a provider flips the SAME capabilities object live — derived, never a snapshot", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  const caps = rt.context.costCenterCapabilities!;
  assert.equal(caps.enforcement, false);
  rt.costCenter.modelProviders.register("fake", () => new FakeProvider());
  assert.equal(caps.enforcement, true, "the composed registry is the SAME instance the capabilities read from");
  assert.deepEqual(caps.providerIds, ["fake"]);
  await rt.flush();
});

test("GET cost report: RECORDED != ENFORCED — no budget policy is NOT_CONFIGURED, and enforcement is honestly inert", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (get) => {
    const res = await get("/api/projects/ai-workforce/cost", "admin");
    assert.equal(res.status, 200);
    assert.equal(res.json.configured, true, "the Cost Center itself is composed");
    assert.equal(res.json.budgetPolicy, null, "no policy has been set for this project");
    assert.equal(res.json.evaluation?.status, "not_configured");
    assert.deepEqual(res.json.usage, []);
    assert.equal(res.json.capabilities?.enforcement, false);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });
});

test("GET audit findings: rule-based, recomputed fresh, and honestly empty when nothing is wired yet", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (get) => {
    const res = await get("/api/projects/ai-workforce/audit-findings", "admin");
    assert.equal(res.status, 200);
    assert.equal(res.json.configured, true);
    assert.deepEqual(res.json.findings, []);
    assert.deepEqual(res.json.rulesRun?.slice().sort(), [
      "high_risk_session_unapproved",
      "release_without_approval",
      "release_without_verification",
      "usage_unpriced",
    ]);
  });
});

test("PROJECT ISOLATION: an operator scoped to a different project cannot read another project's cost or audit findings", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (get) => {
    const cost = await get("/api/projects/ai-workforce/cost", "mm");
    assert.equal(cost.status, 404);
    const findings = await get("/api/projects/ai-workforce/audit-findings", "mm");
    assert.equal(findings.status, 404);
    // The project's own operator can.
    const own = await get("/api/projects/ai-workforce/cost", "aiw");
    assert.equal(own.status, 200);
  });
});

test("AUTHENTICATION: an unauthenticated request to either endpoint is denied, never defaulted to an empty 200", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (get) => {
    assert.equal((await get("/api/projects/ai-workforce/cost")).status, 401);
    assert.equal((await get("/api/projects/ai-workforce/audit-findings")).status, 401);
  });
});
