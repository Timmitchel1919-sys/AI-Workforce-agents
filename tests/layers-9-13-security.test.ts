/**
 * Security attempts across Layers 9–13. Each test tries the forbidden thing and expects BLOCKED.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovalSystem,
  AuditLog,
  AutonomyEngine,
  ExtensionSystem,
  PlatformActionExecutor,
  SecuritySystem,
  inMemoryAutonomyRepos,
  inMemoryExtensionRepos,
  inMemorySecurityRepos,
  type ActionContext,
  type ActionResult,
  type ExtensionManifest,
} from "../core/index.js";
import { AnalyticsControlService, AutonomyControlService, ExtensionControlService } from "../control/services/platform-layers-control.js";
import { AnalyticsIntelligence, inMemoryAnalyticsRepos } from "../core/index.js";
import { ADMIN, ALPHA_ONLY, OPERATOR, VIEWER, derive, makeClock, makeSecurity, run, task } from "./helpers/platform-fixtures.js";

const skill = (id: string, permissions: string[] = []): ExtensionManifest => ({
  id,
  name: id,
  description: "d",
  version: "1.0.0",
  type: "SKILL",
  author: "a",
  capabilities: ["c"],
  dependencies: [],
  permissions,
  spec: { capability: "c", instructions: "i", prerequisites: [], tools: [], expectedOutputs: ["o"], validation: ["v"] },
});

function ext() {
  const f = makeSecurity();
  const system = new ExtensionSystem({ repos: inMemoryExtensionRepos(), security: f.security, now: f.clock.now });
  return { ...f, system, platform: system.platform, control: new ExtensionControlService({ audit: f.audit, clock: f.clock.iso }, system.platform) };
}

test("BLOCKED: an unauthorized principal cannot register, enable, grant or remove an extension", async () => {
  const r = ext();
  for (const [cmd, body] of [
    ["extension_register", { manifest: skill("s.one") }],
    ["extension_enable", { extensionId: "skill.react-development" }],
    ["extension_grant_permission", { extensionId: "skill.react-development", scope: "github.read" }],
    ["extension_remove", { extensionId: "skill.react-development" }],
    ["extension_rollback", { extensionId: "skill.react-development", version: "0.9.0" }],
  ] as const)
    for (const who of [VIEWER, OPERATOR]) assert.equal((await r.control.execute(cmd, who, body)).outcome, "denied", `${cmd} as ${who.role}`);
  assert.equal(r.platform.get("skill.react-development").status, "REGISTERED");
});

test("BLOCKED: an extension tool cannot be used by any agent, and secrets cannot be requested or configured", () => {
  const r = ext();
  const tool: ExtensionManifest = { ...skill("tool.sec"), type: "TOOL", spec: { toolId: "sec-tool", purpose: "p", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object", properties: {} }, risk: "LOW", authentication: "none", environment: "gateway", audit: { logInputs: true, logOutputs: true }, backingCapability: "repository.read" } };
  r.platform.register(tool, "owner");
  r.platform.test("tool.sec", "owner");
  r.platform.review("tool.sec", "owner");
  r.platform.enable("tool.sec", "owner");
  for (const agent of ["dev-agent", "any-agent", undefined]) assert.equal(r.security.trust.toolAllows("ext.sec-tool", agent, "DEVELOPMENT").ok, false, String(agent));
  assert.throws(() => r.platform.register(skill("s.secret", ["secrets.read"]), "owner"), /never granted/);
  assert.throws(() => r.platform.register(skill("s.os", ["os.core"]), "owner"), /never granted/);
  assert.throws(() => r.platform.register({ ...skill("s.leak"), description: "token ghp_abcdefghijklmnopqrstuvwxyz0123456789" }, "owner"), /secret/);
});

test("BLOCKED: an extension cannot smuggle code into the platform", () => {
  const r = ext();
  for (const spec of [{ script: "x" }, { handler: "x" }, { nested: { eval: "x" } }, { list: [{ wasm: "x" }] }])
    assert.throws(() => r.platform.register({ ...skill(`s.code${Math.random().toString(16).slice(2, 6)}`), spec: { capability: "c", instructions: "i", prerequisites: [], tools: [], expectedOutputs: ["o"], validation: ["v"], ...spec } }, "owner"), /declarative/);
});

test("BLOCKED: an extension cannot use a permission it was not granted, nor after it is disabled", () => {
  const r = ext();
  r.platform.register(skill("s.perm", ["firebase.deploy", "github.read"]), "owner");
  r.platform.test("s.perm", "owner");
  r.platform.review("s.perm", "owner");
  r.platform.approveReview("s.perm", "admin-1");
  r.platform.enable("s.perm", "owner");
  assert.equal(r.platform.authorize("s.perm", "firebase.deploy").allowed, false);
  r.platform.grant("s.perm", "github.read", "admin-1");
  assert.equal(r.platform.authorize("s.perm", "firebase.deploy").allowed, false, "granting one scope grants nothing else");
  r.platform.disable("s.perm", "owner");
  assert.equal(r.platform.authorize("s.perm", "github.read").allowed, false);
});

/* ------------------------------- autonomy ------------------------------- */

