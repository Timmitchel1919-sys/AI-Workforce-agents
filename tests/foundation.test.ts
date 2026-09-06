import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  ContextSystem,
  HandoffSystem,
  Orchestrator,
  PermissionSystem,
  PermissionDeniedError,
  StateTransitionError,
  TaskSystem,
  ValidationError,
  type Agent,
  type HandoffDraft,
  type TaskContext,
} from "../core/index.js";
import {
  BaseProjectAdapter,
  EchoModelProvider,
  InMemoryToolProvider,
  type ProjectOperation,
} from "../adapters/index.js";

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

const makeAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: "developer",
  name: "Developer",
  description: "Implements code changes",
  capabilities: ["code"],
  allowedTools: ["files"],
  allowedProjects: ["money-mind"],
  supportedTaskTypes: ["implementation"],
  permissions: [],
  ...overrides,
});

const taskDraft = () => ({
  type: "implementation",
  description: "Build a feature",
  projectId: "money-mind",
  input: { spec: "x" },
});

const handoffDraft = (overrides: Partial<HandoffDraft> = {}): HandoffDraft => ({
  taskId: "task_1",
  sourceAgentId: "alpha",
  destinationAgentId: "beta",
  completedWork: "wrote the parser",
  remainingWork: "wire up the CLI",
  acceptanceCriteria: ["cli prints help"],
  context: {},
  artifacts: [],
  risks: [],
  ...overrides,
});

/* ------------------------------------------------------------------ */
/* Agent registry                                                     */
/* ------------------------------------------------------------------ */

test("agent registry: registers and looks up by id and capability", () => {
  const registry = new AgentRegistry();
  registry.register(makeAgent());

  assert.equal(registry.get("developer")?.name, "Developer");
  assert.deepEqual(
    registry.byCapability("code").map((a) => a.id),
    ["developer"],
  );
  assert.equal(registry.byCapability("design").length, 0);
});

test("agent registry: rejects duplicate registration", () => {
  const registry = new AgentRegistry();
  registry.register(makeAgent());
  assert.throws(() => registry.register(makeAgent()), /already registered/);
});

test("agent registry: validation rejects blank id and empty capabilities", () => {
  const registry = new AgentRegistry();
  assert.throws(
    () => registry.register(makeAgent({ id: "  " })),
    ValidationError,
  );
  assert.throws(
    () => registry.register(makeAgent({ capabilities: [] })),
    /capabilities must not be empty/,
  );
});

test("agent registry: validation rejects an unknown permission action", () => {
  const registry = new AgentRegistry();
  assert.throws(
    () =>
      registry.register(
        makeAgent({
          permissions: [
            // deliberately invalid action
            { effect: "allow", action: "teleport" as never },
          ],
        }),
      ),
    /not a known permission action/,
  );
});

test("agent registry: eligible filters by task type AND project", () => {
  const registry = new AgentRegistry();
  registry.register(makeAgent({ id: "a", allowedProjects: ["aims"] }));
  registry.register(makeAgent({ id: "b", supportedTaskTypes: ["review"] }));
  registry.register(makeAgent({ id: "c" }));

  assert.deepEqual(
    registry.eligible("implementation", "money-mind").map((a) => a.id),
    ["c"],
  );
});

test("agent registry: stored agent is frozen", () => {
  const registry = new AgentRegistry();
  const stored = registry.register(makeAgent());
  assert.throws(() => {
    (stored as { name: string }).name = "mutated";
  }, TypeError);
});

/* ------------------------------------------------------------------ */
/* Task system                                                        */
/* ------------------------------------------------------------------ */

test("task system: create validates required fields", () => {
  const tasks = new TaskSystem();
  assert.throws(
    () =>
      tasks.create({ type: "", description: "d", projectId: "p", input: {} }),
    /task.type/,
  );
  assert.throws(
    () =>
      tasks.create({ type: "t", description: " ", projectId: "p", input: {} }),
    /task.description/,
  );
  assert.throws(
    () =>
      tasks.create({ type: "t", description: "d", projectId: "", input: {} }),
    /task.projectId/,
  );
});

test("task system: create applies deterministic defaults", () => {
  const tasks = new TaskSystem();
  const task = tasks.create({
    type: "implementation",
    description: "Build",
    projectId: "money-mind",
  });
  assert.equal(task.status, "created");
  assert.equal(task.priority, "normal");
  assert.deepEqual(task.errors, []);
  assert.equal(task.input, null);
  assert.equal(task.createdAt, task.updatedAt);
});

