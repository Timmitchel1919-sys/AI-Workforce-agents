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
import { makeInMemoryTool } from "../adapters/index.js";
import {
  AgentOperationalStore,
  WorkflowControlStore,
  WorkforceCommandService,
  WorkforceQueryService,
  type ControlPlaneContext,
} from "../control/index.js";

/* ------------------------------------------------------------------ */
/* Harness                                                            */
/* ------------------------------------------------------------------ */

const PROJECT = "money-mind";
const OTHER = "aims";

function makeAgent(id: string, over: Partial<Agent> = {}): Agent {
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
    ...over,
  };
}

function stubAdapter(
  projectId: string,
  displayName: string,
  fail = false,
): ProjectAdapter {
  return {
    projectId,
    async describe() {
      if (fail) throw new Error("adapter offline");
      return {
        name: displayName,
        capabilities: [
          {
            operation: "read-status",
            description: "Read project status",
            action: "read",
          },
        ],
      };
    },
    async execute() {
      return {};
    },
  };
}

const GRANTS: PermissionGrant[] = [
  { effect: "allow", action: "read", projectId: PROJECT },
  { effect: "allow", action: "execute", projectId: PROJECT },
];

function harness(
  opts: { approvalRequired?: boolean; adapterFails?: boolean } = {},
) {
  const audit = new AuditLog();
  const agents = new AgentRegistry();
  agents.register(
    makeAgent("research-agent", {
      capabilities: ["web_research"],
      supportedTaskTypes: ["ops", "research"],
    }),
  );
  agents.register(makeAgent("qa-agent", { capabilities: ["qa"] }));

  const tasks = new TaskSystem();
  const workflows = new WorkflowSystem();
  const approvals = new ApprovalSystem();
  const permissions = new PermissionSystem(GRANTS);
  const handoffs = new HandoffSystem();

  const tools = new ToolRegistry(audit);
  tools.register(
    makeInMemoryTool(
      {
        id: "mm.read-status",
        name: "Read Status",
        description: "read status",
        version: "1.0.0",
        capabilities: ["read"],
        requiredPermission: { action: "read" },
        allowedAgents: ["research-agent"],
        allowedProjects: [PROJECT],
        allowedEnvironments: ["local", "test"],
        timeoutMs: 1000,
        limits: {
          maxCallsPerTask: 10,
          maxCallsPerAgent: 50,
          maxDurationMs: 1000,
          maxInputBytes: 4096,
          maxOutputBytes: 4096,
        },
        metadata: {},
      },
      () => ({ ok: true }),
    ),
  );
  tools.register(
    makeInMemoryTool(
      {
        id: "mm.run-tests",
        name: "Run Tests",
        description: "run allowlisted npm script",
        version: "1.0.0",
        capabilities: ["execute"],
        requiredPermission: { action: "execute" },
        approvalPolicy: {
          always: true,
          reason: "running tests needs sign-off",
        },
        allowedAgents: ["qa-agent"],
        allowedProjects: [PROJECT],
        allowedEnvironments: ["local", "test"],
        timeoutMs: 1000,
        limits: {
          maxCallsPerTask: 5,
          maxCallsPerAgent: 20,
          maxDurationMs: 1000,
          maxInputBytes: 4096,
          maxOutputBytes: 4096,
        },
        metadata: {},
      },
      () => ({ passed: true }),
    ),
  );

  const projects = new ProjectRegistry();
  projects.register(stubAdapter(PROJECT, "Money Mind", opts.adapterFails), {
    displayName: "Money Mind",
  });

  const agentOps = new AgentOperationalStore();
  const workflowControl = new WorkflowControlStore();

  const executed: string[] = [];
  const orchestrator = new Orchestrator(
    agents,
    tasks,
    handoffs,
    audit,
    {
      execute: async (agent, task) => {
        executed.push(`${agent.id}:${task.id}`);
        return { ok: true };
      },
    },
    approvals,
    {
      permissions,
      agentGate: agentOps,
      approvalPolicy: {
        evaluate: () =>
          opts.approvalRequired
            ? { required: true, action: "ops-run", reason: "policy" }
            : { required: false },
      },
    },
  );

  const workflowEngine = {
    resume: async (id: string) => workflows.transition(id, "running"),
  };

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
    orchestrator,
    workflowEngine,
  };

  return {
    ctx,
    audit,
    agents,
    tasks,
    workflows,
    approvals,
    agentOps,
    workflowControl,
    orchestrator,
    executed,
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

async function seedTask(
  h: ReturnType<typeof harness>,
  over: { type?: string; project?: string; input?: unknown } = {},
) {
  return h.orchestrator.submit({
    type: over.type ?? "ops",
    description: "seed task",
    projectId: over.project ?? PROJECT,
    input: over.input ?? { note: "hello" },
  });
}

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

test("query: workforce status reflects real task + agent + project counts", async () => {
  const h = harness();
  await seedTask(h);
  const status = h.query.getWorkforceStatus(VIEWER);
  assert.equal(status.counts.registeredAgents, 2);
  assert.equal(status.counts.registeredProjects, 1);
  assert.equal(status.counts.availableTools, 2);
  assert.equal(status.counts.completedTasks, 1);
  assert.ok(status.recentActivity.length > 0);
});

test("query: agents view + status derivation (idle → busy → disabled)", async () => {
  const h = harness();
  let agent = h.query.getAgent(VIEWER, "research-agent")!;
  assert.equal(agent.status, "idle");
  assert.equal(agent.role, "research");

  await seedTask(h, { type: "research" });
  agent = h.query.getAgent(VIEWER, "research-agent")!;
  assert.equal(agent.stats.taskCount, 1);
  assert.equal(agent.stats.completed, 1);
  assert.equal(agent.status, "available");

  await h.command.disableAgent(ADMIN, {
    agentId: "research-agent",
    reason: "maintenance",
  });
  agent = h.query.getAgent(VIEWER, "research-agent")!;
  assert.equal(agent.status, "disabled");
  assert.equal(agent.enabled, false);
  assert.match(agent.disabledReason ?? "", /maintenance/);
});

test("query: task filtering + pagination + redaction", async () => {
  const h = harness();
  for (let i = 0; i < 5; i++) {
    await seedTask(h, {
      input: { note: `t${i}`, apiKey: "sk-ant-SUPERSECRET-abcdefghijklmnop" },
    });
  }
  const page1 = h.query.getTasks(VIEWER, { limit: 2 });
  assert.equal(page1.items.length, 2);
  assert.equal(page1.total, 5);
  assert.ok(page1.nextCursor);
  const page2 = h.query.getTasks(VIEWER, {
    limit: 2,
    cursor: page1.nextCursor!,
  });
  assert.equal(page2.items.length, 2);

  const completed = h.query.getTasks(VIEWER, { status: "completed" });
  assert.equal(completed.items.length, 5);

  const detail = h.query.getTask(VIEWER, page1.items[0]!.taskId)!;
  assert.ok(!JSON.stringify(detail).includes("SUPERSECRET"));
  assert.ok(!(detail.redactedInputKeys ?? []).includes("apiKey"));
  assert.ok((detail.redactedInputKeys ?? []).includes("note"));
});

test("query: workflow progress comes from real task records", async () => {
  const h = harness();
  const wf = h.workflows.create({
    name: "Ship it",
    description: "two-step",
    projectId: PROJECT,
    participatingAgents: ["research-agent", "qa-agent"],
    tasks: [
      {
        id: "a",
        type: "research",
        description: "research",
        agentId: "research-agent",
      },
      {
        id: "b",
        type: "qa",
        description: "qa",
        agentId: "qa-agent",
        dependsOn: ["a"],
      },
    ],
  });
  h.workflows.updateTaskRecord(wf.id, "a", { status: "completed" });
  h.workflows.transition(wf.id, "planned");
  h.workflows.transition(wf.id, "running");

  const view = h.query.getWorkflow(VIEWER, wf.id)!;
  assert.equal(view.progress.completed, 1);
  assert.equal(view.progress.total, 2);
  assert.equal(view.progress.fraction, 0.5);
  assert.equal(view.stages.length, 2);
  assert.equal(view.stages[0]!.status, "completed");
});

test("query: approvals view classifies risk from the action", async () => {
  const h = harness();
  h.approvals.request({
    action: "tool:mm.read-status:read",
    requestedBy: "research-agent",
    reason: "read the status file",
  });
  h.approvals.request({
    action: "tool:mm.run-tests:execute",
    requestedBy: "qa-agent",
    reason: "run the test suite before deploy",
  });
  const views = h.query.getApprovals(OPERATOR, { status: "requested" });
  assert.equal(views.length, 2);
  const byTool = Object.fromEntries(views.map((v) => [v.toolId, v.risk]));
  assert.equal(byTool["mm.read-status"], "low");
  assert.equal(byTool["mm.run-tests"], "high");
});

test("query: projects come from the ProjectRegistry, not a hard-coded id", async () => {
  const h = harness();
  const projects = await h.query.getProjects(VIEWER);
  assert.equal(projects.length, 1);
  assert.equal(projects[0]!.projectId, PROJECT);
  assert.equal(projects[0]!.displayName, "Money Mind");
  assert.equal(projects[0]!.status, "available");
  assert.ok(
    projects[0]!.capabilities.some((c) => c.operation === "read-status"),
  );
  assert.ok(projects[0]!.connectedAgents.includes("research-agent"));
});

test("query: a failing project adapter is reported unavailable, not healthy", async () => {
  const h = harness({ adapterFails: true });
  const project = await h.query.getProject(VIEWER, PROJECT);
  assert.equal(project!.status, "unavailable");
  assert.equal(project!.adapterStatus, "unavailable");
});

test("query: tools view exposes policy metadata but no credentials", async () => {
  const h = harness();
  const tools = h.query.getTools(VIEWER);
  assert.equal(tools.length, 2);
  const runTests = tools.find((t) => t.toolId === "mm.run-tests")!;
  assert.equal(runTests.approvalRequired, true);
  assert.equal(runTests.requiredPermission, "execute");
  assert.deepEqual(runTests.allowedAgents, ["qa-agent"]);
  assert.ok(!JSON.stringify(tools).toLowerCase().includes("apikey"));
});

test("query: audit events filter + paginate + redact", async () => {
  const h = harness();
  await seedTask(h);
  await h.command.cancelTask(OPERATOR, { taskId: "nope" }); // produces control_command

  const controlEvents = h.query.getAuditEvents(VIEWER, {
    type: "control_command",
  });
  assert.ok(controlEvents.items.length >= 1);
  assert.ok(controlEvents.items.every((e) => e.type === "control_command"));

  const projectEvents = h.query.getAuditEvents(VIEWER, { projectId: PROJECT });
  assert.ok(projectEvents.items.length > 0);

  const page = h.query.getAuditEvents(VIEWER, { limit: 1 });
  assert.equal(page.items.length, 1);
  assert.ok(page.total > 1);
});

test("query: health never claims an unchecked provider is healthy", () => {
  const h = harness();
  const health = h.query.getHealth(VIEWER);
  const provider = health.components.find((c) => c.name === "model-provider");
  assert.ok(provider);
  assert.equal(provider!.status, "degraded");
  assert.match(provider!.detail, /unknown|not checked/i);
});

test("query: dashboard snapshot bundles every view", async () => {
  const h = harness();
  await seedTask(h);
  const snap = await h.query.getDashboardSnapshot(OPERATOR);
  assert.equal(snap.operator.id, "operator-1");
  assert.ok(snap.status);
  assert.ok(snap.health);
  assert.equal(snap.agents.length, 2);
  assert.ok(snap.projects.length === 1);
  assert.ok(snap.tools.length === 2);
  assert.equal(snap.error, undefined);
});

/* ================================================================== */
/* COMMANDS                                                            */
/* ================================================================== */

test("command: approve records the decision and enacts the task resume", async () => {
  const h = harness({ approvalRequired: true });
  const task = await seedTask(h);
  assert.equal(task.status, "awaiting_approval");
  const approvalId = task.approvalId!;

  const result = await h.command.approve(OPERATOR, { approvalId });
  assert.equal(result.outcome, "executed");
  assert.equal(result.ok, true);
  assert.equal(h.approvals.require(approvalId).status, "approved");
  assert.equal(h.tasks.require(task.id).status, "completed");
  assert.ok(result.auditEventId);
});

test("command: reject requires a reason and marks the approval rejected", async () => {
  const h = harness({ approvalRequired: true });
  const task = await seedTask(h);
  const approvalId = task.approvalId!;

  const missing = await h.command.reject(OPERATOR, {
    approvalId,
    reason: "",
  });
  assert.equal(missing.outcome, "rejected");
  assert.equal(h.approvals.require(approvalId).status, "requested");

  const done = await h.command.reject(OPERATOR, {
    approvalId,
    reason: "not now",
  });
  assert.equal(done.outcome, "executed");
  assert.equal(h.approvals.require(approvalId).status, "rejected");
});

test("command: retryTask re-queues a retryable failure, caps retries, rejects others", async () => {
  const h = harness();
  const t1 = h.tasks.create({
    type: "ops",
    description: "x",
    projectId: PROJECT,
  });
  h.tasks.transition(t1.id, "queued");
  h.tasks.assign(t1.id, "research-agent");
  h.tasks.fail(t1.id, "[research-agent:tool_failure] tool blew up");

  const ok = await h.command.retryTask(OPERATOR, { taskId: t1.id });
  assert.equal(ok.outcome, "executed");
  assert.equal(h.tasks.require(t1.id).status, "queued");

  // non-retryable
  const t2 = h.tasks.create({
    type: "ops",
    description: "y",
    projectId: PROJECT,
  });
  h.tasks.transition(t2.id, "queued");
  h.tasks.assign(t2.id, "research-agent");
  h.tasks.fail(t2.id, "[research-agent:permission_denied] nope");
  const bad = await h.command.retryTask(OPERATOR, { taskId: t2.id });
  assert.equal(bad.outcome, "rejected");
  assert.match(bad.reason, /not retryable/);

  // completed task
  const t3 = h.tasks.create({
    type: "ops",
    description: "z",
    projectId: PROJECT,
  });
  h.tasks.transition(t3.id, "queued");
  h.tasks.assign(t3.id, "research-agent");
  h.tasks.complete(t3.id, {});
  const done = await h.command.retryTask(OPERATOR, { taskId: t3.id });
  assert.equal(done.outcome, "rejected");
});

test("command: cancelTask cancels a live task, rejects a terminal one", async () => {
  const h = harness();
  const live = h.tasks.create({
    type: "ops",
    description: "live",
    projectId: PROJECT,
  });
  const r1 = await h.command.cancelTask(OPERATOR, {
    taskId: live.id,
    reason: "operator stop",
  });
  assert.equal(r1.outcome, "executed");
  assert.equal(h.tasks.require(live.id).status, "cancelled");

  const done = await seedTask(h); // completes
  const r2 = await h.command.cancelTask(OPERATOR, { taskId: done.id });
  assert.equal(r2.outcome, "rejected");
});

test("command: pause / resume / cancel workflow", async () => {
  const h = harness();
  const mkWf = () =>
    h.workflows.create({
      name: "wf",
      description: "d",
      projectId: PROJECT,
      participatingAgents: ["qa-agent"],
      tasks: [{ id: "a", type: "qa", description: "qa", agentId: "qa-agent" }],
    });

  const wf = mkWf();
  h.workflows.transition(wf.id, "planned");
  h.workflows.transition(wf.id, "running");

  const paused = await h.command.pauseWorkflow(OPERATOR, {
    workflowId: wf.id,
    reason: "hold",
  });
  assert.equal(paused.outcome, "executed");
  assert.equal(h.workflowControl.isPaused(wf.id), true);

  const dbl = await h.command.pauseWorkflow(OPERATOR, { workflowId: wf.id });
  assert.equal(dbl.outcome, "rejected");

  const resumed = await h.command.resumeWorkflow(OPERATOR, {
    workflowId: wf.id,
  });
  assert.equal(resumed.outcome, "executed");
  assert.equal(h.workflowControl.isPaused(wf.id), false);

  const notPaused = await h.command.resumeWorkflow(OPERATOR, {
    workflowId: wf.id,
  });
  assert.equal(notPaused.outcome, "rejected");

  const cancelled = await h.command.cancelWorkflow(OPERATOR, {
    workflowId: wf.id,
    reason: "done here",
  });
  assert.equal(cancelled.outcome, "executed");
  assert.equal(h.workflows.require(wf.id).status, "cancelled");
});

test("command: disableAgent blocks new task dispatch; enableAgent restores it", async () => {
  const h = harness();
  const off = await h.command.disableAgent(ADMIN, {
    agentId: "research-agent",
    reason: "quarantine",
  });
  assert.equal(off.outcome, "executed");
  assert.equal(h.agentOps.isEnabled("research-agent"), false);

  const blocked = await seedTask(h, { type: "research" });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.metadata.blockedReason, "agent_disabled");

  const on = await h.command.enableAgent(ADMIN, { agentId: "research-agent" });
  assert.equal(on.outcome, "executed");
  const ok = await seedTask(h, { type: "research" });
  assert.equal(ok.status, "completed");
});

