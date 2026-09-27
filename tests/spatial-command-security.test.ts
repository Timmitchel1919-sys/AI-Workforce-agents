/**
 * EO-5.7 — graph-originated commands go through the EXISTING Control Plane command path, so that
 * path must enforce project scope on every command the graph can trigger.
 * GRAPH SELECTION != COMMAND AUTHORIZATION.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentOperationalStore,
  WorkflowControlStore,
  WorkforceCommandService,
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

const adapter = (projectId: string): ProjectAdapter => ({
  projectId,
  async describe() {
    return { name: projectId, capabilities: [] };
  },
  async execute() {
    return {};
  },
});
const A = "alpha";
const B = "beta";
const inA: OperatorPrincipal = { id: "op-a", role: "operator", allowedProjects: [A] };
const inB: OperatorPrincipal = { id: "op-b", role: "operator", allowedProjects: [B] };
const admin: OperatorPrincipal = { id: "adm", role: "admin", allowedProjects: "*" };

function harness() {
  const audit = new AuditLog();
  const projects = new ProjectRegistry();
  projects.register(adapter(A));
  projects.register(adapter(B));
  const ctx = {
    agents: new AgentRegistry(),
    tasks: new TaskSystem(),
    workflows: new WorkflowSystem(),
    approvals: new ApprovalSystem(),
    permissions: new PermissionSystem([]),
    tools: new ToolRegistry(audit),
    projects,
    audit,
    agentOps: new AgentOperationalStore(),
    workflowControl: new WorkflowControlStore(),
  } as unknown as ControlPlaneContext;
  return { ctx, command: new WorkforceCommandService(ctx) };
}

test("an approval BOUND to another project (metadata.projectId only) cannot be approved or rejected by a scoped operator", async () => {
  const h = harness();
  // Exactly what requestBoundApproval creates for a commit/deployment: no taskId, no plan id.
  const bound = h.ctx.approvals.request({
    action: "commit",
    requestedBy: "x",
    reason: "ship",
    metadata: { projectId: A, binding: "{}" },
  });
  const approve = await h.command.approve(inB, { approvalId: bound.id });
  assert.equal(approve.ok, false, "cross-project approve must be denied");
  assert.equal(approve.outcome, "denied");
  const reject = await h.command.reject(inB, { approvalId: bound.id, reason: "no" });
  assert.equal(reject.outcome, "denied");
  assert.equal(h.ctx.approvals.require(bound.id).status, "requested", "decision must not be recorded");
});

test("the owning project's operator and a wildcard admin can still decide a bound approval", async () => {
  const h = harness();
  const a1 = h.ctx.approvals.request({ action: "commit", requestedBy: "x", reason: "r", metadata: { projectId: A } });
  assert.equal((await h.command.approve(inA, { approvalId: a1.id })).ok, true);
  const a2 = h.ctx.approvals.request({ action: "commit", requestedBy: "x", reason: "r", metadata: { projectId: A } });
  assert.equal((await h.command.reject(admin, { approvalId: a2.id, reason: "no" })).ok, true);
});

test("an approval with NO project attribution cannot be decided by a project-scoped operator (fail closed)", async () => {
  const h = harness();
  const orphan = h.ctx.approvals.request({ action: "tool:x:read", requestedBy: "x", reason: "r" });
  const denied = await h.command.approve(inA, { approvalId: orphan.id });
  assert.equal(denied.outcome, "denied");
  assert.equal(h.ctx.approvals.require(orphan.id).status, "requested");
  // A wildcard operator (not project-scoped) still may.
  assert.equal((await h.command.approve(admin, { approvalId: orphan.id })).ok, true);
});

/* ------------------------------------------------------------------ */
/* Through the real HTTP API: allowlist, isolation, stale target, audit */
/* ------------------------------------------------------------------ */
import http from "node:http";
import type { AddressInfo } from "node:net";

import { createControlPlaneApi } from "../api/index.js";
import { WorkforceQueryService } from "../control/index.js";

const PRINCIPALS: Record<string, OperatorPrincipal> = {
  a: inA,
  b: inB,
  admin,
  viewer: { id: "v", role: "viewer", allowedProjects: [A] },
};

