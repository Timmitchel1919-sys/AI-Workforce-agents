/**
 * Phase 7A — Control Plane backend hardening.
 *
 * Correlation ids, the error-kind model, `UNKNOWN` health, the event-publisher
 * port, and the extra query filters. The broad query/command/RBAC/state/audit
 * coverage lives in control-plane.test.ts; this file exercises only the 7A
 * additions and the explicit security regressions.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  HandoffSystem,
  Orchestrator,
  PermissionSystem,
  ProjectRegistry,
  TaskSystem,
  ToolRegistry,
  WorkflowSystem,
  type Agent,
  type OperatorPrincipal,
  type PermissionGrant,
  type ProjectAdapter,
} from "../core/index.js";
import {
  AgentOperationalStore,
  WorkflowControlStore,
  WorkforceCommandService,
  WorkforceQueryService,
  classifyErrorKind,
  createCorrelationId,
  ForbiddenError,
  InvalidControlStateError,
  resolveCorrelationId,
  type ControlPlaneContext,
  type ControlPlaneEvent,
} from "../control/index.js";
import {
  NotFoundError,
  ValidationError,
  CONTROL_ERROR_KINDS,
} from "../contracts/index.js";

/* ------------------------------------------------------------------ */
/* Harness                                                            */
/* ------------------------------------------------------------------ */

const PROJECT = "money-mind";
const OTHER = "aims";

const GRANTS: PermissionGrant[] = [
  { effect: "allow", action: "read", projectId: PROJECT },
  { effect: "allow", action: "execute", projectId: PROJECT },
];

