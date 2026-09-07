import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentExecutionError,
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  HandoffSystem,
  NotFoundError,
  Orchestrator,
  PermissionSystem,
  RoutingAgentExecutor,
  StateTransitionError,
  TaskSystem,
  ToolRegistry,
  ValidationError,
  WorkflowEngine,
  WorkflowSystem,
  type Agent,
  type AgentExecutor,
  type AgentFailureReason,
  type PermissionGrant,
  type WorkflowDraft,
} from "../core/index.js";
import { makeInMemoryTool } from "../adapters/index.js";

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

function agentDef(id: string, over: Partial<Agent> = {}): Agent {
  return {
    id,
    name: id,
    description: `test agent ${id}`,
    capabilities: ["cap-a"],
    allowedTools: [],
    allowedProjects: ["proj-x"],
    supportedTaskTypes: ["typeA"],
    permissions: [],
    ...over,
  };
}

interface CountedExecutor {
  executor: AgentExecutor;
  counter: { calls: number };
}

function okExecutor(output: unknown = { ok: true }): CountedExecutor {
  const counter = { calls: 0 };
  return {
    counter,
    executor: {
      execute: async () => {
        counter.calls += 1;
        return output;
      },
    },
  };
}

function failExecutor(
  reason: AgentFailureReason,
  message = "boom",
): AgentExecutor {
  return {
    execute: async () => {
      throw new AgentExecutionError("agent-x", reason, message);
    },
  };
}

function eventuallyOkExecutor(
  failTimes: number,
  output: unknown = { ok: true },
) {
  const counter = { attempts: 0 };
  const executor: AgentExecutor = {
    execute: async () => {
      counter.attempts += 1;
      if (counter.attempts <= failTimes) {
        throw new AgentExecutionError("agent-x", "tool_failure", "transient");
      }
      return output;
    },
  };
  return { executor, counter };
}

interface WireOptions {
  agents?: Record<string, { def: Agent; executor: AgentExecutor }>;
  grants?: PermissionGrant[];
  toolRegistry?: ToolRegistry;
  clock?: () => number;
}

function wire(options: WireOptions = {}) {
  const registry = new AgentRegistry();
  const tasksSystem = new TaskSystem();
  const handoffs = new HandoffSystem();
  const audit = new AuditLog();
  const permissions = new PermissionSystem(options.grants ?? []);
  const approvals = new ApprovalSystem();
  const router = new RoutingAgentExecutor();
  const workflows = new WorkflowSystem();

  for (const [id, { def, executor }] of Object.entries(options.agents ?? {})) {
    registry.register(def);
    router.register(id, executor);
  }

  const orchestrator = new Orchestrator(
    registry,
    tasksSystem,
    handoffs,
    audit,
    router,
    approvals,
    { permissions, environment: "local" },
  );
  const engine = new WorkflowEngine({
    registry,
    workflows,
    orchestrator,
    handoffs,
    audit,
    permissions,
    toolRegistry: options.toolRegistry,
    clock: options.clock,
  });

  return {
    registry,
    handoffs,
    audit,
    permissions,
    approvals,
    workflows,
    orchestrator,
    engine,
  };
}