/* ================================================================== */
/* SECURITY                                                            */
/* ================================================================== */

test("security: viewer cannot approve or disable, and it is audited", async () => {
  const h = harness({ approvalRequired: true });
  const task = await seedTask(h);
  const denied = await h.command.approve(VIEWER, {
    approvalId: task.approvalId!,
  });
  assert.equal(denied.outcome, "denied");
  assert.equal(h.approvals.require(task.approvalId!).status, "requested");

  const denied2 = await h.command.disableAgent(VIEWER, {
    agentId: "qa-agent",
  });
  assert.equal(denied2.outcome, "denied");

  const events = h.query
    .getAuditEvents(ADMIN, { type: "control_command" })
    .items.filter((e) => e.outcome === "denied");
  assert.ok(events.length >= 2);
});

test("security: operator cannot perform an admin-only action", async () => {
  const h = harness();
  const denied = await h.command.disableAgent(OPERATOR, {
    agentId: "qa-agent",
  });
  assert.equal(denied.outcome, "denied");
  assert.equal(h.agentOps.isEnabled("qa-agent"), true);
});

test("security: a project-scoped operator cannot see or act on other projects", async () => {
  const h = harness();
  const task = await seedTask(h);
  assert.equal(h.query.getTasks(SCOPED, {}).items.length, 0);

  const denied = await h.command.cancelTask(SCOPED, { taskId: task.id });
  assert.equal(denied.outcome, "denied");
  assert.match(denied.reason, /project/);
});

