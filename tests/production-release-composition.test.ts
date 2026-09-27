/**
 * EO-6.1 — the release pipeline in the PRODUCTION composition root.
 *
 * Production has no workspace, no Git and no deployment adapter. The pipeline is therefore
 * composed but INERT: it reads durable records and refuses work. These tests pin that honesty:
 *   NOT CONNECTED != EMPTY, INERT != IDLE, and a missing capability is a DENIAL, never a success.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createProductionControlPlaneRuntime } from "../api/index.js";
import { GraphQueryService } from "../control/index.js";
import type { FirebaseAuthLike, FirebaseServices } from "../adapters/index.js";
import { ExecutionDeniedError, inertReleaseCapabilities, type OperatorPrincipal } from "../contracts/index.js";
import { UnavailableArtifactSource, UnavailableGovernedGit, UnavailableWorkspaceControl } from "../core/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

class FakeAuth implements FirebaseAuthLike {
  async verifyIdToken(token: string) {
    if (["admin", "mm", "aiw"].includes(token)) return { uid: `${token}-1` };
    throw new Error("invalid token");
  }
}

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
  const firestore = new FakeFirestore();
  const operators = firestore.collection("operators");
  const T = "2026-09-24T00:00:00.000Z";
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
const ADMIN: OperatorPrincipal = { id: "admin-1", role: "admin", allowedProjects: "*" };

test("the production runtime composes verification, source control and deployments against the shared stores", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  assert.ok(rt.context.verification, "verification is composed");
  assert.ok(rt.context.sourceControl, "source control is composed");
  assert.ok(rt.context.deployments, "deployments are composed");
  assert.ok(rt.context.execution, "execution is still composed");
  await rt.flush();
});

test("capabilities are DERIVED at read time from the composed ports and registries: production has none, and says so", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  const caps = rt.context.releaseCapabilities!;
  // Derived: getters over the composed stand-ins, not a literal object.
  const desc = Object.getOwnPropertyDescriptors(caps);
  assert.equal(typeof desc.verification?.get, "function", "verification is computed when read");
  assert.equal(typeof desc.sourceControl?.get, "function", "sourceControl is computed when read");
  assert.equal(typeof desc.deploymentAdapters?.get, "function", "deploymentAdapters is computed when read");
  assert.deepEqual({ v: caps.verification, s: caps.sourceControl, d: caps.deploymentAdapters }, { v: false, s: false, d: [] });
  assert.deepEqual(rt.release.deployments.adapterIds(), [], "no deployment adapter is registered");
  assert.deepEqual(inertReleaseCapabilities(caps), ["verification", "sourceControl", "deployment"]);
  // The helper reports exactly what is missing and nothing else.
  assert.deepEqual(inertReleaseCapabilities({ verification: true, sourceControl: false, deploymentAdapters: ["x"] }), ["sourceControl"]);
  assert.deepEqual(inertReleaseCapabilities({ verification: true, sourceControl: true, deploymentAdapters: ["x"] }), []);
});

test("NOT CONNECTED != EMPTY: composed-but-inert release sources still read 'not configured' in Operations", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (get) => {
    const v = await get("/api/projects/ai-workforce/verifications", "admin");
    assert.equal(v.status, 200);
    assert.equal(v.json.configured, false, "no verification capability => not configured, NOT '0 verifications'");
    assert.deepEqual(v.json.items, []);
    const r = await get("/api/projects/ai-workforce/releases", "admin");
    assert.equal(r.status, 200);
    assert.equal(r.json.sourceControl?.configured, false);
    assert.equal(r.json.deployments?.configured, false);
  });
});

test("the graph says CONNECTED-BUT-INERT (not 'not connected', and not an empty idle pipeline)", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (get) => {
    const g = await get("/api/projects/ai-workforce/graph?mode=EXECUTION", "admin");
    assert.equal(g.status, 200);
    assert.equal(g.json.metadata?.notConfiguredSources, undefined, "the record sources ARE connected now");
    assert.equal(g.json.metadata?.unavailableSources, undefined);
    assert.equal(g.json.metadata?.inertCapabilities, "verification,sourceControl,deployment");
    assert.ok(!g.json.nodes.some((n: { type: string }) => ["VERIFICATION", "REVIEW", "COMMIT", "DEPLOYMENT"].includes(n.type)), "nothing is invented");
    const i = await get("/api/projects/ai-workforce/insights", "admin");
    assert.equal(i.status, 200);
    assert.deepEqual(i.json.inertCapabilities, ["verification", "sourceControl", "deployment"]);
    assert.equal(i.json.notConfiguredSources, undefined);
  });
});

test("the graph revision MOVES with the capability report (a `since` poll cannot miss a capability change)", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  const at = (caps: unknown) =>
    new GraphQueryService({ ...rt.context, releaseCapabilities: caps } as never).getWorkforceGraph(ADMIN, { projectId: "ai-workforce", mode: "EXECUTION" });
  const inert = (await at({ verification: false, sourceControl: false, deploymentAdapters: [] }))!;
  const partial = (await at({ verification: true, sourceControl: false, deploymentAdapters: [] }))!;
  const full = (await at({ verification: true, sourceControl: true, deploymentAdapters: ["hosting"] }))!;
  const none = (await at(undefined))!;
  assert.equal(inert.metadata?.inertCapabilities, "verification,sourceControl,deployment");
  assert.equal(partial.metadata?.inertCapabilities, "sourceControl,deployment");
  assert.equal(full.metadata?.inertCapabilities, undefined, "all capabilities present => no inert notice");
  assert.equal(none.metadata?.inertCapabilities, undefined, "a context that declares none makes no claim");
  const revs = new Set([inert.revision, partial.revision, full.revision]);
  assert.equal(revs.size, 3, "every distinct capability state has a distinct revision");
  // Stable when nothing changes.
  assert.equal((await at({ verification: false, sourceControl: false, deploymentAdapters: [] }))!.revision, inert.revision);
});

test("the control-plane context holds READ-ONLY views of the release services — at runtime, not only by type", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  assert.deepEqual(Object.keys(rt.context.verification!).sort(), ["listHistory"]);
  assert.deepEqual(Object.keys(rt.context.sourceControl!).sort(), ["activity"]);
  assert.deepEqual(Object.keys(rt.context.deployments!).sort(), ["listReleases", "listTargets"]);
  for (const svc of [rt.context.verification, rt.context.sourceControl, rt.context.deployments]) {
    for (const forbidden of ["start", "commit", "push", "prepareStageSet", "createCandidate", "deploy", "rollback", "requestApproval", "recordAgentReview"]) {
      assert.equal((svc as Record<string, unknown>)[forbidden], undefined, `${forbidden} must not be reachable from the context`);
    }
  }
});

test("PROJECT ISOLATION across the release surfaces: an operator scoped to one project sees nothing of the other", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (get) => {
    for (const path of ["graph?mode=EXECUTION", "insights", "verifications", "releases", "executions"]) {
      const foreign = await get(`/api/projects/ai-workforce/${path}`, "mm");
      assert.ok(foreign.status === 404 || foreign.status === 403, `mm -> ai-workforce/${path}: ${foreign.status}`);
      const back = await get(`/api/projects/money-mind/${path}`, "aiw");
      assert.ok(back.status === 404 || back.status === 403, `aiw -> money-mind/${path}: ${back.status}`);
      const own = await get(`/api/projects/money-mind/${path}`, "mm");
      assert.equal(own.status, 200, `mm -> money-mind/${path}`);
    }
  });
});

test("IDOR / malformed ids on the release routes are rejected, never resolved", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (get) => {
    for (const id of ["..%2F..%2Fetc", "%00", "a%20b", "x".repeat(300), "__proto__", "constructor"]) {
      for (const tail of ["verifications", "releases", "insights", "graph"]) {
        const r = await get(`/api/projects/${id}/${tail}`, "admin");
        assert.ok(r.status >= 400 && r.status < 500, `${id}/${tail} -> ${r.status}`);
        assert.ok(!JSON.stringify(r.json).includes("    at "), "no stack trace");
      }
    }
    assert.equal((await get("/api/projects/ai-workforce/verifications")).status, 401);
    assert.equal((await get("/api/projects/ai-workforce/insights")).status, 401);
  });
});

test("FAIL CLOSED: the unavailable ports refuse every operation with a stable code — never a success", async () => {
  const git = new UnavailableGovernedGit();
  const ws = new UnavailableWorkspaceControl();
  const art = new UnavailableArtifactSource();
  const denies = async (fn: () => unknown, what: string) => {
    let outcome: unknown = "returned";
    try { outcome = await fn(); } catch (e) { outcome = e; }
    assert.ok(outcome instanceof ExecutionDeniedError, `${what} must be DENIED, got ${String(outcome)}`);
    assert.equal((outcome as ExecutionDeniedError).code, "ADAPTER_UNAVAILABLE", what);
    assert.match((outcome as Error).message, /not configured in this deployment/, what);
  };
  await denies(() => git.head(), "git.head");
  await denies(() => git.commit(), "git.commit");
  await denies(() => git.readCommit(), "git.readCommit");
  await denies(() => git.remoteId(), "git.remoteId");
  await denies(() => git.remoteHead(), "git.remoteHead");
  await denies(() => git.push(), "git.push");
  await denies(() => ws.rollback(), "workspace.rollback");
  await denies(() => ws.release(), "workspace.release");
  await denies(() => ws.sourceFingerprint(), "workspace.sourceFingerprint");
  await denies(() => ws.digestFile(), "workspace.digestFile");
  await denies(() => art.digestFile(), "artifact.digestFile");
  // Reads answer honestly: there is genuinely no workspace.
  assert.equal(ws.changeSet(), undefined);
  assert.equal(ws.workspace(), undefined);
});

test("WIRING: a request that clears every earlier guard is refused BY THE UNAVAILABLE PORT (ADAPTER_UNAVAILABLE), not by an unrelated error", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  const { sourceControl } = rt.release;
  // A genuine, PASSED verification record in the durable store (as a real pipeline would leave it)...
  const verification = {
    verificationId: "vrf_seed", projectId: "ai-workforce", status: "passed", changeSetId: "cs_seed",
    sourceSessionId: "ses_seed", sourceFingerprint: "fp_seed", createdAt: "2026-09-27T00:00:00.000Z",
  };
  await rt.context.executionRecords!.put("vrf_seed", { projectId: "ai-workforce", kind: "verification", createdAt: verification.createdAt }, verification);
  // ...and a repository policy that does not require review, so the ONLY thing between the request and
  // the workspace is the capability itself.
  sourceControl.setRepositoryPolicy({
    projectId: "ai-workforce", repositoryId: "repo", version: 1,
    branch: { defaultBranch: "main", protectedBranches: [], directPushBranches: ["main"], workingBranchPrefix: "aiw/", pullRequestRequired: false },
    requireReview: false, requireIndependentReview: false, requireCommitApproval: true, requirePushApproval: true,
    commitIdentity: { name: "AI Workforce", email: "a@example.test" }, credentialRef: "secret://none",
  } as never);
  let refusal: unknown;
  try {
    await sourceControl.prepareStageSet(ADMIN, { projectId: "ai-workforce", verificationId: "vrf_seed" });
  } catch (error) {
    refusal = error;
  }
  assert.ok(refusal instanceof ExecutionDeniedError, `expected a denial, got ${String(refusal)}`);
  assert.equal((refusal as ExecutionDeniedError).code, "ADAPTER_UNAVAILABLE", "refused by the fail-closed port itself");
  assert.match((refusal as Error).message, /a workspace is not configured in this deployment/);
  // Nothing was recorded by the refused attempt.
  assert.deepEqual((await sourceControl.activity(ADMIN, "ai-workforce")).stageSets, []);
});

test("no privileged release operation can succeed in the composed production services, and refusals record nothing", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  const { sourceControl, deployments, verification } = rt.release;
  assert.deepEqual(deployments.listTargets(ADMIN, "ai-workforce"), [], "no deployment target is registered");
  assert.deepEqual(deployments.adapterIds(), []);
  for (const [name, run] of [
    ["verification.start", () => verification.start(ADMIN, { projectId: "ai-workforce", planId: "p", planVersion: 1 } as never, "k1")],
    ["sourceControl.commit", () => sourceControl.commit(ADMIN, { projectId: "ai-workforce", stageSetId: "s1", summary: "ship it", approvalId: "a1" } as never, "k2")],
    ["sourceControl.push", () => sourceControl.push(ADMIN, { projectId: "ai-workforce", commitReceiptId: "c1", approvalId: "a1" } as never, "k3")],
    ["deployments.createCandidate", () => deployments.createCandidate(ADMIN, { projectId: "ai-workforce", pushReceiptId: "r1", targetId: "t1" } as never)],
    ["deployments.deploy", () => deployments.deploy(ADMIN, { projectId: "ai-workforce", candidateId: "c1" } as never, "k4")],
  ] as Array<[string, () => Promise<unknown>]>) {
    await assert.rejects(run, (e: unknown) => e instanceof Error, `${name} must be refused`);
  }
  assert.deepEqual(await sourceControl.activity(ADMIN, "ai-workforce"), { reviews: [], stageSets: [], commits: [], pushes: [], pullRequests: [] });
  assert.deepEqual(await deployments.listReleases(ADMIN, "ai-workforce"), []);
});

test("EO-5 approval protections hold in the production-composed runtime (release approvals are project-bound, expiring, audited)", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  const stamp = (projectId: string, over: { expiresAt?: string } = {}) =>
    rt.context.approvals.request({ action: "commit", requestedBy: "x", reason: "ship", metadata: { projectId }, ...over });
  const server = http.createServer(rt.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const post = async (name: string, token: string, body: unknown, corr?: string) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/commands/${name}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(corr ? { "x-correlation-id": corr } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Body };
  };
  try {
    // An operator scoped to Money Mind cannot decide an AI Workforce release approval.
    const foreign = stamp("ai-workforce");
    const denied = await post("approve", "mm", { approvalId: foreign.id });
    assert.equal(denied.status, 403);
    assert.equal(rt.context.approvals.require(foreign.id).status, "requested");
    assert.ok(!JSON.stringify(denied.json).includes("ai-workforce"), "the other project's name does not leak");
    // A lapsed approval cannot be used, even though nothing swept it.
    const lapsed = stamp("ai-workforce", { expiresAt: new Date(Date.now() - 60_000).toISOString() });
    const late = await post("approve", "aiw", { approvalId: lapsed.id });
    assert.equal(late.status, 409);
    assert.equal(rt.context.approvals.require(lapsed.id).status, "expired");
    // The owning project's operator can decide it, exactly once, and it is audited with the caller's identity.
    const mine = stamp("ai-workforce");
    const ok = await post("approve", "aiw", { approvalId: mine.id, note: "reviewed" }, "sg-comp-1");
    assert.equal(ok.status, 200);
    const again = await post("reject", "aiw", { approvalId: mine.id, reason: "changed my mind" });
    assert.equal(again.status, 409);
    const events = rt.context.audit.list().filter((e) => e.type === "control_command" && e.data?.correlationId === "sg-comp-1");
    assert.equal(events.length, 1);
    assert.equal(events[0]!.data?.actor, "aiw-1");
    assert.equal(events[0]!.data?.outcome, "executed");
    // Payload data cannot overwrite audit facts, and a forged correlation id is replaced.
    const forged = await post("approve", "aiw", { approvalId: stamp("ai-workforce").id, actor: "root", outcome: "denied" }, "not a valid id \"}");
    assert.equal(forged.status, 200);
    assert.notEqual(forged.json.correlationId, "not a valid id \"}");
    // Bounded free text.
    assert.equal((await post("reject", "aiw", { approvalId: stamp("ai-workforce").id, reason: "x".repeat(501) })).status, 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