function auto(handlers: Record<string, (c: ActionContext) => ActionResult> = {}) {
  const f = makeSecurity();
  const calls: string[] = [];
  const h: Record<string, (c: ActionContext) => ActionResult> = { inspect_logs: () => ({ ok: true, output: "x" }), generate_report: () => ({ ok: true, output: "r" }), run_tests: () => ({ ok: true, output: "t" }), merge_production: () => ({ ok: true, output: "merged" }), modify_secrets: () => ({ ok: true, output: "changed" }), delete_database: () => ({ ok: true, output: "deleted" }), ...handlers };
  const wrapped = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, (c: ActionContext) => (calls.push(k), v(c))]));
  const engine = new AutonomyEngine(inMemoryAutonomyRepos(), {
    executor: new PlatformActionExecutor(wrapped),
    requestApproval: (d) => f.approvals.request({ action: d.action, requestedBy: d.requestedBy, reason: d.reason, metadata: d.metadata }).id,
    approvalState: (id) => {
      const a = f.approvals.get(id);
      return !a ? "unknown" : a.status === "requested" ? "pending" : a.status;
    },
    emergencyStopped: () => false,
    projectExists: (id) => ["alpha", "beta"].includes(id),
    orchestration: () => ({ active: 0, queued: 0, failed: 0, waitingApproval: 0 }),
    ledger: f.security.ledger,
    clock: f.clock.iso,
    now: f.clock.now,
  });
  return { ...f, engine, calls, control: new AutonomyControlService({ audit: f.audit, clock: f.clock.iso }, engine) };
}

test("BLOCKED: approvals cannot be bypassed by calling advance, tick or start repeatedly", async () => {
  const r = auto();
  r.engine.setLevel("alpha", 5, "owner", { confirmHighest: true });
  const def = r.engine.createDefinition({ name: "Merge", steps: [{ actionId: "merge_production" }] }, "owner");
  const inst = await r.engine.create(def.definitionId, "alpha", { source: "user_command", summary: "x", by: "owner" });
  await r.engine.start(inst.instanceId, "owner");
  for (let i = 0; i < 5; i++) {
    await r.engine.advance(inst.instanceId, "attacker");
    await r.engine.tick();
  }
  assert.equal(r.calls.length, 0, "nothing ran without a human decision");
  assert.equal(r.engine.get(inst.instanceId).state, "AWAITING_APPROVAL");
  await assert.rejects(r.engine.start(inst.instanceId, "attacker"), /AWAITING_APPROVAL/);
});

test("BLOCKED: restricted and destructive actions need explicit approval at every level", async () => {
  for (const level of [0, 1, 2, 3, 4, 5] as const) {
    const r = auto();
    r.engine.setLevel("alpha", level, "owner", { confirmHighest: true });
    for (const action of ["merge_production", "modify_secrets", "delete_database"]) {
      const def = r.engine.createDefinition({ name: action, steps: [{ actionId: action }] }, "owner");
      const inst = await r.engine.create(def.definitionId, "alpha", { source: "schedule", summary: "nightly", by: "system" });
      await r.engine.advance(inst.instanceId, "autonomy-engine").catch(() => undefined);
      const s = r.engine.get(inst.instanceId);
      assert.notEqual(s.state, "COMPLETED", `${action} at level ${level}`);
    }
    assert.equal(r.calls.length, 0, `level ${level}: no destructive action ran`);
  }
});

test("BLOCKED: nobody but a human administrator can raise autonomy, and no workflow action can change it", async () => {
  const r = auto();
  for (const who of [VIEWER, OPERATOR, ALPHA_ONLY]) assert.equal((await r.control.execute("autonomy_set_level", who, { projectId: "alpha", level: 5, confirmHighest: true })).outcome, "denied");
  assert.equal(r.engine.levelOf("alpha"), 1);
  for (const forbidden of ["set_autonomy_level", "approve_step", "grant_permission", "disable_audit", "delete_audit"])
    assert.throws(() => r.engine.createDefinition({ name: forbidden, steps: [{ actionId: forbidden }] }, "owner"), /unknown action/);
});

