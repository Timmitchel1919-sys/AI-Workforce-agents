/**
 * EO-5.8 — spatial intelligence: findings are grounded observations over the authorised graph,
 * suggestions are never commands, and the module cannot change anything.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createControlPlaneApi } from "../api/index.js";
import {
  GraphQueryService,
  WorkforceQueryService,
  WorkforceCommandService,
  AgentOperationalStore,
  WorkflowControlStore,
  type ControlPlaneContext,
} from "../control/index.js";
import { deriveInsights } from "../core/orchestrator/graph-insights.js";
import { buildEnvironmentFragment } from "../core/orchestrator/graph-environment-fragment.js";
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
import {
  INSIGHT_KINDS,
  MAX_INSIGHTS,
  type GraphOperationalState,
  type WorkforceGraphEdge,
  type WorkforceGraphNode,
  type WorkforceGraphNodeType,
  type WorkforceGraphEdgeType,
} from "../contracts/graph.js";

const n = (
  id: string,
  type: WorkforceGraphNodeType,
  status: string,
  state: GraphOperationalState,
  label = id,
  metadata?: WorkforceGraphNode["metadata"],
): WorkforceGraphNode => ({ id, type, label, status, state, projectId: "p", referenceId: id, ...(metadata ? { metadata } : {}) });
const e = (type: WorkforceGraphEdgeType, source: string, target: string, status?: string): WorkforceGraphEdge => ({
  id: `${type}-${source}-${target}`,
  type,
  source,
  target,
  ...(status ? { status } : {}),
});
const find = (g: { nodes: WorkforceGraphNode[]; edges: WorkforceGraphEdge[] }, kind: string, variant?: string) =>
  deriveInsights(g).findings.filter((f) => f.kind === kind && (variant === undefined || f.variant === variant));

test("a healthy graph yields NO findings (nothing is invented)", () => {
  const g = {
    nodes: [
      n("project-p", "PROJECT", "active", "active"),
      n("task-1", "TASK", "completed", "completed"),
      n("task-2", "TASK", "running", "running"),
      n("session-1", "EXECUTION_SESSION", "succeeded", "completed"),
      n("deployment-1", "DEPLOYMENT", "healthy", "completed"),
      n("env-e", "ENVIRONMENT", "available", "active"),
    ],
    edges: [e("EXECUTES", "task-2", "session-1")],
  };
  assert.deepEqual(deriveInsights(g), { findings: [], truncated: false });
  assert.deepEqual(deriveInsights({ nodes: [], edges: [] }), { findings: [], truncated: false });
});

test("blocked task: 'blocked because dependency Y has not completed' — traced to the real dependency and its status", () => {
  const g = {
    nodes: [n("task-x", "TASK", "blocked", "blocked", "Ship it"), n("task-y", "TASK", "running", "running", "Build core")],
    edges: [e("DEPENDS_ON", "task-x", "task-y", "blocking")],
  };
  const [f] = find(g, "BLOCKED_TASK", "dependency");
  assert.ok(f);
  assert.equal(f.subjectNodeId, "task-x");
  assert.deepEqual(f.params, { task: "Ship it", dependency: "Build core", dependencyStatus: "running", count: 1 });
  assert.deepEqual(f.evidence.map((x) => [x.nodeId, x.status]), [["task-x", "blocked"], ["task-y", "running"]]);
  assert.ok(!f.limitations.includes("cause_not_recorded"), "the cause IS recorded here: the dependency");
});

test("a satisfied dependency is not a blocker; a queued task waiting on an unfinished one is only informational", () => {
  const done = { nodes: [n("task-x", "TASK", "blocked", "blocked"), n("task-y", "TASK", "completed", "completed")], edges: [e("DEPENDS_ON", "task-x", "task-y", "satisfied")] };
  assert.equal(find(done, "BLOCKED_TASK", "dependency").length, 0);
  const waiting = { nodes: [n("task-x", "TASK", "queued", "queued"), n("task-y", "TASK", "running", "running")], edges: [e("DEPENDS_ON", "task-x", "task-y", "blocking")] };
  assert.equal(find(waiting, "BLOCKED_TASK", "dependency")[0]!.severity, "info");
});

test("blocked with no recorded reason says so instead of guessing; awaiting_approval is its own variant", () => {
  const g = { nodes: [n("task-a", "TASK", "blocked", "blocked"), n("task-b", "TASK", "awaiting_approval", "blocked")], edges: [] };
  const un = find(g, "BLOCKED_TASK", "unspecified");
  assert.equal(un.length, 1);
  assert.ok(un[0]!.limitations.includes("cause_not_recorded"));
  assert.equal(find(g, "BLOCKED_TASK", "approval")[0]!.subjectNodeId, "task-b");
});

test("finished tasks are never reported", () => {
  const g = { nodes: [n("task-a", "TASK", "cancelled", "blocked"), n("task-b", "TASK", "completed", "blocked")], edges: [] };
  assert.equal(deriveInsights(g).findings.length, 0);
});

test("failed execution: critical, states that the CAUSE is not recorded; a retry is only suggested when the task itself failed", () => {
  const failed = {
    nodes: [n("session-s", "EXECUTION_SESSION", "timed_out", "failed", "Session build"), n("task-t", "TASK", "failed", "failed")],
    edges: [e("EXECUTES", "task-t", "session-s")],
  };
  const [f] = find(failed, "FAILED_EXECUTION");
  assert.equal(f!.severity, "critical");
  assert.ok(f!.limitations.includes("cause_not_recorded"));
  assert.deepEqual(f!.recommendations.map((r) => r.kind), ["inspect", "consider_retry"]);
  assert.equal(f!.recommendations[1]!.relatedCommand, "retry-task");
  assert.equal(f!.recommendations[1]!.targetNodeId, "task-t");
  // Task still running => no retry suggestion.
  const running = { nodes: [n("session-s", "EXECUTION_SESSION", "failed", "failed"), n("task-t", "TASK", "running", "running")], edges: [e("EXECUTES", "task-t", "session-s")] };
  assert.deepEqual(find(running, "FAILED_EXECUTION")[0]!.recommendations.map((r) => r.kind), ["inspect"]);
  // A session that merely finished / was cancelled / was denied is not a failure.
  const other = { nodes: [n("s1", "EXECUTION_SESSION", "succeeded", "completed"), n("s2", "EXECUTION_SESSION", "cancelled", "cancelled"), n("s3", "EXECUTION_SESSION", "denied", "blocked")], edges: [] };
  assert.equal(find(other, "FAILED_EXECUTION").length, 0);
});

test("waiting approval: 'Deployment Z is waiting for approval A' — names the real subject through the real edge", () => {
  const g = {
    nodes: [n("deployment-z", "DEPLOYMENT", "pending", "queued", "Deployment production"), n("approval-a", "APPROVAL", "requested", "awaiting_approval", "Approval")],
    edges: [e("REQUIRES_APPROVAL", "deployment-z", "approval-a")],
  };
  const [f] = find(g, "WAITING_APPROVAL");
  assert.deepEqual(f!.params, { subject: "Deployment production", subjectType: "DEPLOYMENT", approval: "Approval" });
  assert.equal(f!.severity, "warning");
  // Decided approvals are not reported.
  assert.equal(find({ nodes: [n("approval-a", "APPROVAL", "approved", "completed")], edges: [] }, "WAITING_APPROVAL").length, 0);
});

test("environment (REAL projection data): tasks that need an environment nobody can provide are reported, with the real counts", () => {
  // Built by the real fragment builder, so the vocabulary is exactly what production emits.
  const fragment = buildEnvironmentFragment({
    projectId: "p",
    tasks: [{ id: "t1", projectId: "p" }, { id: "t2", projectId: "p" }, { id: "t3", projectId: "p" }],
    routes: [
      { taskId: "t1", code: "docker", status: "requires_provisioning", detail: "d" },
      { taskId: "t2", code: "docker", status: "no_environment", detail: "d" },
      { taskId: "t3", code: "xcode", status: "routed", detail: "d" },
    ],
  });
  const graph = {
    nodes: [n("project-p", "PROJECT", "active", "active"), ...["t1", "t2", "t3"].map((id) => n(`task-${id}`, "TASK", "queued", "queued")), ...fragment.nodes],
    edges: fragment.edges,
  };
  const finding = deriveInsights(graph).findings.find((f) => f.kind === "ENVIRONMENT_UNAVAILABLE")!;
  assert.ok(finding, "docker cannot place its 2 tasks");
  assert.equal(finding.subjectNodeId, "env-docker");
  assert.equal(finding.params.count, 2);
  assert.equal(finding.params.status, "requires_provisioning");
  // The environment that DID place its task is not reported.
  assert.ok(!deriveInsights(graph).findings.some((f) => f.subjectNodeId === "env-xcode"));
});

test("environment: a session running on a DOWN instance is reported; an idle or healthy environment is not", () => {
  const down = n("env-instance-a", "ENVIRONMENT", "unavailable", "offline", "Docker host");
  const live = n("session-s", "EXECUTION_SESSION", "running", "running");
  const done = n("session-d", "EXECUTION_SESSION", "succeeded", "completed");
  const busy = { nodes: [down, live, done], edges: [e("RUNS_ON", "session-s", "env-instance-a"), e("RUNS_ON", "session-d", "env-instance-a")] };
  const [f] = find(busy, "ENVIRONMENT_UNAVAILABLE");
  assert.equal(f!.params.count, 1, "only the unfinished session counts");
  assert.equal(find({ nodes: [down, done], edges: [e("RUNS_ON", "session-d", "env-instance-a")] }, "ENVIRONMENT_UNAVAILABLE").length, 0, "idle");
  const up = n("env-instance-a", "ENVIRONMENT", "available", "active");
  assert.equal(find({ nodes: [up, live], edges: [e("RUNS_ON", "session-s", "env-instance-a")] }, "ENVIRONMENT_UNAVAILABLE").length, 0, "healthy");
  // An UNKNOWN environment state is not the same as offline.
  const unknown = n("env-instance-a", "ENVIRONMENT", "x", "unavailable");
  assert.equal(find({ nodes: [unknown, live], edges: [e("RUNS_ON", "session-s", "env-instance-a")] }, "ENVIRONMENT_UNAVAILABLE").length, 0);
});

test("review waiting: one finding per ChangeSet, plus a grouped count when several wait (a count, not a risk score)", () => {
  const one = { nodes: [n("changeset-1", "CHANGESET", "ready_for_review", "awaiting_review", "CS1", { fileCount: 3 })], edges: [] };
  assert.equal(find(one, "REVIEW_WAITING").length, 1);
  assert.equal(find(one, "REVIEW_WAITING", "queue").length, 0);
  const many = { nodes: ["1", "2", "3"].map((i) => n(`changeset-${i}`, "CHANGESET", "ready_for_review", "awaiting_review")), edges: [] };
  assert.equal(find(many, "REVIEW_WAITING", "waiting").length, 3);
  assert.equal(find(many, "REVIEW_WAITING", "queue")[0]!.params.count, 3);
});

test("deployment: failed/degraded/rolled back are reported; DEPLOYED (accepted) is 'unverified', HEALTHY is fine", () => {
  const mk = (status: string) => find({ nodes: [n("deployment-d", "DEPLOYMENT", status, "failed")], edges: [] }, "DEPLOYMENT_PROBLEM");
  assert.equal(mk("failed")[0]!.severity, "critical");
  assert.equal(mk("degraded")[0]!.variant, "degraded");
  assert.equal(mk("rolled_back")[0]!.variant, "rolled_back");
  const deployed = mk("deployed")[0]!;
  assert.equal(deployed.variant, "unverified"); // DEPLOYED != VERIFIED
  assert.equal(deployed.severity, "info");
  assert.equal(mk("healthy").length, 0);
  assert.equal(mk("deploying").length, 0);
});

test("dependency bottleneck: an unfinished task that >=2 unfinished tasks are waiting on", () => {
  const g = {
    nodes: [n("task-core", "TASK", "running", "running", "Core"), n("task-a", "TASK", "queued", "queued"), n("task-b", "TASK", "queued", "queued"), n("task-c", "TASK", "completed", "completed")],
    edges: [e("DEPENDS_ON", "task-a", "task-core", "blocking"), e("DEPENDS_ON", "task-b", "task-core", "blocking"), e("DEPENDS_ON", "task-c", "task-core", "satisfied")],
  };
  const [f] = find(g, "DEPENDENCY_BOTTLENECK");
  assert.equal(f!.params.count, 2);
  assert.deepEqual(f!.evidence.map((x) => x.nodeId).sort(), ["task-a", "task-b", "task-core"]);
  const single = { nodes: g.nodes.slice(0, 2), edges: [g.edges[0]!] };
  assert.equal(find(single, "DEPENDENCY_BOTTLENECK").length, 0);
});

test("GROUNDING: every piece of evidence is a real node in the graph with the same state and status", () => {
  const g = {
    nodes: [
      n("task-x", "TASK", "blocked", "blocked"), n("task-y", "TASK", "running", "running"), n("session-s", "EXECUTION_SESSION", "failed", "failed"),
      n("approval-a", "APPROVAL", "requested", "awaiting_approval"), n("deployment-d", "DEPLOYMENT", "failed", "failed"), n("changeset-c", "CHANGESET", "ready_for_review", "awaiting_review"),
    ],
    edges: [e("DEPENDS_ON", "task-x", "task-y", "blocking"), e("EXECUTES", "task-x", "session-s")],
  };
  const byId = new Map(g.nodes.map((x) => [x.id, x]));
  const { findings } = deriveInsights(g);
  assert.ok(findings.length >= 5);
  for (const f of findings) {
    assert.ok(INSIGHT_KINDS.includes(f.kind));
    assert.ok(f.evidence.length > 0, "a finding without evidence must not exist");
    for (const ev of f.evidence) {
      const real = byId.get(ev.nodeId)!;
      assert.ok(real, ev.nodeId);
      assert.deepEqual([ev.state, ev.status, ev.nodeType], [real.state, real.status, real.type]);
    }
    assert.ok(byId.has(f.subjectNodeId));
    for (const r of f.recommendations) assert.ok(byId.has(r.targetNodeId), "suggestions point at real nodes");
    assert.ok(f.limitations.includes("as_of_revision"));
  }
});

test("SUGGESTION != COMMAND: a recommendation is a label + target; it carries no payload and no executable field", () => {
  const g = { nodes: [n("session-s", "EXECUTION_SESSION", "failed", "failed"), n("task-t", "TASK", "failed", "failed"), n("approval-a", "APPROVAL", "requested", "awaiting_approval")], edges: [e("EXECUTES", "task-t", "session-s")] };
  const allowedKeys = new Set(["kind", "targetNodeId", "relatedCommand"]);
  const related = new Set(["retry-task", "cancel-task", "cancel-execution", "approve", "reject"]);
  for (const f of deriveInsights(g).findings) {
    for (const r of f.recommendations) {
      assert.ok(Object.keys(r).every((k) => allowedKeys.has(k)), JSON.stringify(r));
      if (r.relatedCommand) assert.ok(related.has(r.relatedCommand));
    }
  }
});

test("dangling edges are ignored, output is deterministic and independent of input order, ids are stable", () => {
  const nodes = [n("task-x", "TASK", "blocked", "blocked"), n("task-y", "TASK", "running", "running"), n("session-s", "EXECUTION_SESSION", "failed", "failed")];
  const edges = [e("DEPENDS_ON", "task-x", "task-y", "blocking"), e("DEPENDS_ON", "task-x", "task-GHOST", "blocking"), e("EXECUTES", "ghost", "session-s")];
  const a = deriveInsights({ nodes, edges });
  const b = deriveInsights({ nodes: [...nodes].reverse(), edges: [...edges].reverse() });
  assert.deepEqual(a, b);
  assert.deepEqual(a.findings.map((f) => f.id), [...a.findings.map((f) => f.id)]);
  assert.match(a.findings[0]!.id, /^[A-Z_]+:[a-z_]+:.+/);
  assert.ok(!JSON.stringify(a).includes("GHOST"));
});

test("output is bounded and says when it was truncated; severity orders the list", () => {
  const nodes = Array.from({ length: MAX_INSIGHTS + 20 }, (_, i) => n(`session-${String(i).padStart(4, "0")}`, "EXECUTION_SESSION", "failed", "failed"));
  nodes.push(n("changeset-z", "CHANGESET", "ready_for_review", "awaiting_review"));
  const r = deriveInsights({ nodes, edges: [] });
  assert.equal(r.findings.length, MAX_INSIGHTS);
  assert.equal(r.truncated, true);
  assert.equal(r.findings[0]!.severity, "critical");
  const sev = r.findings.map((f) => f.severity);
  assert.deepEqual(sev, [...sev].sort((a, b) => ["critical", "warning", "info"].indexOf(a) - ["critical", "warning", "info"].indexOf(b)));
});

test("AUTONOMY BOUNDARY (structural): the module imports no command, execution, release, network or filesystem code", () => {
  const src = readFileSync(new URL("../../core/orchestrator/graph-insights.ts", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^import[^;]*from\s+"([^"]+)"/gms)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["../../contracts/graph.js", "./graph-util.js"]);
  for (const banned of ["fetch(", "child_process", "node:fs", "process.env", "Date.now", "Math.random", ".execute(", ".commit(", ".deploy(", ".cancel(", ".approve("]) {
    assert.ok(!src.includes(banned), banned);
  }
});

/* ---- service + HTTP: authorised exactly like the graph, read-only, project-isolated ---- */