test("task system: walks the happy-path lifecycle", () => {
  const tasks = new TaskSystem();
  const task = tasks.create(taskDraft());
  assert.equal(tasks.transition(task.id, "queued").status, "queued");
  const running = tasks.assign(task.id, "developer");
  assert.equal(running.status, "running");
  assert.equal(running.assignedAgentId, "developer");
  const done = tasks.complete(task.id, { ok: true });
  assert.equal(done.status, "completed");
  assert.deepEqual(done.output, { ok: true });
});

test("task system: rejects invalid transitions", () => {
  const tasks = new TaskSystem();
  const task = tasks.create(taskDraft());
  assert.throws(
    () => tasks.transition(task.id, "completed"),
    StateTransitionError,
  );
  tasks.transition(task.id, "queued");
  tasks.assign(task.id, "developer");
  tasks.complete(task.id, {});
  // completed is terminal
  assert.throws(
    () => tasks.transition(task.id, "queued"),
    /invalid task transition: completed -> queued/,
  );
});

test("task system: fail records an error and can be retried", () => {
  const tasks = new TaskSystem();
  const task = tasks.create(taskDraft());
  tasks.transition(task.id, "queued");
  tasks.assign(task.id, "developer");
  const failed = tasks.fail(task.id, "boom");
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.errors, ["boom"]);
  assert.equal(tasks.transition(task.id, "queued").status, "queued");
});

test("task system: unknown task id throws", () => {
  const tasks = new TaskSystem();
  assert.throws(() => tasks.transition("nope", "queued"), /unknown task/);
});

/* ------------------------------------------------------------------ */
/* Handoff system                                                     */
/* ------------------------------------------------------------------ */

test("handoff system: rejects same source and destination", () => {
  const handoffs = new HandoffSystem();
  assert.throws(
    () => handoffs.propose(handoffDraft({ destinationAgentId: "alpha" })),
    /must differ/,
  );
});

test("handoff system: requires acceptance criteria", () => {
  const handoffs = new HandoffSystem();
  assert.throws(
    () => handoffs.propose(handoffDraft({ acceptanceCriteria: [] })),
    /acceptanceCriteria must not be empty/,
  );
});

test("handoff system: propose then accept, and re-accept fails", () => {
  const handoffs = new HandoffSystem();
  const proposed = handoffs.propose(handoffDraft());
  assert.equal(proposed.status, "proposed");

  const accepted = handoffs.accept(proposed.id);
  assert.equal(accepted.status, "accepted");
  assert.ok(accepted.resolvedAt);
  assert.equal(handoffs.forTask("task_1")[0]?.id, accepted.id);

  assert.throws(() => handoffs.accept(proposed.id), StateTransitionError);
});

test("handoff system: reject records a reason", () => {
  const handoffs = new HandoffSystem();
  const proposed = handoffs.propose(handoffDraft());
  const rejected = handoffs.reject(proposed.id, "criteria unclear");
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.resolution, "criteria unclear");
});

/* ------------------------------------------------------------------ */
/* Permission system                                                  */
/* ------------------------------------------------------------------ */

test("permissions: deny by default", () => {
  const decision = new PermissionSystem().evaluate({
    agentId: "a",
    projectId: "p",
    action: "write",
    environment: "production",
  });
  assert.deepEqual(decision, { allowed: false, reason: "deny by default" });
});

test("permissions: an explicit, precisely scoped grant allows", () => {
  const system = new PermissionSystem([
    {
      effect: "allow",
      action: "read",
      agentId: "a",
      projectId: "p",
      environment: "local",
    },
  ]);
  assert.equal(
    system.evaluate({
      agentId: "a",
      projectId: "p",
      action: "read",
      environment: "local",
    }).allowed,
    true,
  );
  // wrong environment -> falls back to deny by default
  assert.equal(
    system.evaluate({
      agentId: "a",
      projectId: "p",
      action: "read",
      environment: "production",
    }).allowed,
    false,
  );
});

