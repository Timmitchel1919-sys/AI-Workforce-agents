/**
 * Layer 12 — Autonomous Workflow & Operations. Real engine and catalogue; only the action
 * executor, approval store and alert sink are fakes so every decision can be observed.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIONS,
  AutonomyEngine,
  PlatformActionExecutor,
  actionOf,
  decideStep,
  inMemoryAutonomyRepos,
  type ActionContext,
  type ActionResult,
  type AutonomyPorts,
  type OpsAutonomyLevel,
} from "../core/index.js";
import { AutonomyControlService } from "../control/services/platform-layers-control.js";
import {
  ADMIN,
  ALPHA_ONLY,
  OPERATOR,
  VIEWER,
  makeSecurity,
} from "./helpers/platform-fixtures.js";

type Handler = (ctx: ActionContext) => ActionResult | Promise<ActionResult>;

function rig(
  handlers: Record<string, Handler | undefined> = {},
  opts: { onboardingLevel?: number } = {},
) {
  const f = makeSecurity();
  const calls: { action: string; ctx: ActionContext }[] = [];
  const alerts: { event: string; severity: string }[] = [];
  const approvalsRequested: string[] = [];
  const defaults: Record<string, Handler> = {
    inspect_logs: () => ({ ok: true, output: "logs ok" }),
    generate_report: () => ({ ok: true, output: "report body" }),
    read_repository: () => ({ ok: true, output: "repo ok" }),
    run_tests: () => ({ ok: true, output: "tests passed" }),
    analyze_dependencies: () => ({ ok: true, output: "deps ok" }),
  };
  const wrapped: Record<string, Handler | undefined> = {};
  for (const [k, v] of Object.entries({ ...defaults, ...handlers }))
    wrapped[k] = v
      ? (ctx) => (calls.push({ action: k, ctx }), v(ctx))
      : undefined;
  let stopped = false;
  const ports: AutonomyPorts = {
    executor: new PlatformActionExecutor(wrapped),
    requestApproval: (d) => {
      const a = f.approvals.request({
        action: d.action,
        requestedBy: d.requestedBy,
        reason: d.reason,
        metadata: d.metadata,
      });
      approvalsRequested.push(a.id);
      return a.id;
    },
    approvalState: (id) => {
      const a = f.approvals.get(id);
      return !a ? "unknown" : a.status === "requested" ? "pending" : a.status;
    },
    decideApproval: (id, decision, by) =>
      f.approvals.decide(
        id,
        decision === "approve" ? "approved" : "rejected",
        by,
      ),
    emergencyStopped: () => stopped,
    raiseAlert: (a) => alerts.push({ event: a.event, severity: a.severity }),
    projectExists: (id) => ["alpha", "beta"].includes(id),
    environmentOf: () => "DEVELOPMENT",
    ...(opts.onboardingLevel
      ? { onboardingLevel: () => opts.onboardingLevel }
      : {}),
    orchestration: () => ({
      active: 1,
      queued: 2,
      failed: 3,
      waitingApproval: 4,
    }),
    ledger: f.security.ledger,
    clock: f.clock.iso,
    now: f.clock.now,
  };
  const engine = new AutonomyEngine(inMemoryAutonomyRepos(), ports);
  const control = new AutonomyControlService(
    { audit: f.audit, clock: f.clock.iso },
    engine,
  );
  const wire = (action: string, h: Handler) => {
    wrapped[action] = (ctx) => (calls.push({ action, ctx }), h(ctx));
  };
  return {
    ...f,
    engine,
    control,
    calls,
    alerts,
    approvalsRequested,
    wire,
    stop: (v: boolean) => (stopped = v),
  };
}
const usr = (over: object = {}) => ({
  source: "user_command" as const,
  summary: "go",
  by: "owner",
  ...over,
});

/* ------------------------------ levels & policy ------------------------------ */

test("the six autonomy levels exist and default to the onboarding level (or 1)", () => {
  const plain = rig();
  assert.equal(plain.engine.levelOf("alpha"), 1);
  assert.equal(rig({}, { onboardingLevel: 3 }).engine.levelOf("alpha"), 3);
  assert.equal(plain.engine.setLevel("alpha", 0, "owner").level, 0);
  assert.equal(plain.engine.levelOf("alpha"), 0);
  assert.throws(() => plain.engine.setLevel("alpha", 6, "owner"), /0–5/);
  assert.throws(() => plain.engine.setLevel("alpha", "high", "owner"), /0–5/);
  assert.throws(
    () => plain.engine.setLevel("alpha", 5, "owner"),
    /confirmed explicitly/,
  );
  assert.equal(
    plain.engine.setLevel("alpha", 5, "owner", { confirmHighest: true }).level,
    5,
  );
  assert.throws(
    () => plain.engine.setLevel("ghost", 2, "owner"),
    /project not found/,
  );
});

test("action risk: unknown actions are CRITICAL and restricted; restricted actions are never automatic", () => {
  assert.equal(actionOf("nonexistent"), undefined);
  for (const id of [
    "merge_production",
    "deploy_production",
    "delete_repository",
    "delete_database",
    "modify_secrets",
    "destroy_infrastructure",
    "send_external_communication",
    "destructive_device_action",
  ]) {
    const a = actionOf(id)!;
    assert.equal(a.restricted, true, id);
    assert.ok(a.risk === "HIGH" || a.risk === "CRITICAL", id);
  }
  for (const id of [
    "run_tests",
    "inspect_logs",
    "generate_report",
    "read_repository",
  ])
    assert.equal(actionOf(id)!.risk, "LOW");
  assert.equal(actionOf("create_branch")!.risk, "MEDIUM");
  assert.ok(ACTIONS.length >= 20);
});