function baseDraft(over: Partial<WorkflowDraft> = {}): WorkflowDraft {
  return {
    name: "test workflow",
    description: "a workflow used in tests",
    projectId: "proj-x",
    participatingAgents: ["agent-a"],
    tasks: [
      {
        id: "t1",
        type: "typeA",
        agentId: "agent-a",
        description: "do the thing",
      },
    ],
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* WORKFLOW: creation / validation                                    */
/* ------------------------------------------------------------------ */

test("workflow: creates and validates a well-formed draft", () => {
  const { workflows } = wire();
  const workflow = workflows.create(baseDraft());
  assert.equal(workflow.status, "created");
  assert.equal(workflow.taskRecords.length, 1);
  assert.equal(workflow.taskRecords[0]!.status, "pending");
});

test("workflow: rejects a malformed draft and stores nothing", () => {
  const { workflows } = wire();
  assert.throws(
    () => workflows.create(baseDraft({ name: "" })),
    ValidationError,
  );
  assert.throws(
    () => workflows.create(baseDraft({ tasks: [] })),
    /tasks must be a non-empty array/,
  );
  assert.equal(workflows.list().length, 0);
});

test("workflow: rejects a task depending on an unknown task", () => {
  const { workflows } = wire();
  assert.throws(
    () =>
      workflows.create(
        baseDraft({
          tasks: [
            {
              id: "t1",
              type: "typeA",
              agentId: "agent-a",
              description: "d",
              dependsOn: ["ghost"],
            },
          ],
        }),
      ),
    /unknown task "ghost"/,
  );
});

test("workflow: rejects a circular dependency and executes nothing", () => {
  const { workflows } = wire();
  assert.throws(
    () =>
      workflows.create(
        baseDraft({
          tasks: [
            {
              id: "a",
              type: "typeA",
              agentId: "agent-a",
              description: "a",
              dependsOn: ["c"],
            },
            {
              id: "b",
              type: "typeA",
              agentId: "agent-a",
              description: "b",
              dependsOn: ["a"],
            },
            {
              id: "c",
              type: "typeA",
              agentId: "agent-a",
              description: "c",
              dependsOn: ["b"],
            },
          ],
        }),
      ),
    /circular dependency/,
  );
  assert.equal(workflows.list().length, 0);
});

test("workflow: rejects self-dependency and duplicate task ids", () => {
  const { workflows } = wire();
  assert.throws(
    () =>
      workflows.create(
        baseDraft({
          tasks: [
            {
              id: "a",
              type: "typeA",
              agentId: "agent-a",
              description: "a",
              dependsOn: ["a"],
            },
          ],
        }),
      ),
    /cannot depend on itself/,
  );
  assert.throws(
    () =>
      workflows.create(
        baseDraft({
          tasks: [
            { id: "a", type: "typeA", agentId: "agent-a", description: "a" },
            {
              id: "a",
              type: "typeA",
              agentId: "agent-a",
              description: "a again",
            },
          ],
        }),
      ),
    /duplicate workflow task id/,
  );
});

test("workflow: rejects a draft that exceeds limits.maxTasks", () => {
  const { workflows } = wire();
  assert.throws(
    () =>
      workflows.create(
        baseDraft({
          limits: { maxTasks: 1 },
          tasks: [
            { id: "a", type: "typeA", agentId: "agent-a", description: "a" },
            { id: "b", type: "typeA", agentId: "agent-a", description: "b" },
          ],
        }),
      ),
    /maxTasks/,
  );
});

/* ------------------------------------------------------------------ */
/* WORKFLOW: task ordering, completion, handoff                       */
/* ------------------------------------------------------------------ */

test("workflow: dependents wait for dependencies, then the workflow completes", async () => {
  const a = okExecutor({ from: "a" });
  const b = okExecutor({ from: "b" });
  const c = okExecutor({ from: "c" });
  const { engine, audit, handoffs } = wire({
    agents: {
      "agent-a": {
        def: agentDef("agent-a", { supportedTaskTypes: ["research"] }),
        executor: a.executor,
      },
      "agent-b": {
        def: agentDef("agent-b", {
          supportedTaskTypes: ["research", "development"],
        }),
        executor: b.executor,
      },
      "agent-c": {
        def: agentDef("agent-c", { supportedTaskTypes: ["research", "qa"] }),
        executor: c.executor,
      },
    },
  });

  const workflow = await engine.submit({
    name: "research-then-dev-then-qa",
    description: "d",
    projectId: "proj-x",
    participatingAgents: ["agent-a", "agent-b", "agent-c"],
    tasks: [
      {
        id: "research",
        type: "research",
        agentId: "agent-a",
        description: "research",
        acceptanceCriteria: ["found something"],
      },
      {
        id: "dev",
        type: "development",
        agentId: "agent-b",
        description: "build",
        dependsOn: ["research"],
        acceptanceCriteria: ["builds"],
      },
      {
        id: "qa",
        type: "qa",
        agentId: "agent-c",
        description: "check",
        dependsOn: ["dev"],
        acceptanceCriteria: ["passes"],
      },
    ],
  });

  assert.equal(workflow.status, "completed");
  assert.equal(
    workflow.taskRecords.every((r) => r.status === "completed"),
    true,
  );
  assert.equal(workflow.result?.status, "completed");
  assert.equal(workflow.result?.taskResults.length, 3);

  // a handoff was proposed + accepted across each cross-agent edge
  assert.equal(handoffs.list().length, 2);
  assert.ok(handoffs.list().every((h) => h.status === "accepted"));

  const kinds = audit
    .query({ type: "workflow_event" })
    .map((e) => (e.data as { kind: string }).kind);
  assert.equal(kinds[0], "workflow_created");
  assert.equal(kinds.at(-1), "workflow_completed");
  for (const expected of [
    "workflow_validated",
    "workflow_started",
    "agent_assigned",
    "task_created",
    "task_started",
    "handoff_created",
    "handoff_accepted",
    "task_completed",
  ]) {
    assert.ok(
      kinds.includes(expected),
      `missing workflow_event kind: ${expected}`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* AGENT ASSIGNMENT / SECURITY                                        */
/* ------------------------------------------------------------------ */

test("assignment: an unregistered agent id is rejected before execution", async () => {
  const { engine } = wire({ agents: {} });
  const workflow = await engine.submit(baseDraft());
  assert.equal(workflow.status, "failed");
  assert.equal(workflow.taskRecords[0]!.status, "blocked");
  assert.match(workflow.taskRecords[0]!.error ?? "", /not registered/);
});

test("assignment: capability mismatch blocks the task, handler never runs", async () => {
  const { executor, counter } = okExecutor();
  const { engine } = wire({
    agents: { "agent-a": { def: agentDef("agent-a"), executor } },
  });
  const workflow = await engine.submit(
    baseDraft({
      tasks: [
        { id: "t1", type: "typeA", capability: "cap-nope", description: "d" },
      ],
    }),
  );
  assert.equal(workflow.status, "failed");
  assert.equal(workflow.taskRecords[0]!.status, "blocked");
  assert.equal(counter.calls, 0);
});

test("assignment: project mismatch blocks the task", async () => {
  const { executor, counter } = okExecutor();
  const { engine } = wire({
    agents: {
      "agent-a": {
        def: agentDef("agent-a", { allowedProjects: ["other-project"] }),
        executor,
      },
    },
  });
  const workflow = await engine.submit(baseDraft());
  assert.equal(workflow.status, "failed");
  assert.match(workflow.taskRecords[0]!.error ?? "", /not eligible/);
  assert.equal(counter.calls, 0);
});

test("assignment: an agent not declared a participant is rejected even if eligible", async () => {
  const { executor } = okExecutor();
  const { engine } = wire({
    agents: { "agent-a": { def: agentDef("agent-a"), executor } },
  });
  const workflow = await engine.submit(
    baseDraft({ participatingAgents: ["agent-other"] }),
  );
  assert.equal(workflow.status, "failed");
  assert.match(
    workflow.taskRecords[0]!.error ?? "",
    /not a declared participant|no candidate/,
  );
});

test("security: an expected tool not authorized for the agent blocks assignment", async () => {
  const { executor } = okExecutor();
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(
    makeInMemoryTool(
      {
        id: "restricted.tool",
        name: "Restricted",
        description: "d",
        version: "1.0.0",
        capabilities: ["x"],
        requiredPermission: { action: "read" },
        allowedAgents: ["someone-else"],
        allowedProjects: ["*"],
        allowedEnvironments: ["local"],
        timeoutMs: 1000,
        limits: {
          maxCallsPerTask: 10,
          maxCallsPerAgent: 10,
          maxDurationMs: 1000,
          maxInputBytes: 1024,
          maxOutputBytes: 1024,
        },
        metadata: {},
      },
      () => ({}),
    ),
  );
  const { engine } = wire({
    agents: { "agent-a": { def: agentDef("agent-a"), executor } },
    toolRegistry,
  });
  const workflow = await engine.submit(
    baseDraft({
      tasks: [
        {
          id: "t1",
          type: "typeA",
          agentId: "agent-a",
          description: "d",
          expectedTools: ["restricted.tool"],
        },
      ],
    }),
  );
  assert.equal(workflow.status, "failed");
  assert.match(
    workflow.taskRecords[0]!.error ?? "",
    /not authorized for expected tool/,
  );
});

test("security: permission denial stops the task before the handler runs", async () => {
  const { executor, counter } = okExecutor();
  const { engine, audit } = wire({
    agents: { "agent-a": { def: agentDef("agent-a"), executor } },
    grants: [], // deny-by-default: no grant for "write"
  });
  const workflow = await engine.submit(
    baseDraft({
      tasks: [
        {
          id: "t1",
          type: "typeA",
          agentId: "agent-a",
          description: "d",
          requiredPermissions: [{ action: "write" }],
        },
      ],
    }),
  );
  assert.equal(workflow.status, "failed");
  assert.equal(workflow.taskRecords[0]!.status, "failed");
  assert.match(workflow.taskRecords[0]!.error ?? "", /permission denied/);
  assert.equal(counter.calls, 0);
  assert.ok(audit.list().some((e) => e.type === "permission_decision"));
});

/* ------------------------------------------------------------------ */
/* FAILURE / RETRY                                                    */
/* ------------------------------------------------------------------ */

test("retry: a retryable failure is retried and can still succeed", async () => {
  const { executor, counter } = eventuallyOkExecutor(1);
  const { engine } = wire({
    agents: { "agent-a": { def: agentDef("agent-a"), executor } },
  });
  const workflow = await engine.submit(
    baseDraft({ retryPolicy: { maxRetries: 2 } }),
  );
  assert.equal(workflow.status, "completed");
  assert.equal(workflow.taskRecords[0]!.retryCount, 1);
  assert.equal(counter.attempts, 2);
  assert.equal(workflow.counters.retries, 1);
});

test("retry: exhausting the retry limit fails the task and the workflow", async () => {
  const executor = failExecutor("tool_failure", "always broken");
  const { engine, audit } = wire({
    agents: { "agent-a": { def: agentDef("agent-a"), executor } },
  });
  const workflow = await engine.submit(
    baseDraft({ retryPolicy: { maxRetries: 1 } }),
  );
  assert.equal(workflow.status, "failed");
  assert.equal(workflow.taskRecords[0]!.status, "failed");
  assert.equal(workflow.taskRecords[0]!.retryCount, 1);
  assert.ok(
    audit
      .query({ type: "workflow_event" })
      .some((e) => (e.data as { kind?: string }).kind === "retry_requested"),
  );
});

test("retry: a non-retryable failure is never retried", async () => {
  const executor = failExecutor("permission_denied", "denied");
  const { engine } = wire({
    agents: { "agent-a": { def: agentDef("agent-a"), executor } },
  });
  const workflow = await engine.submit(
    baseDraft({ retryPolicy: { maxRetries: 3 } }),
  );
  assert.equal(workflow.status, "failed");
  assert.equal(workflow.taskRecords[0]!.retryCount, 0);
});

test("failure: continue mode lets an independent branch finish while the other is blocked", async () => {
  const good = okExecutor({ ok: true });
  const bad = failExecutor("model_failure", "broke");
  const { engine } = wire({
    agents: {
      "agent-a": {
        def: agentDef("agent-a", { supportedTaskTypes: ["typeA"] }),
        executor: bad,
      },
      "agent-b": {
        def: agentDef("agent-b", { supportedTaskTypes: ["typeB"] }),
        executor: good.executor,
      },
    },
  });
  const workflow = await engine.submit({
    name: "n",
    description: "d",
    projectId: "proj-x",
    participatingAgents: ["agent-a", "agent-b"],
    failureBehavior: "continue",
    retryPolicy: { maxRetries: 0 },
    tasks: [
      { id: "fails", type: "typeA", agentId: "agent-a", description: "d" },
      {
        id: "independent",
        type: "typeB",
        agentId: "agent-b",
        description: "d",
      },
    ],
  });
  assert.equal(workflow.status, "failed"); // not everything completed
  const byId = Object.fromEntries(
    workflow.taskRecords.map((r) => [r.specId, r.status]),
  );
  assert.equal(byId.fails, "failed");
  assert.equal(byId.independent, "completed");
});

/* ------------------------------------------------------------------ */
/* APPROVAL                                                            */
/* ------------------------------------------------------------------ */

function wireWithApproval() {
  const registry = new AgentRegistry();
  const tasksSystem = new TaskSystem();
  const handoffs = new HandoffSystem();
  const audit = new AuditLog();
  const permissions = new PermissionSystem([]);
  const approvals = new ApprovalSystem();
  const router = new RoutingAgentExecutor();
  const workflows = new WorkflowSystem();

  const gated = okExecutor({ gated: true });
  const after = okExecutor({ after: true });
  registry.register(agentDef("agent-a", { supportedTaskTypes: ["gated"] }));
  registry.register(agentDef("agent-b", { supportedTaskTypes: ["after"] }));
  router.register("agent-a", gated.executor);
  router.register("agent-b", after.executor);

  const orchestrator = new Orchestrator(
    registry,
    tasksSystem,
    handoffs,
    audit,
    router,
    approvals,
    {
      permissions,
      environment: "local",
      approvalPolicy: {
        evaluate: (task) => ({ required: task.type === "gated" }),
      },
    },
  );
  const engine = new WorkflowEngine({
    registry,
    workflows,
    orchestrator,
    handoffs,
    audit,
    permissions,
  });
  return {
    engine,
    orchestrator,
    approvals,
    audit,
    afterCounter: after.counter,
  };
}

test("approval: the workflow pauses and the dependent task never dispatches", async () => {
  const { engine, audit } = wireWithApproval();
  const workflow = await engine.submit({
    name: "n",
    description: "d",
    projectId: "proj-x",
    participatingAgents: ["agent-a", "agent-b"],
    tasks: [
      { id: "gated", type: "gated", agentId: "agent-a", description: "d" },
      {
        id: "after",
        type: "after",
        agentId: "agent-b",
        description: "d",
        dependsOn: ["gated"],
      },
    ],
  });
  assert.equal(workflow.status, "awaiting_approval");
  assert.equal(
    workflow.taskRecords.find((r) => r.specId === "gated")!.status,
    "awaiting_approval",
  );
  assert.equal(
    workflow.taskRecords.find((r) => r.specId === "after")!.status,
    "pending",
  );
  assert.ok(
    !audit
      .list()
      .some(
        (e) =>
          e.type === "workflow_event" &&
          (e.data as { specId?: string }).specId === "after",
      ),
  );
});

test("approval: approve then resume runs the dependent task to completion", async () => {
  const { engine, orchestrator, approvals } = wireWithApproval();
  const workflow = await engine.submit({
    name: "n",
    description: "d",
    projectId: "proj-x",
    participatingAgents: ["agent-a", "agent-b"],
    tasks: [
      { id: "gated", type: "gated", agentId: "agent-a", description: "d" },
      {
        id: "after",
        type: "after",
        agentId: "agent-b",
        description: "d",
        dependsOn: ["gated"],
      },
    ],
  });
  const gatedTaskId = workflow.taskRecords.find(
    (r) => r.specId === "gated",
  )!.taskId!;
  const pending = approvals.pending()[0]!;
  orchestrator.recordApprovalDecision(pending.id, "approved", "human:test");
  const resumed = await engine.resume(workflow.id);
  assert.equal(resumed.status, "completed");
  assert.equal(
    resumed.taskRecords.find((r) => r.specId === "gated")!.taskId,
    gatedTaskId,
  );
  assert.equal(
    resumed.taskRecords.every((r) => r.status === "completed"),
    true,
  );
});

test("approval: rejection fails the gated task and the workflow", async () => {
  const { engine, approvals } = wireWithApproval();
  const workflow = await engine.submit({
    name: "n",
    description: "d",
    projectId: "proj-x",
    participatingAgents: ["agent-a", "agent-b"],
    tasks: [
      { id: "gated", type: "gated", agentId: "agent-a", description: "d" },
    ],
  });
  const pending = approvals.pending()[0]!;
  approvals.decide(pending.id, "rejected", "human:test");
  const resumed = await engine.resume(workflow.id);
  assert.equal(resumed.status, "failed");
  assert.equal(resumed.taskRecords[0]!.status, "failed");
});

test("approval bypass: resuming a workflow that is not awaiting approval throws", async () => {
  const { executor } = okExecutor();
  const { engine } = wire({
    agents: { "agent-a": { def: agentDef("agent-a"), executor } },
  });
  const workflow = await engine.submit(baseDraft());
  assert.equal(workflow.status, "completed");
  await assert.rejects(engine.resume(workflow.id), StateTransitionError);
});

/* ------------------------------------------------------------------ */
/* LIMITS                                                              */
/* ------------------------------------------------------------------ */

test("limits: maxAgentExecutions stops scheduling further tasks", async () => {
  const { executor } = okExecutor();
  const { engine } = wire({
    agents: { "agent-a": { def: agentDef("agent-a"), executor } },
  });
  const workflow = await engine.submit(
    baseDraft({
      limits: { maxAgentExecutions: 1 },
      tasks: [
        { id: "t1", type: "typeA", agentId: "agent-a", description: "d" },
        { id: "t2", type: "typeA", agentId: "agent-a", description: "d" },
      ],
    }),
  );
  assert.equal(workflow.status, "failed");
  assert.match(workflow.error ?? "", /maxAgentExecutions/);
});

test("limits: maxHandoffs stops a workflow with too many cross-agent edges", async () => {
  const a = okExecutor({ from: "a" });
  const b = okExecutor({ from: "b" });
  const c = okExecutor({ from: "c" });
  const { engine } = wire({
    agents: {
      "agent-a": {
        def: agentDef("agent-a", { supportedTaskTypes: ["ta"] }),
        executor: a.executor,
      },
      "agent-b": {
        def: agentDef("agent-b", { supportedTaskTypes: ["tb"] }),
        executor: b.executor,
      },
      "agent-c": {
        def: agentDef("agent-c", { supportedTaskTypes: ["tc"] }),
        executor: c.executor,
      },
    },
  });
  const workflow = await engine.submit({
    name: "n",
    description: "d",
    projectId: "proj-x",
    participatingAgents: ["agent-a", "agent-b", "agent-c"],
    limits: { maxHandoffs: 1 },
    tasks: [
      {
        id: "t1",
        type: "ta",
        agentId: "agent-a",
        description: "d",
        acceptanceCriteria: ["x"],
      },
      {
        id: "t2",
        type: "tb",
        agentId: "agent-b",
        description: "d",
        dependsOn: ["t1"],
        acceptanceCriteria: ["x"],
      },
      {
        id: "t3",
        type: "tc",
        agentId: "agent-c",
        description: "d",
        dependsOn: ["t2"],
        acceptanceCriteria: ["x"],
      },
    ],
  });
  assert.equal(workflow.status, "failed");
  assert.match(workflow.error ?? "", /maxHandoffs/);
});

test("limits: maxToolCalls stops the workflow once the aggregate is exceeded", async () => {
  const withCounters = (toolCalls: number) => ({
    execute: async () => ({ metadata: { counters: { toolCalls } } }),
  });
  const { engine } = wire({
    agents: {
      "agent-a": { def: agentDef("agent-a"), executor: withCounters(50) },
    },
  });
  const workflow = await engine.submit(
    baseDraft({ limits: { maxToolCalls: 10 } }),
  );
  assert.equal(workflow.status, "failed");
  assert.match(workflow.error ?? "", /maxToolCalls/);
});

test("limits: maxDurationMs stops a workflow that runs too long", async () => {
  let clockValue = 0;
  const slow = {
    execute: async () => {
      clockValue += 10 * 60_000;
      return { ok: true };
    },
  };
  const { engine } = wire({
    agents: { "agent-a": { def: agentDef("agent-a"), executor: slow } },
    clock: () => clockValue,
  });
  const workflow = await engine.submit(
    baseDraft({
      limits: { maxDurationMs: 1000 },
      tasks: [
        { id: "t1", type: "typeA", agentId: "agent-a", description: "d" },
        { id: "t2", type: "typeA", agentId: "agent-a", description: "d" },
      ],
    }),
  );
  assert.equal(workflow.status, "failed");
  assert.match(workflow.error ?? "", /maxDurationMs/);
});

test("limits: planFromObjective rejects a call that would exceed maxDelegationDepth", async () => {
  const { engine } = wire();
  await assert.rejects(
    engine.planFromObjective(
      {
        name: "n",
        description: "d",
        projectId: "proj-x",
        participatingAgents: ["agent-a"],
        objective: "do a thing",
        limits: { maxDelegationDepth: 1 },
      },
      1,
    ),
    ValidationError,
  );
});

test("limits: planFromObjective requires the project manager agent to be registered", async () => {
  const { engine } = wire();
  await assert.rejects(
    engine.planFromObjective({
      name: "n",
      description: "d",
      projectId: "proj-x",
      participatingAgents: ["agent-a"],
      objective: "do a thing",
    }),
    NotFoundError,
  );
});