test("permissions: explicit deny beats explicit allow", () => {
  const system = new PermissionSystem([
    { effect: "allow", action: "deploy", projectId: "p" },
    {
      effect: "deny",
      action: "deploy",
      projectId: "p",
      environment: "production",
    },
  ]);
  const decision = system.evaluate({
    agentId: "a",
    projectId: "p",
    action: "deploy",
    environment: "production",
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "explicit deny");
});

test("permissions: assert throws PermissionDeniedError when denied", () => {
  const system = new PermissionSystem();
  assert.throws(
    () =>
      system.assert({
        agentId: "a",
        projectId: "p",
        action: "secret_access",
        environment: "local",
      }),
    PermissionDeniedError,
  );
});

/* ------------------------------------------------------------------ */
/* Approval system                                                    */
/* ------------------------------------------------------------------ */

test("approval system: request then approve with decision metadata", () => {
  const approvals = new ApprovalSystem();
  const pending = approvals.request({
    action: "deploy money-mind",
    requestedBy: "orchestrator",
    reason: "release 1.2.0",
  });
  assert.equal(pending.status, "requested");

  const decided = approvals.decide(pending.id, "approved", "human:sam", {
    ticket: "OPS-14",
  });
  assert.equal(decided.status, "approved");
  assert.equal(decided.decidedBy, "human:sam");
  assert.equal(decided.decisionMetadata.ticket, "OPS-14");

  assert.throws(
    () => approvals.decide(pending.id, "rejected", "human:sam"),
    /not pending/,
  );
});

test("approval system: expire and expireStale", () => {
  const approvals = new ApprovalSystem();
  const a = approvals.request({
    action: "write",
    requestedBy: "r",
    reason: "x",
  });
  assert.equal(approvals.expire(a.id).status, "expired");

  const b = approvals.request({
    action: "write",
    requestedBy: "r",
    reason: "y",
    expiresAt: "2000-01-01T00:00:00.000Z",
  });
  const c = approvals.request({
    action: "write",
    requestedBy: "r",
    reason: "z",
    expiresAt: "2999-01-01T00:00:00.000Z",
  });
  const expired = approvals.expireStale("2020-01-01T00:00:00.000Z");
  assert.deepEqual(
    expired.map((x) => x.id),
    [b.id],
  );
  assert.equal(approvals.get(c.id)?.status, "requested");
});

/* ------------------------------------------------------------------ */
/* Context system                                                     */
/* ------------------------------------------------------------------ */

test("context system: task context is isolated by project", () => {
  const context = new ContextSystem();
  context.setTaskContext("t1", "aims", { secret: "isolated" });

  assert.equal(context.getTaskContext("t1", "money-mind"), undefined);
  assert.equal(context.getTaskContext("t1", "aims")?.values.secret, "isolated");
});

test("context system: rebinding a task to another project throws", () => {
  const context = new ContextSystem();
  context.setTaskContext("t1", "aims", {});
  assert.throws(
    () => context.setTaskContext("t1", "money-mind", {}),
    /already bound to project aims/,
  );
});

test("context system: viewForProject never spans projects", () => {
  const context = new ContextSystem();
  context.setProjectContext("aims", { tier: "gold" });
  context.setTaskContext("t-aims", "aims", { a: 1 });
  context.setAgentContext("agent-1", "aims", { note: "ok" });
  context.setProjectContext("money-mind", { tier: "silver" });
  context.setTaskContext("t-mm", "money-mind", { b: 2 });

  const view = context.viewForProject("aims");
  assert.equal(view.length, 3);
  assert.ok(view.every((c) => "projectId" in c && c.projectId === "aims"));
});

test("context system: returned values are copies, not live references", () => {
  const context = new ContextSystem();
  context.setProjectContext("aims", { count: 1 });
  const first = context.getProjectContext("aims")!;
  first.values.count = 999;
  assert.equal(context.getProjectContext("aims")?.values.count, 1);
});

/* ------------------------------------------------------------------ */
/* Audit system                                                       */
/* ------------------------------------------------------------------ */

test("audit system: records structured events and queries them", () => {
  const audit = new AuditLog();
  audit.record("task_created", { taskId: "t1", projectId: "p", data: {} });
  audit.record("task_assigned", {
    taskId: "t1",
    agentId: "a1",
    projectId: "p",
    data: {},
  });
  audit.record("task_created", { taskId: "t2", projectId: "p", data: {} });

  assert.equal(audit.list().length, 3);
  assert.equal(audit.query({ type: "task_created" }).length, 2);
  assert.equal(audit.query({ taskId: "t1" }).length, 2);
  assert.equal(audit.query({ agentId: "a1" }).length, 1);
});

test("audit system: event data is copied on record", () => {
  const audit = new AuditLog();
  const data = { mutable: true };
  audit.record("task_created", { taskId: "t1", data });
  data.mutable = false;
  assert.equal(audit.list()[0]?.data.mutable, true);
});

/* ------------------------------------------------------------------ */
/* Provider + adapter interfaces (no real API calls)                  */
/* ------------------------------------------------------------------ */

test("model provider: EchoModelProvider is deterministic and offline", async () => {
  const provider = new EchoModelProvider();
  const response = await provider.generate({
    messages: [
      { role: "system", content: "be terse" },
      { role: "user", content: "hello" },
    ],
  });
  assert.equal(response.content, "echo: hello");
  assert.equal(response.model, "echo-1");
  assert.equal(response.usage?.outputTokens, "echo: hello".length);
});

test("tool provider: InMemoryToolProvider dispatches only declared tools", async () => {
  const ctx: TaskContext = {
    scope: "task",
    taskId: "t1",
    projectId: "money-mind",
    values: {},
  };
  const provider = new InMemoryToolProvider("dev-tools", {
    echo: (input) => input,
  });

  assert.deepEqual(provider.tools, ["echo"]);
  assert.deepEqual(
    (await provider.execute({ tool: "echo", input: { safe: 1 }, context: ctx }))
      .output,
    { safe: 1 },
  );
  await assert.rejects(
    provider.execute({ tool: "shell", input: {}, context: ctx }),
    /tool not registered/,
  );
});

test("project adapter: BaseProjectAdapter exposes only declared operations", async () => {
  class MoneyMindStub extends BaseProjectAdapter {
    readonly projectId = "money-mind";
    protected readonly displayName = "Money Mind";
    protected readonly operations: Record<string, ProjectOperation> = {
      "read-summary": {
        capability: {
          operation: "read-summary",
          description: "Read a high-level project summary",
          action: "read",
        },
        handler: () => ({ summary: "stub" }),
      },
    };
  }

  const adapter = new MoneyMindStub();
  const described = await adapter.describe();
  assert.equal(described.name, "Money Mind");
  assert.deepEqual(
    described.capabilities.map((c) => c.operation),
    ["read-summary"],
  );
  assert.deepEqual(await adapter.execute("read-summary", {}), {
    summary: "stub",
  });
  await assert.rejects(
    adapter.execute("drop-database", {}),
    /operation not exposed/,
  );
});

/* ------------------------------------------------------------------ */
/* Orchestrator                                                       */
/* ------------------------------------------------------------------ */

function buildOrchestrator(
  executor = {
    execute: async (agent: Agent) => ({ selected: agent.id }),
  },
) {
  const registry = new AgentRegistry();
  const tasks = new TaskSystem();
  const handoffs = new HandoffSystem();
  const audit = new AuditLog();
  const orchestrator = new Orchestrator(
    registry,
    tasks,
    handoffs,
    audit,
    executor,
  );
  return { registry, tasks, handoffs, audit, orchestrator };
}

test("orchestrator: routes deterministically and completes a task", async () => {
  const { registry, audit, orchestrator } = buildOrchestrator();
  registry.register(makeAgent({ id: "zeta" }));
  registry.register(makeAgent({ id: "alpha" }));

  const task = await orchestrator.submit(taskDraft());
  assert.equal(task.status, "completed");
  assert.equal(task.assignedAgentId, "alpha");
  assert.deepEqual(task.output, { selected: "alpha" });
  assert.deepEqual(
    audit.list().map((e) => e.type),
    ["task_created", "task_assigned", "agent_executed", "task_completed"],
  );
});

test("orchestrator: blocks a task when no agent is eligible", async () => {
  const { audit, orchestrator } = buildOrchestrator();
  const task = await orchestrator.submit(taskDraft());
  assert.equal(task.status, "blocked");
  assert.equal(task.metadata.blockedReason, "no eligible agent");
  assert.deepEqual(
    audit.list().map((e) => e.type),
    ["task_created", "task_assigned"],
  );
});

test("orchestrator: a throwing executor fails the task and audits it", async () => {
  const { registry, audit, orchestrator } = buildOrchestrator({
    execute: async () => {
      throw new Error("executor exploded");
    },
  });
  registry.register(makeAgent({ id: "alpha" }));

  const task = await orchestrator.submit(taskDraft());
  assert.equal(task.status, "failed");
  assert.deepEqual(task.errors, ["executor exploded"]);
  assert.equal(audit.list().at(-1)?.type, "task_failed");
});

test("orchestrator: handoff requires registered agents and an existing task", async () => {
  const { registry, tasks, orchestrator, audit } = buildOrchestrator();
  registry.register(makeAgent({ id: "alpha" }));
  registry.register(makeAgent({ id: "beta" }));
  const task = tasks.create(taskDraft());

  assert.throws(
    () =>
      orchestrator.requestHandoff(
        handoffDraft({ taskId: task.id, sourceAgentId: "ghost" }),
      ),
    /must be registered/,
  );
  assert.throws(
    () => orchestrator.requestHandoff(handoffDraft({ taskId: "missing" })),
    /task does not exist/,
  );

  const handoff = orchestrator.requestHandoff(
    handoffDraft({ taskId: task.id }),
  );
  assert.equal(handoff.status, "accepted");
  assert.equal(audit.list().at(-1)?.type, "handoff_created");
});