test("decision matrix: levels only ever affect LOW and MEDIUM steps", () => {
  const wide = {
    allowedActions: ACTIONS.map((a) => a.actionId),
    maxRisk: "CRITICAL" as const,
  };
  const d = (
    actionId: string,
    level: OpsAutonomyLevel,
    planApproved = true,
  ) => {
    const action = actionOf(actionId)!;
    return decideStep({
      action,
      risk: action.risk,
      level,
      planApproved,
      boundaries: wide,
      startedByOwner: false,
    }).outcome;
  };
  // LOW inspection
  assert.equal(d("inspect_logs", 0), "NEEDS_APPROVAL");
  assert.equal(d("inspect_logs", 1), "AUTO");
  assert.equal(
    d("run_tests", 1),
    "NEEDS_APPROVAL",
    "level 1 permits only read-only inspection",
  );
  assert.equal(d("run_tests", 2), "AUTO");
  // MEDIUM
  assert.equal(d("create_branch", 2), "NEEDS_APPROVAL");
  assert.equal(d("create_branch", 3, false), "NEEDS_APPROVAL");
  assert.equal(d("create_branch", 3, true), "AUTO");
  assert.equal(d("create_branch", 4, false), "AUTO");
  assert.equal(d("create_branch", 5), "AUTO");
  // HIGH / CRITICAL / restricted: approval at EVERY level, including 5
  for (const level of [0, 1, 2, 3, 4, 5] as OpsAutonomyLevel[])
    for (const id of [
      "commit_to_branch",
      "push_branch",
      "deploy_staging",
      "merge_production",
      "deploy_production",
      "delete_repository",
      "delete_database",
      "modify_secrets",
      "destroy_infrastructure",
      "send_external_communication",
      "destructive_device_action",
    ])
      assert.equal(d(id, level), "NEEDS_APPROVAL", `${id} at level ${level}`);
});