test("BLOCKED: a privileged workflow cannot be created, triggered or rolled back by an unauthorized principal", async () => {
  const r = auto();
  assert.equal((await r.control.execute("autonomy_create_definition", OPERATOR, { name: "x", steps: [{ actionId: "merge_production" }] })).outcome, "denied");
  assert.equal((await r.control.execute("autonomy_add_rule", OPERATOR, { projectId: "alpha", source: "github", definitionId: "wf-issue-triage" })).outcome, "denied");
  assert.equal((await r.control.execute("autonomy_trigger", VIEWER, { definitionId: "wf-issue-triage", projectId: "alpha" })).outcome, "denied");
  const betaInstance = await r.engine.create("wf-issue-triage", "beta", { source: "user_command", summary: "x", by: "owner" });
  assert.equal((await r.control.execute("autonomy_start", ALPHA_ONLY, { instanceId: betaInstance.instanceId })).errorKind, "not_found");
});

test("BLOCKED: the engine contains no model, provider or shell access — it can only call its injected executor", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const path = await import("node:path");
  for (const sub of ["autonomy", "business", "portfolio-intelligence", "analytics-intelligence", "extension-platform"]) {
    const dir = path.resolve(import.meta.dirname, "..", "core", sub);
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
      const text = readFileSync(path.join(dir, f), "utf8");
      assert.ok(!/await fetch|globalThis[.]fetch|node:https?|child_process|process[.]env|from ["'][^"']*providers\/|ModelProvider|[^a-z]eval[(]/.test(text), `${sub}/${f} must not reach a model, provider or shell directly`);
    }
  }
});

/* -------------------------------- analytics -------------------------------- */

test("BLOCKED: restricted analytics, simulated decisions and recommendation approvals", async () => {
  const f = makeSecurity();
  const a = new AnalyticsIntelligence(inMemoryAnalyticsRepos(), {
    runs: () => [run("alpha", [task({ status: "RUNNING" })]), run("beta", [task({ status: "FAILED", failures: [{ error: "beta secret failure" } as never] })])],
    deriveRunStatus: derive,
    usage: () => [],
    alerts: () => [],
    approvals: () => [],
    toolActivity: () => [],
    autonomy: () => [],
    ledger: f.security.ledger,
    clock: f.clock.iso,
    now: f.clock.now,
  });
  const control = new AnalyticsControlService({ audit: f.audit, clock: f.clock.iso }, a);
  assert.throws(() => control.project(ALPHA_ONLY, "beta"), /project not found/);
  assert.ok(!JSON.stringify(control.overview(ALPHA_ONLY)).includes("beta"));
  assert.equal((await control.execute("analytics_decide_recommendation", OPERATOR, { recommendationId: "x", decision: "APPROVED" })).outcome, "denied");
  assert.equal((await control.execute("analytics_mark_applied", VIEWER, { recommendationId: "x" })).outcome, "denied");
  const before = f.security.ledger.query({ limit: 1000 }).length;
  await control.execute("analytics_run_what_if", ADMIN, { scenario: { kind: "PAUSE_PROJECT", projectId: "alpha" } });
  assert.equal(f.security.ledger.query({ limit: 1000 }).length, before, "a simulation writes nothing");
});

/* --------------------------------- audit --------------------------------- */

test("BLOCKED: audit history cannot be edited or deleted — no command exists, and the ledger mirror is tamper-evident", async () => {
  const r = ext();
  for (const cmd of ["extension_delete_audit", "extension_edit_audit", "autonomy_delete_audit", "analytics_rewrite_history"]) {
    assert.equal((await r.control.execute(cmd, ADMIN, {})).outcome, "rejected", cmd);
  }
  // Extension and autonomy audit stores expose append/read only.
  assert.equal(typeof (r.platform as unknown as Record<string, unknown>)["deleteAudit"], "undefined");
  // Every lifecycle change is mirrored into the hash-chained governance ledger, where editing is detectable.
  r.platform.register(skill("s.audit"), "owner");
  r.platform.test("s.audit", "owner");
  const repos = inMemorySecurityRepos();
  const audit = new AuditLog();
  const clock = makeClock();
  const sec = new SecuritySystem({ repos, audit, approvals: new ApprovalSystem(), agents: { get: () => undefined }, clock: clock.iso });
  const sys = new ExtensionSystem({ repos: inMemoryExtensionRepos(), security: sec, now: clock.now });
  sys.platform.register(skill("s.audit2"), "owner");
  const stored = repos.ledger.list();
  assert.ok(stored.some((e) => e.operation === "extension.registered"));
  const victim = stored.find((e) => e.operation === "extension.registered")!;
  repos.ledger.upsert({ ...victim, result: "FORGED" });
  const reopened = new SecuritySystem({ repos, audit, approvals: new ApprovalSystem(), agents: { get: () => undefined }, clock: clock.iso });
  assert.equal(reopened.ledger.verify().ok, false, "an edited audit record is detected");
});