const A = "alpha";
const B = "beta";
const adapter = (projectId: string): ProjectAdapter => ({ projectId, async describe() { return { name: projectId, capabilities: [] }; }, async execute() { return {}; } });
const P: Record<string, OperatorPrincipal> = {
  a: { id: "op-a", role: "operator", allowedProjects: [A] },
  b: { id: "op-b", role: "operator", allowedProjects: [B] },
  viewer: { id: "v", role: "viewer", allowedProjects: [A] },
  none: { id: "n", role: "viewer", allowedProjects: [] },
};

function world() {
  const audit = new AuditLog();
  const projects = new ProjectRegistry();
  projects.register(adapter(A));
  projects.register(adapter(B));
  const tasks = new TaskSystem();
  const ctx = {
    agents: new AgentRegistry(), tasks, workflows: new WorkflowSystem(), approvals: new ApprovalSystem(),
    permissions: new PermissionSystem([]), tools: new ToolRegistry(audit), projects, audit,
    agentOps: new AgentOperationalStore(), workflowControl: new WorkflowControlStore(),
  } as unknown as ControlPlaneContext;
  return { ctx, tasks, audit };
}

test("service: real TaskSystem data → findings for THIS project only; another project's tasks never appear", async () => {
  const w = world();
  const core = w.tasks.create({ type: "ops", description: "Core work", projectId: A });
  w.tasks.create({ type: "ops", description: "Depends on core", projectId: A, dependencies: [core.id] });
  const foreign = w.tasks.create({ type: "ops", description: "SECRET foreign work", projectId: B });
  w.tasks.create({ type: "ops", description: "Foreign dependent", projectId: B, dependencies: [foreign.id] });
  const svc = new GraphQueryService(w.ctx);
  const r = (await svc.getInsights(P.a!, A))!;
  assert.equal(r.projectId, A);
  assert.equal(r.basis, "observed_state");
  const text = JSON.stringify(r);
  assert.ok(!text.includes("SECRET foreign work") && !text.includes("Foreign dependent"), "no other project's data");
  assert.ok(r.findings.some((f) => f.kind === "BLOCKED_TASK" && f.variant === "dependency" && f.params.dependency === "Core work"));
});