test("security: an unknown role is denied everything", () => {
  const h = harness();
  const bad = { id: "x", role: "superuser", allowedProjects: "*" } as never;
  assert.throws(() => h.query.getWorkforceStatus(bad));
});

/* ================================================================== */
/* STATE VALIDATION                                                    */
/* ================================================================== */

test("state: invalid approve / retry / cancel / pause / resume are rejected", async () => {
  const h = harness({ approvalRequired: true });

  const parked = await seedTask(h);
  await h.command.approve(OPERATOR, { approvalId: parked.approvalId! });
  const twice = await h.command.approve(OPERATOR, {
    approvalId: parked.approvalId!,
  });
  assert.equal(twice.outcome, "rejected");

  const unknownRetry = await h.command.retryTask(OPERATOR, { taskId: "ghost" });
  assert.equal(unknownRetry.outcome, "rejected");

  const unknownCancel = await h.command.cancelTask(OPERATOR, { taskId: "" });
  assert.equal(unknownCancel.outcome, "rejected");

  const wf = h.workflows.create({
    name: "term",
    description: "d",
    projectId: PROJECT,
    participatingAgents: ["qa-agent"],
    tasks: [{ id: "a", type: "qa", description: "qa", agentId: "qa-agent" }],
  });
  h.workflows.transition(wf.id, "planned");
  h.workflows.transition(wf.id, "running");
  h.workflows.transition(wf.id, "completed");
  const pauseTerminal = await h.command.pauseWorkflow(OPERATOR, {
    workflowId: wf.id,
  });
  assert.equal(pauseTerminal.outcome, "rejected");
  const resumeTerminal = await h.command.resumeWorkflow(OPERATOR, {
    workflowId: wf.id,
  });
  assert.equal(resumeTerminal.outcome, "rejected");
});