async function httpHarness() {
  const h = harness();
  const server = http.createServer(
    createControlPlaneApi({
      query: new WorkforceQueryService(h.ctx),
      command: h.command,
      operatorDirectory: { resolve: async (t) => PRINCIPALS[t] ?? null },
    }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const post = async (name: string, body: unknown, token = "a", corr?: string) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/commands/${name}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(corr ? { "x-correlation-id": corr } : {}) },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json };
  };
  return { ...h, post, base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const mkTask = (h: ReturnType<typeof harness>, projectId: string, status?: "failed" | "queued") => {
  const t = h.ctx.tasks.create({ type: "ops", description: "job", projectId });
  if (status === "queued") h.ctx.tasks.transition(t.id, "queued");
  if (status === "failed") {
    h.ctx.tasks.transition(t.id, "queued");
    h.ctx.tasks.transition(t.id, "running");
    h.ctx.tasks.transition(t.id, "failed", { error: "timeout" });
  }
  return t;
};

test("allowlist: only named commands exist; unknown and prototype-chain names are 404, never executed", async () => {
  const h = await httpHarness();
  try {
    for (const name of ["shell", "exec", "run", "git-push", "deploy", "constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "cancel-task/../x"]) {
      const r = await h.post(name, { taskId: "x" });
      assert.ok(r.status === 404, `${name} -> ${r.status}`);
    }
  } finally {
    await h.close();
  }
});

test("authentication: a command without a valid token is 401 and does nothing", async () => {
  const h = await httpHarness();
  try {
    const t = mkTask(h, A, "queued");
    const r = await h.post("cancel-task", { taskId: t.id }, "no-such-token");
    assert.equal(r.status, 401);
    assert.notEqual(h.ctx.tasks.get(t.id)!.status, "cancelled");
  } finally {
    await h.close();
  }
});

test("project isolation: a project-B operator cannot cancel or retry a project-A task (403, audited, unchanged)", async () => {
  const h = await httpHarness();
  try {
    const live = mkTask(h, A, "queued");
    const failed = mkTask(h, A, "failed");
    const c = await h.post("cancel-task", { taskId: live.id }, "b");
    const r = await h.post("retry-task", { taskId: failed.id }, "b");
    assert.equal(c.status, 403);
    assert.equal(r.status, 403);
    assert.equal(c.json.outcome, "denied");
    assert.equal(h.ctx.tasks.get(live.id)!.status, "queued");
    assert.equal(h.ctx.tasks.get(failed.id)!.status, "failed");
    const events = h.ctx.audit.list().filter((e) => e.type === "control_command");
    assert.ok(events.some((e) => e.data?.command === "cancel_task" && e.data?.outcome === "denied" && e.data?.actor === "op-b"), "denied attempt is audited");
  } finally {
    await h.close();
  }
});

test("authorization: a viewer cannot change anything (403 + audited)", async () => {
  const h = await httpHarness();
  try {
    const t = mkTask(h, A, "queued");
    const r = await h.post("cancel-task", { taskId: t.id }, "viewer");
    assert.equal(r.status, 403);
    assert.equal(h.ctx.tasks.get(t.id)!.status, "queued");
  } finally {
    await h.close();
  }
});

test("stale target: the server re-checks CURRENT state, whatever the graph showed", async () => {
  const h = await httpHarness();
  try {
    const t = mkTask(h, A, "queued");
    const first = await h.post("cancel-task", { taskId: t.id });
    assert.equal(first.status, 200);
    assert.equal(first.json.outcome, "executed");
    // The graph still showed "queued"; the task is now cancelled. A second cancel is refused, not repeated.
    const second = await h.post("cancel-task", { taskId: t.id });
    assert.equal(second.status, 409);
    assert.equal(second.json.errorKind, "invalid_state");
    // Retry only applies to a FAILED task.
    const live = mkTask(h, A, "queued");
    const bad = await h.post("retry-task", { taskId: live.id });
    assert.equal(bad.status, 409);
    assert.equal(h.ctx.tasks.get(live.id)!.status, "queued");
    // Unknown / vanished target.
    assert.equal((await h.post("cancel-task", { taskId: "ghost" })).status, 404);
  } finally {
    await h.close();
  }
});

test("duplicate delivery of a retry does not re-run it (state-machine idempotency)", async () => {
  const h = await httpHarness();
  try {
    const t = mkTask(h, A, "failed");
    const [x, y] = await Promise.all([h.post("retry-task", { taskId: t.id }), h.post("retry-task", { taskId: t.id })]);
    const ok = [x, y].filter((r) => r.status === 200);
    const refused = [x, y].filter((r) => r.status === 409);
    assert.equal(ok.length, 1, "exactly one delivery takes effect");
    assert.equal(refused.length, 1, "the duplicate is refused");
    assert.equal(h.ctx.tasks.get(t.id)!.metadata.controlRetryCount, 1);
  } finally {
    await h.close();
  }
});

test("approval decisions are recorded once; a second decision is refused", async () => {
  const h = await httpHarness();
  try {
    const a = h.ctx.approvals.request({ action: "commit", requestedBy: "x", reason: "r", metadata: { projectId: A } });
    assert.equal((await h.post("approve", { approvalId: a.id })).status, 200);
    const again = await h.post("reject", { approvalId: a.id, reason: "changed my mind" });
    assert.equal(again.status, 409);
    assert.equal(h.ctx.approvals.require(a.id).status, "approved");
    // Cross-project operator, fresh approval: denied.
    const other = h.ctx.approvals.request({ action: "commit", requestedBy: "x", reason: "r", metadata: { projectId: A } });
    assert.equal((await h.post("approve", { approvalId: other.id }, "b")).status, 403);
    assert.equal(h.ctx.approvals.require(other.id).status, "requested");
  } finally {
    await h.close();
  }
});

test("result + audit: a spatial command returns a structured result and one audit event with who/what/target/outcome/correlation", async () => {
  const h = await httpHarness();
  try {
    const t = mkTask(h, A, "queued");
    const r = await h.post("cancel-task", { taskId: t.id, reason: "not needed" }, "a", "sg-test-corr-1");
    assert.equal(r.status, 200);
    assert.deepEqual(
      Object.keys(r.json).sort(),
      ["auditEventId", "command", "correlationId", "details", "ok", "outcome", "reason", "resourceId", "timestamp"].sort(),
    );
    assert.equal(r.json.correlationId, "sg-test-corr-1", "the spatial correlation id is preserved end to end");
    assert.equal(r.json.ok, true);
    const ev = h.ctx.audit.list().filter((e) => e.type === "control_command" && e.data?.correlationId === "sg-test-corr-1");
    assert.equal(ev.length, 1);
    assert.deepEqual(
      { command: ev[0].data?.command, outcome: ev[0].data?.outcome, actor: ev[0].data?.actor, actorRole: ev[0].data?.actorRole, resourceId: ev[0].data?.resourceId },
      { command: "cancel_task", outcome: "executed", actor: "op-a", actorRole: "operator", resourceId: t.id },
    );
    assert.equal(ev[0].projectId, A);
    assert.equal(ev[0].id, r.json.auditEventId);
  } finally {
    await h.close();
  }
});

test("failure paths never leak internals: malformed bodies and bad ids are 4xx with a message, no stack", async () => {
  const h = await httpHarness();
  try {
    for (const body of [{}, { taskId: 5 }, { taskId: "" }, { taskId: { $ne: 1 } }, { taskId: "../../etc/passwd" }, null]) {
      const r = await h.post("cancel-task", body as never);
      assert.ok(r.status >= 400 && r.status < 500, JSON.stringify(body) + " -> " + r.status);
      assert.ok(!JSON.stringify(r.json).includes("    at "), "no stack trace");
    }
  } finally {
    await h.close();
  }
});

/* ---- review-driven hardening (independent EO-5.7 review) ---- */

test("a LAPSED approval cannot be approved or rejected, and is marked expired", async () => {
  const h = await httpHarness();
  try {
    const past = new Date(Date.now() - 60_000).toISOString();
    const lapsed = h.ctx.approvals.request({ action: "commit", requestedBy: "x", reason: "r", expiresAt: past, metadata: { projectId: A } });
    const r = await h.post("approve", { approvalId: lapsed.id });
    assert.equal(r.status, 409);
    assert.equal(r.json.errorKind, "invalid_state");
    assert.match(String(r.json.reason), /expired/);
    assert.equal(h.ctx.approvals.require(lapsed.id).status, "expired");
    const again = await h.post("reject", { approvalId: lapsed.id, reason: "late" });
    assert.equal(again.status, 409);
    // A future expiry still works.
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const live = h.ctx.approvals.request({ action: "commit", requestedBy: "x", reason: "r", expiresAt: future, metadata: { projectId: A } });
    assert.equal((await h.post("approve", { approvalId: live.id })).status, 200);
  } finally {
    await h.close();
  }
});

test("a foreign operator learns nothing about another project's approval: no state, no project name", async () => {
  const h = await httpHarness();
  try {
    const decided = h.ctx.approvals.request({ action: "commit", requestedBy: "x", reason: "r", metadata: { projectId: A } });
    assert.equal((await h.post("approve", { approvalId: decided.id })).status, 200); // now 'approved'
    const pending = h.ctx.approvals.request({ action: "commit", requestedBy: "x", reason: "r", metadata: { projectId: A } });
    const onDecided = await h.post("approve", { approvalId: decided.id }, "b");
    const onPending = await h.post("approve", { approvalId: pending.id }, "b");
    // Same answer for an already-decided and a pending foreign approval (not 409 vs 403), and it names no project.
    assert.equal(onDecided.status, 403);
    assert.equal(onPending.status, 403);
    assert.equal(onDecided.json.reason, onPending.json.reason);
    assert.ok(!JSON.stringify(onDecided.json).includes(A), "the other project's name must not leak");
  } finally {
    await h.close();
  }
});

test("an approval linked to a task is attributed to the TASK's project", async () => {
  const h = await httpHarness();
  try {
    const t = mkTask(h, A, "queued");
    const linked = h.ctx.approvals.request({ action: "task", requestedBy: "x", reason: "r", metadata: { taskId: t.id } });
    assert.equal((await h.post("approve", { approvalId: linked.id }, "b")).status, 403);
    assert.equal(h.ctx.approvals.require(linked.id).status, "requested");
    assert.equal((await h.post("approve", { approvalId: linked.id }, "a")).status, 200);
  } finally {
    await h.close();
  }
});

test("operator free text is validated: non-strings and oversized values are 400 and change nothing", async () => {
  const h = await httpHarness();
  try {
    const t = mkTask(h, A, "queued");
    for (const reason of [{ x: 1 }, 5, ["a"], "x".repeat(501)]) {
      const r = await h.post("cancel-task", { taskId: t.id, reason });
      assert.equal(r.status, 400, JSON.stringify(reason).slice(0, 30));
    }
    assert.equal(h.ctx.tasks.get(t.id)!.status, "queued");
    const a = h.ctx.approvals.request({ action: "commit", requestedBy: "x", reason: "r", metadata: { projectId: A } });
    assert.equal((await h.post("approve", { approvalId: a.id, note: { x: 1 } })).status, 400);
    assert.equal((await h.post("reject", { approvalId: a.id, reason: "y".repeat(501) })).status, 400);
    assert.equal(h.ctx.approvals.require(a.id).status, "requested");
    // A normal reason of exactly the limit is fine.
    assert.equal((await h.post("cancel-task", { taskId: t.id, reason: "z".repeat(500) })).status, 200);
  } finally {
    await h.close();
  }
});

test("caller-supplied correlation ids are kept only when well-formed; otherwise minted", async () => {
  const h = await httpHarness();
  try {
    const cases: Array<[string, boolean]> = [
      ["sg-1234-abcd", true],
      ["trace_9:a.b-c", true],
      ["x".repeat(129), false],
      ["has space", false],
      ["evil\"}, \"forged\": {\"x", false],
      ["<script>", false],
    ];
    for (const [corr, kept] of cases) {
      const t = mkTask(h, A, "queued");
      const r = await h.post("cancel-task", { taskId: t.id }, "a", corr);
      assert.equal(r.status, 200);
      if (kept) assert.equal(r.json.correlationId, corr);
      else assert.notEqual(r.json.correlationId, corr);
    }
  } finally {
    await h.close();
  }
});

test("the inbound correlation header is sanitised on EVERY route, including the response echo", async () => {
  const h = await httpHarness();
  try {
    const get = (corr: string) =>
      fetch(`${h.base}/api/status`, { headers: { authorization: "Bearer a", "x-correlation-id": corr } });
    const good = await get("trace-42");
    assert.equal(good.headers.get("x-correlation-id"), "trace-42");
    for (const bad of ["bad id with spaces", "x".repeat(200), "quote\"brace}"]) {
      const res = await get(bad);
      const echoed = res.headers.get("x-correlation-id") ?? "";
      assert.notEqual(echoed, bad);
      assert.match(echoed, /^[A-Za-z0-9_.:-]{1,128}$/);
    }
  } finally {
    await h.close();
  }
});

test("AUDIT INTEGRITY: command payload data can never overwrite the audit facts (who / what / outcome / correlation)", async () => {
  const h = await httpHarness();
  try {
    // Agent enable/disable puts operator text under `details.reason`; cancel-execution puts the
    // domain outcome under `details.outcome`. Neither may replace the audit event's own fields.
    const agentId = "audit-agent";
    h.ctx.agents.register({ id: agentId, name: agentId, description: "d", capabilities: ["code"], allowedTools: [], allowedProjects: [A], supportedTaskTypes: [], permissions: [] });
    const r = await h.post("disable-agent", { agentId, reason: "operator says: outcome=fine actor=someone-else" }, "admin", "sg-audit-1");
    assert.equal(r.status, 200);
    const ev = h.ctx.audit.list().filter((e) => e.type === "control_command" && e.data?.correlationId === "sg-audit-1");
    assert.equal(ev.length, 1);
    assert.equal(ev[0]!.data?.actor, "adm", "the actor is the authenticated principal");
    assert.equal(ev[0]!.data?.outcome, "executed");
    assert.equal(ev[0]!.data?.command, "disable_agent");
    assert.match(String(ev[0]!.data?.reason), /agent disabled/, "the audit reason is the server's, not the operator's free text");
    assert.equal(ev[0]!.data?.detailReason, "operator says: outcome=fine actor=someone-else", "the operator's text is kept, under its own key");
  } finally {
    await h.close();
  }
});
