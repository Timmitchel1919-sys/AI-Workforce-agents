/**
 * EO-6.1 — project onboarding coexists with the release pipeline.
 *   PROJECT READY != AUTOMATIC EXECUTION.  PROJECT REGISTRATION != EXECUTION.
 * A project created through onboarding is discoverable and readable through the same project-scoped
 * surfaces as any other project, but provisioning grants it no ability to run, commit or deploy.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createProductionControlPlaneRuntime } from "../api/index.js";
import type { FirebaseAuthLike, FirebaseServices } from "../adapters/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

class FakeAuth implements FirebaseAuthLike {
  async verifyIdToken(token: string) {
    if (["admin", "newp", "mm"].includes(token)) return { uid: `${token}-1` };
    throw new Error("invalid token");
  }
}
const T = "2026-09-26T00:00:00.000Z";
interface Body {
  metadata?: Record<string, string>;
  nodes: { type: string }[];
  revision?: number;
  unchanged?: boolean;
  configured?: boolean;
  items?: unknown[];
  sourceControl?: { configured: boolean };
  deployments?: { configured: boolean };
  inertCapabilities?: string[];
  notConfiguredSources?: unknown;
  unavailableSources?: unknown;
  correlationId?: string;
}

function seeded(): FakeFirestore {
  const f = new FakeFirestore();
  const ops = f.collection("operators");
  const base = { emailVerified: true, requestedAt: T, updatedAt: T, revision: 1, status: "active" };
  ops.values.set("admin-1", { ...base, id: "admin-1", role: "admin", allowedProjects: "*" });
  ops.values.set("newp-1", { ...base, id: "newp-1", role: "operator", allowedProjects: ["new-proj"] });
  ops.values.set("mm-1", { ...base, id: "mm-1", role: "operator", allowedProjects: ["money-mind"] });
  // A project that finished onboarding: READY, discoverable, and nothing more.
  f.collection("provisioned_projects").values.set("new-proj", {
    id: "new-proj",
    code: "NEWP",
    displayName: "New Project",
    onboardingId: "onb-1",
    createdBy: "admin-1",
    createdAt: T,
    readiness: "ready",
    plan: { steps: [] },
    baseline: {},
    blocking: [],
    revision: 1,
  });
  return f;
}
const services = (): FirebaseServices => ({
  firestore: seeded(),
  auth: new FakeAuth(),
  storage: {} as FirebaseServices["storage"],
  config: { projectId: "ai-workforce-agents", storageBucket: "b", emulated: true },
});
type Runtime = Awaited<ReturnType<typeof createProductionControlPlaneRuntime>>;
async function withServer<T>(rt: Runtime, fn: (get: (p: string, t?: string) => Promise<{ status: number; json: Body }>) => Promise<T>): Promise<T> {
  const server = http.createServer(rt.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(async (path, token) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      const text = await res.text();
      return { status: res.status, json: (() => { try { return JSON.parse(text) as Body; } catch { return text as unknown as Body; } })() };
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("a READY provisioned project is registered and readable, next to the built-in projects", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  for (const id of ["ai-workforce", "money-mind", "new-proj"]) assert.ok(rt.context.projects.has(id), id);
  await withServer(rt, async (get) => {
    const list = await get("/api/projects", "admin");
    assert.equal(list.status, 200);
    const ids = ((Array.isArray(list.json) ? list.json : (list.json.items ?? [])) as { projectId?: string; id?: string }[]).map((p) => p.projectId ?? p.id);
    assert.ok(ids.includes("new-proj"), `listed: ${ids.join(",")}`);
  });
});

test("PROJECT REGISTRATION != EXECUTION: the provisioned adapter can only READ the project, never run anything", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  const adapter = rt.context.projects.get("new-proj")!.adapter;
  const described = await adapter.describe();
  assert.deepEqual(described.capabilities.map((c: { operation: string }) => c.operation), ["READ_PROJECT"]);
  for (const op of ["RUN_SHELL", "COMMIT", "DEPLOY", "EXECUTE", "constructor", "__proto__"]) {
    await assert.rejects(() => adapter.execute(op, {} as never), (e: unknown) => e instanceof Error, `${op} must not be executable`);
  }
});

test("PROJECT READY != AUTOMATIC EXECUTION: provisioning grants no capability, no policy and no ability to start execution", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  // 1. Provisioning added no sandbox / Git / deployment capability (derived at read time).
  const caps = rt.context.releaseCapabilities!;
  assert.deepEqual({ v: caps.verification, s: caps.sourceControl, d: caps.deploymentAdapters }, { v: false, s: false, d: [] });
  // 2. The onboarding and provisioning code never touches execution policy, sandboxes, the execution
  //    manager or the release services — a READY project is a RECORD, not a grant. (Adding any such
  //    coupling to onboarding fails this test.)
  const { readFileSync, readdirSync } = await import("node:fs");
  const root = new URL("../../", import.meta.url);
  const files = [
    ...readdirSync(new URL("core/onboarding/", root)).filter((f) => f.endsWith(".ts")).map((f) => `core/onboarding/${f}`),
    "adapters/projects/provisioned/provisioned-project-adapter.ts",
    "control/services/onboarding-control-service.ts",
  ];
  for (const f of files) {
    const src = readFileSync(new URL(f, root), "utf8");
    for (const banned of ["bindProject", "ExecutionPolicy", "SandboxRegistry", "ExecutionManager", "createSession", "SourceControlOrchestrator", "DeploymentOrchestrator", "VerificationService", "registerAdapter", "registerTarget"]) {
      assert.ok(!src.includes(banned), `${f} must not reference ${banned}`);
    }
  }
  // 3. Asking to execute for the new project is refused (a denial or "not found" — never an eligible decision).
  const principal = { id: "admin-1", role: "admin" as const, allowedProjects: "*" as const };
  let outcome: unknown;
  try {
    outcome = await rt.context.execution!.preflight(principal, { projectId: "new-proj", planId: "none", planVersion: 1, stageId: "build", operationId: "any.operation", input: {} } as never);
  } catch (error) {
    outcome = error;
  }
  const refused = outcome instanceof Error || (typeof outcome === "object" && outcome !== null && (outcome as { decision?: string }).decision !== "ELIGIBLE");
  assert.ok(refused, `a READY project must not be executable: ${JSON.stringify(outcome)?.slice(0, 120)}`);
});

test("the new project's release surfaces use the SAME honest, project-scoped semantics", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (get) => {
    const own = await get("/api/projects/new-proj/graph?mode=EXECUTION", "newp");
    assert.equal(own.status, 200);
    assert.equal(own.json.metadata?.inertCapabilities, "verification,sourceControl,deployment");
    assert.equal((await get("/api/projects/new-proj/verifications", "newp")).json.configured, false);
    assert.equal((await get("/api/projects/new-proj/releases", "newp")).json.deployments?.configured, false);
    // Isolation both ways.
    for (const tail of ["graph?mode=EXECUTION", "insights", "verifications", "releases"]) {
      const foreign = await get(`/api/projects/new-proj/${tail}`, "mm");
      assert.ok(foreign.status === 404 || foreign.status === 403, `mm -> new-proj/${tail}: ${foreign.status}`);
      const back = await get(`/api/projects/money-mind/${tail}`, "newp");
      assert.ok(back.status === 404 || back.status === 403, `newp -> money-mind/${tail}: ${back.status}`);
    }
  });
});

test("a BLOCKED project is not registered, so it cannot appear in any release surface", async () => {
  const s = services();
  (s.firestore as FakeFirestore).collection("provisioned_projects").values.set("blocked-proj", {
    id: "blocked-proj", code: "BLK", displayName: "Blocked", onboardingId: "onb-2", createdBy: "admin-1", createdAt: T,
    readiness: "blocked", plan: { steps: [] }, baseline: {}, blocking: ["validation failed"], revision: 1,
  });
  const rt = await createProductionControlPlaneRuntime({ services: s });
  assert.equal(rt.context.projects.has("blocked-proj"), false);
  await withServer(rt, async (get) => {
    assert.equal((await get("/api/projects/blocked-proj/graph", "admin")).status, 404);
    assert.equal((await get("/api/projects/blocked-proj/verifications", "admin")).status, 404);
  });
});