test("boundaries: an action outside the workflow's allow-list is refused, not asked about", () => {
  const a = actionOf("run_tests")!;
  const r = decideStep({
    action: a,
    risk: a.risk,
    level: 5,
    planApproved: true,
    boundaries: { allowedActions: ["inspect_logs"], maxRisk: "LOW" },
    startedByOwner: true,
  });
  assert.equal(r.outcome, "REFUSED");
  assert.match(r.reason, /outside this workflow's boundaries/);
});

/* ------------------------------ end-to-end flows ------------------------------ */

test("level 1: inspection runs by itself, the test run waits for the owner, then the report completes and validates", async () => {
  const r = rig();
  const inst = await r.engine.create("wf-maintenance-check", "alpha", usr());
  assert.equal(inst.state, "PLANNED");
  assert.equal(r.calls.length, 0, "creating a workflow executes nothing");
  assert.ok(inst.plan.approvalsExpected >= 1);
  assert.equal(inst.plan.maxRisk, "LOW");
  const started = await r.engine.start(inst.instanceId, "owner");
  assert.equal(started.state, "AWAITING_APPROVAL");
  assert.deepEqual(
    r.calls.map((c) => c.action),
    ["inspect_logs"],
  );
  const waiting = started.steps.find((s) => s.state === "WAITING_APPROVAL")!;
  assert.equal(waiting.actionId, "run_tests");
  assert.ok(
    waiting.gate!.proposedAction &&
      waiting.gate!.reason &&
      waiting.gate!.expectedImpact &&
      waiting.gate!.rollback &&
      waiting.gate!.affectedResources.includes("alpha"),
  );
  assert.equal(waiting.gate!.risk, "LOW");
  assert.ok(r.approvalsRequested.includes(waiting.gate!.approvalId!));
  const done = await r.engine.decideStep(
    inst.instanceId,
    waiting.stepId,
    "APPROVE",
    "owner",
  );
  assert.equal(done.state, "COMPLETED");
  assert.deepEqual(
    r.calls.map((c) => c.action),
    ["inspect_logs", "run_tests", "generate_report"],
  );
  assert.equal(
    done.steps.find((s) => s.stepId === "tests")!.approvedBy,
    "owner",
  );
  assert.match(done.report!, /Validation: passed/);
  assert.equal(
    r.approvals.get(waiting.gate!.approvalId!)!.status,
    "approved",
    "the central approval record is decided too",
  );
});

test("level 4: the whole maintenance check runs automatically", async () => {
  const r = rig();
  r.engine.setLevel("alpha", 4, "owner");
  const inst = await r.engine.create("wf-maintenance-check", "alpha", usr());
  const done = await r.engine.start(inst.instanceId, "owner");
  assert.equal(done.state, "COMPLETED");
  assert.equal(r.approvalsRequested.length, 0);
  assert.ok(done.steps.every((s) => s.automatic === true));
});

test("level 0: even a read-only step needs approval", async () => {
  const r = rig();
  r.engine.setLevel("alpha", 0, "owner");
  const inst = await r.engine.create("wf-issue-triage", "alpha", usr());
  const s = await r.engine.start(inst.instanceId, "owner");
  assert.equal(s.state, "AWAITING_APPROVAL");
  assert.equal(r.calls.length, 0);
});

test("a restricted action never runs without approval — not even at level 5 — and a rejection executes nothing", async () => {
  const r = rig({ merge_production: () => ({ ok: true, output: "merged" }) });
  r.engine.setLevel("alpha", 5, "owner", { confirmHighest: true });
  const def = r.engine.createDefinition(
    {
      name: "Ship it",
      steps: [
        { actionId: "run_tests" },
        { actionId: "merge_production", params: { branch: "main" } },
      ],
    },
    "owner",
  );
  assert.deepEqual(def.boundaries.allowedActions, [
    "run_tests",
    "merge_production",
  ]);
  assert.equal(def.boundaries.maxRisk, "CRITICAL");
  const inst = await r.engine.create(def.definitionId, "alpha", usr());
  let s = await r.engine.start(inst.instanceId, "owner");
  assert.equal(s.state, "AWAITING_APPROVAL");
  assert.deepEqual(
    r.calls.map((c) => c.action),
    ["run_tests"],
  );
  const step = s.steps.find((x) => x.actionId === "merge_production")!;
  assert.equal(step.gate!.risk, "CRITICAL");
  assert.match(step.gate!.rollback, /revert_commit/);
  assert.match(step.gate!.proposedAction, /branch=main/);
  s = await r.engine.decideStep(
    inst.instanceId,
    step.stepId,
    "REJECT",
    "owner",
  );
  assert.equal(s.state, "REJECTED");
  assert.equal(
    r.calls.filter((c) => c.action === "merge_production").length,
    0,
    "rejected means never executed",
  );
  assert.equal(r.approvals.get(step.gate!.approvalId!)!.status, "rejected");
});

test("an approved restricted action is blocked, not faked, when no executor is wired for it", async () => {
  const r = rig();
  const def = r.engine.createDefinition(
    { name: "Delete", steps: [{ actionId: "delete_database" }] },
    "owner",
  );
  const inst = await r.engine.create(def.definitionId, "alpha", usr());
  let s = await r.engine.start(inst.instanceId, "owner");
  assert.equal(s.state, "AWAITING_APPROVAL");
  s = await r.engine.decideStep(
    inst.instanceId,
    s.steps[0]!.stepId,
    "APPROVE",
    "owner",
  );
  assert.equal(s.state, "BLOCKED");
  assert.match(s.stateReason, /not available in this deployment/);
  assert.equal(r.calls.length, 0);
  const ops = r.engine.operations(() => true);
  assert.equal(ops.blockedOperations.length, 1);
});

test("an unwired action blocks the workflow with its reason", async () => {
  const r = rig();
  r.engine.setLevel("alpha", 4, "owner");
  const inst = await r.engine.create("wf-dev-loop", "alpha", usr());
  const s = await r.engine.start(inst.instanceId, "owner");
  assert.equal(s.state, "BLOCKED");
  assert.equal(s.steps.find((x) => x.stepId === "run")!.state, "BLOCKED");
  assert.deepEqual(
    r.calls.map((c) => c.action),
    ["read_repository", "generate_report"],
    "earlier steps ran, later ones did not",
  );
});

test("a blocked step resumes once its action becomes available", async () => {
  const r = rig();
  r.engine.setLevel("alpha", 4, "owner");
  const inst = await r.engine.create("wf-dependency-update", "alpha", usr());
  let s = await r.engine.start(inst.instanceId, "owner");
  assert.equal(s.state, "BLOCKED", "create_branch has no executor yet");
  assert.deepEqual(
    r.calls.map((c) => c.action),
    ["analyze_dependencies", "run_tests"],
  );
  await r.engine.tick();
  assert.equal(
    r.engine.get(inst.instanceId).state,
    "BLOCKED",
    "still blocked: nothing changed",
  );
  r.wire("create_branch", () => ({ ok: true, output: "branch" }));
  r.wire("prepare_pull_request", () => ({ ok: true, output: "pr #1" }));
  await r.engine.tick();
  s = r.engine.get(inst.instanceId);
  assert.equal(s.state, "COMPLETED");
  assert.deepEqual(
    r.calls.map((c) => c.action),
    [
      "analyze_dependencies",
      "run_tests",
      "create_branch",
      "prepare_pull_request",
    ],
    "earlier steps are not repeated",
  );
});

test("EDIT changes the parameters and is assessed again; CANCEL stops everything", async () => {
  const r = rig({
    create_branch: () => ({ ok: true, output: "branch created" }),
  });
  r.engine.setLevel("alpha", 2, "owner");
  const def = r.engine.createDefinition(
    {
      name: "Branch",
      steps: [{ actionId: "create_branch", params: { name: "x" } }],
    },
    "owner",
  );
  const inst = await r.engine.create(def.definitionId, "alpha", usr());
  let s = await r.engine.start(inst.instanceId, "owner");
  const step = s.steps[0]!;
  assert.equal(step.state, "WAITING_APPROVAL");
  const firstApproval = step.gate!.approvalId!;
  s = await r.engine.decideStep(inst.instanceId, step.stepId, "EDIT", "owner", {
    name: "feature/safe",
  });
  assert.equal(s.state, "AWAITING_APPROVAL");
  assert.equal(s.steps[0]!.params["name"], "feature/safe");
  assert.notEqual(
    s.steps[0]!.gate!.approvalId,
    firstApproval,
    "a fresh approval is requested for the edited step",
  );
  assert.equal(r.approvals.get(firstApproval)!.status, "rejected");
  assert.equal(r.calls.length, 0);
  s = await r.engine.decideStep(
    inst.instanceId,
    step.stepId,
    "CANCEL",
    "owner",
  );
  assert.equal(s.state, "CANCELLED");
  assert.ok(s.steps.every((x) => x.state === "SKIPPED"));
  await assert.rejects(
    r.engine.decideStep(inst.instanceId, step.stepId, "APPROVE", "owner"),
    /not waiting for approval/,
  );
});

test("an approval decided in the central approvals queue is picked up by tick()", async () => {
  const r = rig();
  const inst = await r.engine.create("wf-maintenance-check", "alpha", usr());
  const s = await r.engine.start(inst.instanceId, "owner");
  const approvalId = s.steps.find((x) => x.state === "WAITING_APPROVAL")!.gate!
    .approvalId!;
  r.approvals.decide(approvalId, "approved", "owner");
  await r.engine.tick();
  assert.equal(r.engine.get(inst.instanceId).state, "COMPLETED");
  const rejected = await r.engine.create(
    "wf-maintenance-check",
    "alpha",
    usr(),
  );
  const s2 = await r.engine.start(rejected.instanceId, "owner");
  r.approvals.decide(
    s2.steps.find((x) => x.state === "WAITING_APPROVAL")!.gate!.approvalId!,
    "rejected",
    "owner",
  );
  await r.engine.tick();
  assert.equal(r.engine.get(rejected.instanceId).state, "REJECTED");
});

/* ------------------------------- failure & recovery ------------------------------- */

test("a transient failure of an idempotent step is retried after the delay, then succeeds", async () => {
  let attempts = 0;
  const r = rig({
    run_tests: () =>
      ++attempts < 3
        ? { ok: false, error: { kind: "TRANSIENT", message: "runner busy" } }
        : { ok: true, output: "passed" },
  });
  r.engine.setLevel("alpha", 4, "owner");
  const inst = await r.engine.create("wf-maintenance-check", "alpha", usr());
  let s = await r.engine.start(inst.instanceId, "owner");
  assert.equal(s.state, "RECOVERING");
  const step = s.steps.find((x) => x.stepId === "tests")!;
  assert.equal(step.state, "RETRY_WAIT");
  assert.ok(step.notBefore);
  await r.engine.tick();
  assert.equal(
    r.engine.get(inst.instanceId).state,
    "RECOVERING",
    "not retried before the delay",
  );
  assert.equal(attempts, 1);
  r.clock.advance(2500);
  await r.engine.tick();
  assert.equal(attempts, 2);
  r.clock.advance(5000);
  await r.engine.tick();
  s = r.engine.get(inst.instanceId);
  assert.equal(s.state, "COMPLETED");
  assert.equal(attempts, 3);
  assert.ok(
    r.engine
      .auditTrail({ instanceId: inst.instanceId })
      .some((e) => e.kind === "RECOVERY" && /retry 2\/3/.test(e.detail)),
  );
});

test("retry delay doubles and the retry limit escalates to the owner", async () => {
  const r = rig({
    run_tests: () => ({
      ok: false,
      error: { kind: "TRANSIENT", message: "still busy" },
    }),
  });
  r.engine.setLevel("alpha", 4, "owner");
  const inst = await r.engine.create("wf-maintenance-check", "alpha", usr());
  await r.engine.start(inst.instanceId, "owner");
  const first =
    Date.parse(r.engine.get(inst.instanceId).steps[1]!.notBefore!) -
    r.clock.now();
  r.clock.advance(first + 1);
  await r.engine.tick();
  const second =
    Date.parse(r.engine.get(inst.instanceId).steps[1]!.notBefore!) -
    r.clock.now();
  assert.equal(second, first * 2, "exponential backoff");
  r.clock.advance(second + 1);
  await r.engine.tick();
  const s = r.engine.get(inst.instanceId);
  assert.equal(s.state, "ESCALATED");
  assert.match(s.stateReason, /retry limit was reached/);
  assert.equal(r.alerts.length, 1);
  assert.equal(
    s.steps.find((x) => x.stepId === "report")!.state,
    "SKIPPED",
    "no unsafe continuation",
  );
});

test("permanent, policy and unavailable failures are never retried and escalate immediately", async () => {
  for (const kind of ["PERMANENT", "POLICY", "UNAVAILABLE"] as const) {
    let n = 0;
    const r = rig({
      run_tests: () => (
        n++,
        { ok: false, error: { kind, message: `${kind} failure` } }
      ),
    });
    r.engine.setLevel("alpha", 4, "owner");
    const inst = await r.engine.create("wf-maintenance-check", "alpha", usr());
    const s = await r.engine.start(inst.instanceId, "owner");
    assert.equal(s.state, "ESCALATED", kind);
    assert.equal(n, 1, `${kind} must not be retried`);
    assert.match(s.stateReason, new RegExp(`${kind} failures are not retried`));
    assert.equal(r.alerts[0]!.event, "autonomous_workflow_failed");
  }
});

test("a step that is not safe to repeat is never retried, even on a transient error", async () => {
  let n = 0;
  const r = rig({
    create_branch: () => (
      n++,
      { ok: false, error: { kind: "TRANSIENT", message: "network" } }
    ),
  });
  r.engine.setLevel("alpha", 4, "owner");
  const def = r.engine.createDefinition(
    { name: "Branch", steps: [{ actionId: "create_branch" }] },
    "owner",
  );
  const inst = await r.engine.create(def.definitionId, "alpha", usr());
  const s = await r.engine.start(inst.instanceId, "owner");
  assert.equal(s.state, "ESCALATED");
  assert.match(s.stateReason, /not safe to repeat/);
  assert.equal(n, 1);
});

test("a thrown error is captured as a permanent failure with state preserved", async () => {
  const r = rig({
    run_tests: () => {
      throw new Error("boom ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    },
  });
  r.engine.setLevel("alpha", 4, "owner");
  const inst = await r.engine.create("wf-maintenance-check", "alpha", usr());
  const s = await r.engine.start(inst.instanceId, "owner");
  assert.equal(s.state, "ESCALATED");
  assert.equal(s.steps[0]!.state, "SUCCEEDED", "completed work is preserved");
  assert.equal(s.steps.find((x) => x.stepId === "tests")!.state, "FAILED");
  assert.ok(
    !JSON.stringify(s).includes("ghp_abcdefghijklmnopqrstuvwxyz"),
    "secrets are masked in the record",
  );
});

test("validation fails a workflow whose report is empty", async () => {
  const r = rig({ generate_report: () => ({ ok: true, output: "   " }) });
  r.engine.setLevel("alpha", 4, "owner");
  const inst = await r.engine.create("wf-maintenance-check", "alpha", usr());
  const s = await r.engine.start(inst.instanceId, "owner");
  assert.equal(s.state, "FAILED");
  assert.match(s.stateReason, /produced no output/);
});

/* ---------------------------------- rollback ---------------------------------- */

test("rollback reverses only what has a defined, available reversal and reports the rest honestly", async () => {
  const r = rig({
    create_branch: () => ({ ok: true, output: "created" }),
    delete_branch: () => ({ ok: true, output: "deleted" }),
  });
  r.engine.setLevel("alpha", 4, "owner");
  const def = r.engine.createDefinition(
    {
      name: "Branch+report",
      steps: [{ actionId: "create_branch" }, { actionId: "generate_report" }],
    },
    "owner",
  );
  const inst = await r.engine.create(def.definitionId, "alpha", usr());
  await r.engine.start(inst.instanceId, "owner");
  const { instance, results } = await r.engine.rollback(
    inst.instanceId,
    "owner",
  );
  assert.equal(results.find((x) => x.stepId === "s1")!.outcome, "ROLLED_BACK");
  assert.equal(
    results.find((x) => x.stepId === "s2")!.outcome,
    "NOT_SUPPORTED",
  );
  assert.equal(instance.steps[0]!.state, "ROLLED_BACK");
  assert.equal(r.calls.filter((c) => c.action === "delete_branch").length, 1);
});

test("rollback does not promise what cannot be done", async () => {
  const r = rig({ create_branch: () => ({ ok: true, output: "created" }) });
  r.engine.setLevel("alpha", 4, "owner");
  const def = r.engine.createDefinition(
    { name: "Branch", steps: [{ actionId: "create_branch" }] },
    "owner",
  );
  const inst = await r.engine.create(def.definitionId, "alpha", usr());
  await r.engine.start(inst.instanceId, "owner");
  const { results } = await r.engine.rollback(inst.instanceId, "owner");
  assert.equal(results[0]!.outcome, "NOT_SUPPORTED");
  assert.match(results[0]!.detail, /not available in this deployment/);
  assert.equal(
    r.engine.get(inst.instanceId).steps[0]!.state,
    "SUCCEEDED",
    "state is not falsified",
  );
});

test("rollback is refused during an emergency stop", async () => {
  const r = rig();
  const inst = await r.engine.create("wf-issue-triage", "alpha", usr());
  r.stop(true);
  await assert.rejects(
    r.engine.rollback(inst.instanceId, "owner"),
    /emergency stop/,
  );
});

/* ---------------------------- global brakes & isolation ---------------------------- */

test("the emergency stop and the global pause both halt execution; resuming continues", async () => {
  const r = rig();
  r.engine.setLevel("alpha", 4, "owner");
  const inst = await r.engine.create("wf-maintenance-check", "alpha", usr());
  r.stop(true);
  let s = await r.engine.start(inst.instanceId, "owner");
  assert.equal(s.state, "PAUSED");
  assert.match(s.stateReason, /emergency stop/);
  assert.equal(r.calls.length, 0);
  r.stop(false);
  r.engine.pauseAll("owner", "maintenance window");
  s = await r.engine.advance(inst.instanceId, "owner");
  assert.equal(s.state, "PAUSED");
  assert.match(s.stateReason, /maintenance window/);
  r.engine.resumeAll("owner");
  await r.engine.tick();
  assert.equal(r.engine.get(inst.instanceId).state, "COMPLETED");
});

test("event triggers: matching enabled rules create workflows; duplicates, disabled rules and other sources are ignored", async () => {
  const r = rig();
  const rule = r.engine.addRule(
    {
      projectId: "alpha",
      source: "github",
      eventType: "issues.opened",
      definitionId: "wf-issue-triage",
    },
    "owner",
  );
  const made = await r.engine.ingestEvent({
    source: "github",
    projectId: "alpha",
    eventType: "issues.opened",
    summary: "Issue #12",
    ref: "evt-1",
  });
  assert.equal(made.length, 1);
  assert.equal(made[0]!.trigger.ruleId, rule.ruleId);
  assert.equal(
    made[0]!.state,
    "PLANNED",
    "level 1: planned, the owner starts it",
  );
  assert.equal(
    r.calls.length,
    0,
    "an event never executes anything by itself at level 1",
  );
  assert.equal(
    (
      await r.engine.ingestEvent({
        source: "github",
        projectId: "alpha",
        eventType: "issues.opened",
        summary: "again",
        ref: "evt-1",
      })
    ).length,
    0,
    "idempotent by event ref",
  );
  assert.equal(
    (
      await r.engine.ingestEvent({
        source: "github",
        projectId: "alpha",
        eventType: "push",
        summary: "x",
        ref: "evt-2",
      })
    ).length,
    0,
  );
  assert.equal(
    (
      await r.engine.ingestEvent({
        source: "monitoring",
        projectId: "alpha",
        summary: "x",
        ref: "evt-3",
      })
    ).length,
    0,
  );
  assert.equal(
    (
      await r.engine.ingestEvent({
        source: "github",
        projectId: "beta",
        eventType: "issues.opened",
        summary: "x",
        ref: "evt-4",
      })
    ).length,
    0,
    "rules are per project",
  );
  r.engine.setRuleEnabled(rule.ruleId, false, "owner");
  assert.equal(
    (
      await r.engine.ingestEvent({
        source: "github",
        projectId: "alpha",
        eventType: "issues.opened",
        summary: "x",
        ref: "evt-5",
      })
    ).length,
    0,
  );
});

test("trigger policy: level 3 waits for plan approval, level 4 auto-starts LOW/MEDIUM only, HIGH waits at any level", async () => {
  const r = rig({
    create_branch: () => ({ ok: true, output: "b" }),
    prepare_pull_request: () => ({ ok: true, output: "pr" }),
  });
  r.engine.addRule(
    {
      projectId: "alpha",
      source: "test_failure",
      definitionId: "wf-maintenance-check",
    },
    "owner",
  );
  r.engine.setLevel("alpha", 3, "owner");
  const l3 = (
    await r.engine.ingestEvent({
      source: "test_failure",
      projectId: "alpha",
      summary: "red",
      ref: "e1",
    })
  )[0]!;
  assert.equal(l3.state, "AWAITING_PLAN_APPROVAL");
  await assert.rejects(
    r.engine.start(l3.instanceId, "owner"),
    /approve the plan first/,
  );
  r.engine.approvePlan(l3.instanceId, "owner");
  assert.equal(
    (await r.engine.start(l3.instanceId, "owner")).state,
    "COMPLETED",
  );

  r.engine.setLevel("alpha", 4, "owner");
  const l4 = (
    await r.engine.ingestEvent({
      source: "test_failure",
      projectId: "alpha",
      summary: "red",
      ref: "e2",
    })
  )[0]!;
  assert.equal(l4.state, "COMPLETED", "level 4 runs a LOW workflow on its own");

  const risky = r.engine.createDefinition(
    {
      name: "Push it",
      steps: [{ actionId: "run_tests" }, { actionId: "push_branch" }],
    },
    "owner",
  );
  r.engine.addRule(
    {
      projectId: "alpha",
      source: "schedule",
      definitionId: risky.definitionId,
    },
    "owner",
  );
  r.engine.setLevel("alpha", 5, "owner", { confirmHighest: true });
  const l5 = (
    await r.engine.ingestEvent({
      source: "schedule",
      projectId: "alpha",
      summary: "nightly",
      ref: "e3",
    })
  )[0]!;
  assert.equal(
    l5.state,
    "AWAITING_PLAN_APPROVAL",
    "a HIGH-risk plan never auto-starts, even at level 5",
  );
  assert.equal(r.calls.filter((c) => c.action === "push_branch").length, 0);
});

test("an unknown project, rule source or definition is refused", async () => {
  const r = rig();
  assert.throws(
    () =>
      r.engine.addRule(
        {
          projectId: "ghost",
          source: "github",
          definitionId: "wf-issue-triage",
        },
        "o",
      ),
    /project not found/,
  );
  assert.throws(
    () =>
      r.engine.addRule(
        {
          projectId: "alpha",
          source: "carrier_pigeon",
          definitionId: "wf-issue-triage",
        },
        "o",
      ),
    /source must be/,
  );
  assert.throws(
    () =>
      r.engine.addRule(
        { projectId: "alpha", source: "github", definitionId: "nope" },
        "o",
      ),
    /definition not found/,
  );
  await assert.rejects(
    r.engine.create("wf-issue-triage", "ghost", usr()),
    /project not found/,
  );
  assert.throws(
    () =>
      r.engine.createDefinition(
        { name: "x", steps: [{ actionId: "format_disk" }] },
        "o",
      ),
    /unknown action/,
  );
  assert.throws(
    () => r.engine.createDefinition({ name: "x", steps: [] }, "o"),
    /1–20 steps/,
  );
  assert.deepEqual(
    await r.engine.ingestEvent({
      source: "github",
      projectId: "ghost",
      summary: "x",
    }),
    [],
  );
});

/* ----------------------------------- audit ----------------------------------- */

test("the autonomy audit records trigger, plan, agent, model, tool, action, approval, result, failure and recovery", async () => {
  let n = 0;
  const r = rig({
    run_tests: () =>
      ++n === 1
        ? { ok: false, error: { kind: "TRANSIENT", message: "x" } }
        : { ok: true, output: "ok" },
  });
  r.engine.setLevel("alpha", 2, "owner");
  const inst = await r.engine.create("wf-maintenance-check", "alpha", usr());
  await r.engine.start(inst.instanceId, "owner");
  r.clock.advance(5000);
  await r.engine.tick();
  const kinds = new Set(
    r.engine.auditTrail({ instanceId: inst.instanceId }).map((e) => e.kind),
  );
  for (const k of [
    "TRIGGER",
    "PLAN",
    "AGENT",
    "MODEL",
    "TOOL",
    "ACTION",
    "RESULT",
    "FAILURE",
    "RECOVERY",
  ])
    assert.ok(kinds.has(k as never), k);
  const approval = rig();
  const i2 = await approval.engine.create(
    "wf-maintenance-check",
    "alpha",
    usr(),
  );
  const s2 = await approval.engine.start(i2.instanceId, "owner");
  await approval.engine.decideStep(
    i2.instanceId,
    s2.steps.find((x) => x.state === "WAITING_APPROVAL")!.stepId,
    "APPROVE",
    "owner",
  );
  assert.ok(
    approval.engine
      .auditTrail({ instanceId: i2.instanceId })
      .some((e) => e.kind === "APPROVAL" && e.actor === "owner"),
  );
  const ledger = r.security.ledger
    .query({ limit: 2000 })
    .map((e) => e.operation);
  for (const op of [
    "autonomy.trigger",
    "autonomy.plan",
    "autonomy.action",
    "autonomy.failure",
    "autonomy.recovery",
    "autonomy.result",
  ])
    assert.ok(ledger.includes(op), op);
  assert.equal(r.security.ledger.verify().ok, true);
});

test("the plan states objective, context, dependencies, tools, agent, model, environment, result, risks and rollback", async () => {
  const r = rig();
  const inst = await r.engine.create(
    "wf-dependency-update",
    "alpha",
    usr({ summary: "update deps" }),
  );
  const p = inst.plan;
  for (const k of [
    "objective",
    "context",
    "agentHint",
    "modelPolicy",
    "environment",
    "expectedResult",
    "rollback",
  ] as const)
    assert.ok(p[k].length > 0, k);
  assert.match(p.objective, /update deps/);
  assert.match(p.modelPolicy, /Model Router/);
  assert.match(p.agentHint, /Agent Router/);
  assert.ok(
    p.dependencies.includes("create_branch") && p.requiredTools.length > 0,
  );
  assert.ok(p.risks.some((x) => /Create branch/.test(x)));
  assert.equal(p.maxRisk, "MEDIUM");
});

test("Operations Center: active, queued, failed, waiting approvals, autonomous actions, blocked, incidents, recoveries", async () => {
  const r = rig({
    run_tests: () => ({
      ok: false,
      error: { kind: "PERMANENT", message: "red" },
    }),
  });
  r.engine.setLevel("alpha", 4, "owner");
  const failed = await r.engine.create("wf-maintenance-check", "alpha", usr());
  await r.engine.start(failed.instanceId, "owner");
  r.engine.setLevel("beta", 1, "owner");
  const waiting = await r.engine.create("wf-maintenance-check", "beta", usr());
  await r.engine.start(waiting.instanceId, "owner");
  await r.engine.create("wf-issue-triage", "beta", usr());
  const ops = r.engine.operations(() => true);
  assert.equal(ops.counts.failed, 1);
  assert.equal(ops.counts.incidents, 1);
  assert.equal(ops.counts.waitingApproval, 1);
  assert.equal(ops.counts.queued, 1);
  assert.ok(ops.counts.active >= 1);
  assert.ok(ops.autonomousActions.length >= 1);
  assert.ok(ops.recoveries.some((x) => x.kind === "ESCALATION"));
  assert.deepEqual(ops.orchestration, {
    active: 1,
    queued: 2,
    failed: 3,
    waitingApproval: 4,
  });
  assert.equal(ops.global.paused, false);
  const scoped = r.engine.operations((p) => p === "alpha");
  assert.equal(scoped.counts.waitingApproval, 0);
  assert.ok(scoped.waitingApprovals.every((w) => w.projectId === "alpha"));
});

/* ----------------------------------- control ----------------------------------- */

test("control: only the owner changes autonomy levels — an operator, a viewer or a workflow cannot", async () => {
  const r = rig();
  assert.equal(
    (
      await r.control.execute("autonomy_set_level", OPERATOR, {
        projectId: "alpha",
        level: 5,
        confirmHighest: true,
      })
    ).outcome,
    "denied",
  );
  assert.equal(
    (
      await r.control.execute("autonomy_set_level", VIEWER, {
        projectId: "alpha",
        level: 5,
        confirmHighest: true,
      })
    ).outcome,
    "denied",
  );
  assert.equal(r.engine.levelOf("alpha"), 1);
  assert.equal(
    (
      await r.control.execute("autonomy_set_level", ADMIN, {
        projectId: "alpha",
        level: 3,
      })
    ).outcome,
    "executed",
  );
  assert.equal(r.engine.levelOf("alpha"), 3);
  assert.equal(
    (
      await r.control.execute("autonomy_set_level", ADMIN, {
        projectId: "alpha",
        level: 5,
      })
    ).outcome,
    "rejected",
    "level 5 needs explicit confirmation",
  );
  assert.equal(
    (
      await r.control.execute("autonomy_set_level", ALPHA_ONLY, {
        projectId: "beta",
        level: 2,
      })
    ).outcome,
    "denied",
  );
  assert.equal(
    (await r.control.execute("autonomy_cheat", ADMIN, {})).outcome,
    "rejected",
  );
});

test("control: high-risk and restricted approvals are the owner's; operators may handle low-risk steps", async () => {
  const r = rig({ push_branch: () => ({ ok: true, output: "pushed" }) });
  const def = r.engine.createDefinition(
    { name: "Push", steps: [{ actionId: "push_branch" }] },
    "owner",
  );
  const risky = await r.control.execute("autonomy_trigger", OPERATOR, {
    definitionId: def.definitionId,
    projectId: "alpha",
  });
  assert.equal(risky.outcome, "executed");
  const id = risky.details["instanceId"] as string;
  assert.equal(
    (await r.control.execute("autonomy_start", OPERATOR, { instanceId: id }))
      .outcome,
    "executed",
  );
  const stepId = r.engine.get(id).steps[0]!.stepId;
  assert.equal(
    (
      await r.control.execute("autonomy_decide_step", OPERATOR, {
        instanceId: id,
        stepId,
        decision: "APPROVE",
      })
    ).outcome,
    "denied",
  );
  assert.equal(r.calls.length, 0);
  assert.equal(
    (
      await r.control.execute("autonomy_decide_step", OPERATOR, {
        instanceId: id,
        stepId,
        decision: "REJECT",
      })
    ).outcome,
    "executed",
    "an operator may always say no",
  );
  const low = await r.control.execute("autonomy_trigger", OPERATOR, {
    definitionId: "wf-maintenance-check",
    projectId: "alpha",
  });
  const lowId = low.details["instanceId"] as string;
  await r.control.execute("autonomy_start", OPERATOR, { instanceId: lowId });
  const waitingStep = r.engine
    .get(lowId)
    .steps.find((s) => s.state === "WAITING_APPROVAL")!;
  assert.equal(
    (
      await r.control.execute("autonomy_decide_step", OPERATOR, {
        instanceId: lowId,
        stepId: waitingStep.stepId,
        decision: "APPROVE",
      })
    ).outcome,
    "executed",
  );
  assert.equal(r.engine.get(lowId).state, "COMPLETED");
});

test("control: the plan approval, rollback, definitions and automatic rules are administrator-only", async () => {
  const r = rig();
  const t = await r.control.execute("autonomy_trigger", OPERATOR, {
    definitionId: "wf-maintenance-check",
    projectId: "alpha",
  });
  const instanceId = t.details["instanceId"] as string;
  assert.equal(
    (await r.control.execute("autonomy_approve_plan", OPERATOR, { instanceId }))
      .outcome,
    "denied",
  );
  assert.equal(
    (await r.control.execute("autonomy_rollback", OPERATOR, { instanceId }))
      .outcome,
    "denied",
  );
  assert.equal(
    (
      await r.control.execute("autonomy_create_definition", OPERATOR, {
        name: "x",
        steps: [{ actionId: "run_tests" }],
      })
    ).outcome,
    "denied",
  );
  assert.equal(
    (
      await r.control.execute("autonomy_add_rule", OPERATOR, {
        projectId: "alpha",
        source: "github",
        definitionId: "wf-issue-triage",
      })
    ).outcome,
    "denied",
  );
  assert.equal(
    (await r.control.execute("autonomy_resume_all", OPERATOR, {})).outcome,
    "denied",
  );
  assert.equal(
    (
      await r.control.execute("autonomy_pause_all", OPERATOR, {
        reason: "stop",
      })
    ).outcome,
    "executed",
    "anyone with access may hit the brake",
  );
  assert.equal(
    (await r.control.execute("autonomy_resume_all", ADMIN, {})).outcome,
    "executed",
  );
  assert.equal(
    (await r.control.execute("autonomy_approve_plan", ADMIN, { instanceId }))
      .outcome,
    "executed",
  );
});

test("control: project isolation — another project's workflows, rules and levels are invisible and untouchable", async () => {
  const r = rig();
  const betaInst = await r.engine.create("wf-issue-triage", "beta", usr());
  r.engine.addRule(
    { projectId: "beta", source: "github", definitionId: "wf-issue-triage" },
    "owner",
  );
  assert.deepEqual(
    r.control.instances(ALPHA_ONLY, new URLSearchParams()).instances,
    [],
  );
  assert.throws(
    () => r.control.instance(ALPHA_ONLY, betaInst.instanceId),
    /project not found/,
  );
  assert.throws(
    () =>
      r.control.instances(
        ALPHA_ONLY,
        new URLSearchParams({ projectId: "beta" }),
      ),
    /project not found/,
  );
  assert.throws(
    () => r.control.levelFor(ALPHA_ONLY, "beta"),
    /project not found/,
  );
  assert.equal(r.control.catalog(ALPHA_ONLY).rules.length, 0);
  assert.equal(r.control.operations(ALPHA_ONLY).queued.length, 0);
  for (const cmd of [
    "autonomy_start",
    "autonomy_cancel",
    "autonomy_decide_step",
  ]) {
    const res = await r.control.execute(cmd, ALPHA_ONLY, {
      instanceId: betaInst.instanceId,
      stepId: "read",
      decision: "APPROVE",
    });
    assert.equal(res.outcome, "rejected", cmd);
    assert.equal(res.errorKind, "not_found", cmd);
  }
  assert.equal(r.engine.get(betaInst.instanceId).state, "PLANNED");
  assert.ok(
    r.control
      .audit(ALPHA_ONLY, new URLSearchParams())
      .events.every((e) => !e.projectId || e.projectId === "alpha"),
  );
});

test("the engine runs nothing itself: every action goes through the injected executor", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const dir = path.resolve(import.meta.dirname, "..", "core", "autonomy");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const text = readFileSync(path.join(dir, f), "utf8");
    assert.ok(
      !/await fetch|globalThis[.]fetch|node:https?|child_process|process[.]env|[^a-z]eval[(]|new Function/.test(
        text,
      ),
      `${f} must not execute anything itself`,
    );
  }
});