function makeAgent(id: string): Agent {
  return {
    id,
    name: id.replace(/-/g, " "),
    description: `${id} test agent`,
    capabilities: ["testing"],
    allowedTools: [],
    allowedProjects: [PROJECT],
    supportedTaskTypes: ["ops"],
    permissions: [],
    metadata: { role: id.replace(/-agent$/, "") },
  };
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

class FakeEvents {
  readonly seen: ControlPlaneEvent[] = [];
  throwOnNext = false;
  publish(event: ControlPlaneEvent): void {
    if (this.throwOnNext) {
      this.throwOnNext = false;
      throw new Error("publisher is down");
    }
    this.seen.push(event);
  }
}

function harness(opts: { throwingOrchestrator?: boolean } = {}) {
  const audit = new AuditLog();
  const agents = new AgentRegistry();
  agents.register(makeAgent("research-agent"));

  const tasks = new TaskSystem();
  const workflows = new WorkflowSystem();
  const approvals = new ApprovalSystem();
  const permissions = new PermissionSystem(GRANTS);
  const handoffs = new HandoffSystem();
  const tools = new ToolRegistry(audit);
  const projects = new ProjectRegistry();
  projects.register(stubAdapter(PROJECT), { displayName: "Money Mind" });

  const agentOps = new AgentOperationalStore();
  const workflowControl = new WorkflowControlStore();
  const events = new FakeEvents();

  const orchestrator = new Orchestrator(
    agents,
    tasks,
    handoffs,
    audit,
    { execute: async () => ({ ok: true }) },
    approvals,
    { permissions, agentGate: agentOps },
  );

  const realDecision = orchestrator.recordApprovalDecision.bind(orchestrator);
  const ctx: ControlPlaneContext = {
    agents,
    tasks,
    workflows,
    approvals,
    permissions,
    tools,
    projects,
    audit,
    agentOps,
    workflowControl,
    orchestrator: {
      recordApprovalDecision: opts.throwingOrchestrator
        ? () => {
            throw new Error("core approval subsystem unavailable");
          }
        : realDecision,
      resume: orchestrator.resume.bind(orchestrator),
    },
    events,
  };

  return {
    ctx,
    audit,
    tasks,
    workflows,
    approvals,
    agentOps,
    events,
    query: new WorkforceQueryService(ctx),
    command: new WorkforceCommandService(ctx),
  };
}

const VIEWER: OperatorPrincipal = {
  id: "viewer-1",
  role: "viewer",
  allowedProjects: "*",
};
const OPERATOR: OperatorPrincipal = {
  id: "operator-1",
  role: "operator",
  allowedProjects: "*",
};
const ADMIN: OperatorPrincipal = {
  id: "admin-1",
  role: "admin",
  allowedProjects: "*",
};
const SCOPED: OperatorPrincipal = {
  id: "operator-2",
  role: "operator",
  allowedProjects: [OTHER],
};

function failedTask(h: ReturnType<typeof harness>, reason = "tool_failure") {
  const t = h.tasks.create({
    type: "ops",
    description: "x",
    projectId: PROJECT,
  });
  h.tasks.transition(t.id, "queued");
  h.tasks.assign(t.id, "research-agent");
  h.tasks.fail(t.id, `[research-agent:${reason}] boom`);
  return t;
}

/* ================================================================== */
/* Correlation ids                                                     */
/* ================================================================== */

test("correlation: helper mints stable, prefixed ids", () => {
  const a = createCorrelationId();
  assert.match(a, /^corr_/);
  assert.notEqual(a, createCorrelationId());
  assert.equal(resolveCorrelationId({ correlationId: "req-42" }), "req-42");
  assert.equal(
    resolveCorrelationId({ correlationId: "  " }).startsWith("corr_"),
    true,
  );
  assert.equal(resolveCorrelationId().startsWith("corr_"), true);
});

test("correlation: a command mints an id and threads it to the audit event", async () => {
  const h = harness();
  const live = h.tasks.create({
    type: "ops",
    description: "live",
    projectId: PROJECT,
  });
  const result = await h.command.cancelTask(OPERATOR, { taskId: live.id });
  assert.equal(result.outcome, "executed");
  assert.match(result.correlationId, /^corr_/);

  const events = h.query.getAuditEvents(OPERATOR, {
    correlationId: result.correlationId,
  });
  assert.equal(events.items.length, 1);
  assert.equal(events.items[0]!.type, "control_command");
  assert.equal(events.items[0]!.id, result.auditEventId);
  assert.equal(events.items[0]!.correlationId, result.correlationId);
});

test("correlation: a caller-supplied id is preserved end to end", async () => {
  const h = harness();
  const live = h.tasks.create({
    type: "ops",
    description: "live",
    projectId: PROJECT,
  });
  const result = await h.command.cancelTask(
    OPERATOR,
    { taskId: live.id },
    { correlationId: "trace-abc-123" },
  );
  assert.equal(result.correlationId, "trace-abc-123");
  const [event] = h.query.getAuditEvents(OPERATOR, {
    correlationId: "trace-abc-123",
  }).items;
  assert.ok(event);
  assert.equal(event!.correlationId, "trace-abc-123");
});

/* ================================================================== */
/* Error-kind model                                                    */
/* ================================================================== */

test("errorKind: invalid_request on a malformed command", async () => {
  const h = harness();
  const r = await h.command.cancelTask(OPERATOR, { taskId: "  " });
  assert.equal(r.outcome, "rejected");
  assert.equal(r.errorKind, "invalid_request");
});

test("errorKind: forbidden when the role lacks the capability", async () => {
  const h = harness();
  const r = await h.command.approve(VIEWER, { approvalId: "whatever" });
  assert.equal(r.outcome, "denied");
  assert.equal(r.errorKind, "forbidden");
});

test("errorKind: not_found for an unknown resource", async () => {
  const h = harness();
  const task = await h.command.retryTask(OPERATOR, { taskId: "ghost" });
  assert.equal(task.errorKind, "not_found");
  const wf = await h.command.cancelWorkflow(OPERATOR, { workflowId: "ghost" });
  assert.equal(wf.errorKind, "not_found");
  const agent = await h.command.disableAgent(ADMIN, { agentId: "ghost" });
  assert.equal(agent.errorKind, "not_found");
});

test("errorKind: invalid_state for a bad transition", async () => {
  const h = harness();
  const t = h.tasks.create({
    type: "ops",
    description: "x",
    projectId: PROJECT,
  });
  h.tasks.transition(t.id, "queued");
  h.tasks.assign(t.id, "research-agent");
  h.tasks.complete(t.id, {});
  const r = await h.command.cancelTask(OPERATOR, { taskId: t.id });
  assert.equal(r.outcome, "rejected");
  assert.equal(r.errorKind, "invalid_state");

  const nonRetryable = await h.command.retryTask(OPERATOR, {
    taskId: failedTask(h, "permission_denied").id,
  });
  assert.equal(nonRetryable.errorKind, "invalid_state");
});

test("errorKind: approval_failure when the core decision throws", async () => {
  const h = harness({ throwingOrchestrator: true });
  const t = h.tasks.create({
    type: "ops",
    description: "x",
    projectId: PROJECT,
  });
  const approval = h.approvals.request({
    action: "ops-run",
    requestedBy: "research-agent",
    reason: "needs sign-off",
    metadata: { taskId: t.id },
  });
  const r = await h.command.approve(OPERATOR, { approvalId: approval.id });
  assert.equal(r.outcome, "rejected");
  assert.equal(r.errorKind, "approval_failure");
  assert.doesNotMatch(r.reason, /\bat \w+.*:\d+:\d+/); // no stack trace
});

test("errorKind: classifyErrorKind maps the WorkforceError hierarchy", () => {
  assert.equal(classifyErrorKind(new ValidationError("x")), "invalid_request");
  assert.equal(classifyErrorKind(new NotFoundError("x")), "not_found");
  assert.equal(classifyErrorKind(new ForbiddenError("x")), "forbidden");
  assert.equal(
    classifyErrorKind(new InvalidControlStateError("x")),
    "invalid_state",
  );
  assert.equal(classifyErrorKind(new Error("x")), "command_failure");
  assert.equal(CONTROL_ERROR_KINDS.length, 7);
});

/* ================================================================== */
/* UNKNOWN health                                                      */
/* ================================================================== */

test("health: an unmeasured component is `unknown`, not `degraded`", () => {
  const h = harness();
  const health = h.query.getSystemHealth(VIEWER);
  const provider = health.components.find((c) => c.name === "model-provider");
  assert.equal(provider!.status, "unknown");
  // No component is failing, so overall is `unknown` (not `degraded`).
  assert.equal(health.status, "unknown");
  // Back-compat alias resolves to the same component set.
  assert.deepEqual(
    h.query.getHealth(VIEWER).components.map((c) => [c.name, c.status]),
    health.components.map((c) => [c.name, c.status]),
  );
});

test("health: a real degraded probe still outranks unknown", () => {
  const h = harness();
  h.ctx.healthProbes = [
    {
      name: "queue",
      check: () => ({ status: "degraded", detail: "backed up" }),
    },
  ];
  const q = new WorkforceQueryService(h.ctx);
  assert.equal(q.getSystemHealth(VIEWER).status, "degraded");
});

/* ================================================================== */
/* Extra query filters                                                 */
/* ================================================================== */

test("query: tasks filter by createdAfter / createdBefore", () => {
  const h = harness();
  // `createdAt` is real wall-clock time, so adjacent tasks can share a
  // millisecond — assert the filter boundaries against fixed timestamps.
  const t = h.tasks.create({
    type: "ops",
    description: "a",
    projectId: PROJECT,
  });
  const PAST = "2000-01-01T00:00:00.000Z";
  const FUTURE = "2999-01-01T00:00:00.000Z";

  assert.equal(
    h.query.getTasks(OPERATOR, { createdAfter: PAST }).items.length,
    1,
  );
  assert.equal(
    h.query.getTasks(OPERATOR, { createdAfter: FUTURE }).items.length,
    0,
  );
  assert.equal(
    h.query.getTasks(OPERATOR, { createdBefore: PAST }).items.length,
    0,
  );
  assert.equal(
    h.query.getTasks(OPERATOR, { createdBefore: t.createdAt }).items.length,
    1,
  );
});

test("query: audit events filter by actor", async () => {
  const h = harness();
  const live = h.tasks.create({
    type: "ops",
    description: "l",
    projectId: PROJECT,
  });
  await h.command.cancelTask(OPERATOR, { taskId: live.id });

  const mine = h.query.getAuditEvents(ADMIN, { actor: OPERATOR.id });
  assert.ok(mine.items.length >= 1);
  assert.ok(mine.items.every((e) => e.actor === OPERATOR.id));
  const none = h.query.getAuditEvents(ADMIN, { actor: "nobody" });
  assert.equal(none.items.length, 0);
});

/* ================================================================== */
/* Event-publisher port                                                */
/* ================================================================== */

test("events: a successful command publishes exactly one command_result", async () => {
  const h = harness();
  const live = h.tasks.create({
    type: "ops",
    description: "l",
    projectId: PROJECT,
  });
  const r = await h.command.cancelTask(OPERATOR, { taskId: live.id });
  const published = h.events.seen.filter((e) => e.kind === "command_result");
  assert.equal(published.length, 1);
  assert.equal(
    (published[0] as { result: { correlationId: string } }).result
      .correlationId,
    r.correlationId,
  );
});

test("events: a throwing publisher never breaks the command", async () => {
  const h = harness();
  h.events.throwOnNext = true;
  const live = h.tasks.create({
    type: "ops",
    description: "l",
    projectId: PROJECT,
  });
  const r = await h.command.cancelTask(OPERATOR, { taskId: live.id });
  assert.equal(r.outcome, "executed");
  assert.equal(h.tasks.require(live.id).status, "cancelled");
});

/* ================================================================== */
/* Security regressions (§23)                                          */
/* ================================================================== */

test("security: deny-by-default — an unknown role is refused with an errorKind", async () => {
  const h = harness();
  const rogue = {
    id: "x",
    role: "superuser",
    allowedProjects: "*",
  } as unknown as OperatorPrincipal;
  const live = h.tasks.create({
    type: "ops",
    description: "l",
    projectId: PROJECT,
  });
  const r = await h.command.cancelTask(rogue, { taskId: live.id });
  assert.equal(r.ok, false);
  assert.ok(r.errorKind);
});

test("security: project isolation — a scoped operator cannot touch another project", async () => {
  const h = harness();
  const live = h.tasks.create({
    type: "ops",
    description: "l",
    projectId: PROJECT,
  });
  const r = await h.command.cancelTask(SCOPED, { taskId: live.id });
  assert.equal(r.outcome, "denied");
  assert.equal(r.errorKind, "forbidden");
  assert.equal(h.tasks.require(live.id).status, "created");
  // ...and it is invisible to queries.
  assert.equal(h.query.getTasks(SCOPED).items.length, 0);
});

test("security: secret redaction — a secret in a command reason never reaches the audit log", async () => {
  const h = harness();
  const r = await h.command.disableAgent(
    ADMIN,
    {
      agentId: "research-agent",
      reason: "rotating token sk-ant-LEAKME-0123456789abcdef now",
    },
    { correlationId: "corr-secret" },
  );
  assert.equal(r.outcome, "executed");
  assert.doesNotMatch(JSON.stringify(r), /sk-ant-LEAKME/);
  const dump = JSON.stringify(h.query.getAuditEvents(ADMIN, {}).items);
  assert.ok(dump.includes("corr-secret")); // the event is there
  assert.doesNotMatch(dump, /sk-ant-LEAKME/); // but the secret is not
});