test("service: authorised before anything is read; outsider / no-access / unknown project → undefined", async () => {
  const w = world();
  const svc = new GraphQueryService(w.ctx);
  assert.equal(await svc.getInsights(P.b!, A), undefined);
  assert.equal(await svc.getInsights(P.none!, A), undefined);
  assert.equal(await svc.getInsights({ id: "w", role: "operator", allowedProjects: "*" }, "ghost"), undefined);
  assert.ok(await svc.getInsights(P.viewer!, A), "a viewer may read insights");
});

test("read-only: computing insights changes no task, approval or audit state", async () => {
  const w = world();
  const t1 = w.tasks.create({ type: "ops", description: "one", projectId: A });
  w.tasks.create({ type: "ops", description: "two", projectId: A, dependencies: [t1.id] });
  const ap = w.ctx.approvals.request({ action: "commit", requestedBy: "x", reason: "r", metadata: { projectId: A } });
  const snap = () => JSON.stringify({ tasks: w.tasks.list(), approvals: w.ctx.approvals.list(), audit: w.audit.list().length });
  const before = snap();
  const svc = new GraphQueryService(w.ctx);
  for (let i = 0; i < 3; i += 1) await svc.getInsights(P.a!, A);
  assert.equal(snap(), before);
  assert.equal(w.ctx.approvals.require(ap.id).status, "requested");
});