/* ================================================================== */
/* AUDIT                                                               */
/* ================================================================== */

test("audit: every control command emits a control_command event", async () => {
  const h = harness();
  const before = h.audit.query({ type: "control_command" }).length;
  await h.command.cancelTask(OPERATOR, { taskId: "missing" }); // rejected
  await h.command.disableAgent(VIEWER, { agentId: "qa-agent" }); // denied
  await h.command.disableAgent(ADMIN, { agentId: "qa-agent" }); // executed
  const after = h.audit.query({ type: "control_command" });
  assert.equal(after.length - before, 3);
  const outcomes = after.slice(-3).map((e) => e.data.outcome);
  assert.deepEqual(outcomes, ["rejected", "denied", "executed"]);
});

test("audit: secrets in task metadata never reach a view or the audit log", async () => {
  const h = harness();
  const t = h.tasks.create({
    type: "ops",
    description: "s",
    projectId: PROJECT,
    metadata: { apiKey: "sk-ant-LEAKME-0123456789abcdef", note: "safe" },
  });
  const view = h.query.getTask(ADMIN, t.id)!;
  assert.ok(!JSON.stringify(view).includes("LEAKME"));

  await h.command.cancelTask(OPERATOR, {
    taskId: t.id,
    reason: "token=sk-ant-LEAKME-0123456789abcdef",
  });
  const dump = JSON.stringify(h.audit.list());
  assert.ok(!dump.includes("LEAKME"));
});