test("the revision is stable across reads and moves when the observed state moves", async () => {
  const w = world();
  const svc = new GraphQueryService(w.ctx);
  const t = w.tasks.create({ type: "ops", description: "one", projectId: A });
  const r1 = (await svc.getInsights(P.a!, A))!;
  assert.equal((await svc.getInsights(P.a!, A))!.graphRevision, r1.graphRevision);
  w.tasks.transition(t.id, "queued");
  assert.notEqual((await svc.getInsights(P.a!, A))!.graphRevision, r1.graphRevision);
});

test("an unreadable execution source is reported as UNKNOWN, so missing findings are not read as 'all clear'", async () => {
  const w = world();
  (w.ctx as unknown as Record<string, unknown>).deployments = { listReleases: async () => { throw new Error("boom"); } };
  const r = (await new GraphQueryService(w.ctx).getInsights(P.a!, A))!;
  assert.deepEqual(r.unavailableSources, ["releases"]);
  assert.ok(!JSON.stringify(r).includes("boom"));
});

test("HTTP: GET /projects/:id/insights is authenticated, project-scoped, no-store; POST is refused", async () => {
  const w = world();
  w.tasks.create({ type: "ops", description: "x", projectId: A });
  const server = http.createServer(
    createControlPlaneApi({
      query: new WorkforceQueryService(w.ctx),
      command: new WorkforceCommandService(w.ctx),
      graphQuery: new GraphQueryService(w.ctx),
      operatorDirectory: { resolve: async (t) => P[t] ?? null },
    }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    const get = (path: string, token?: string) => fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    assert.equal((await get(`/projects/${A}/insights`)).status, 401);
    const ok = await get(`/projects/${A}/insights`, "a");
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    assert.equal(((await ok.json()) as { basis: string }).basis, "observed_state");
    assert.equal((await get(`/projects/${A}/insights`, "b")).status, 404, "another project's operator");
    assert.equal((await get(`/projects/ghost/insights`, "a")).status, 404);
    const post = await fetch(`${base}/projects/${A}/insights`, { method: "POST", headers: { authorization: "Bearer a", "content-type": "application/json" }, body: "{}" });
    assert.ok(post.status >= 400 && post.status < 500, `POST -> ${post.status}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
