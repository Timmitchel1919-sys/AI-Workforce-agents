import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  HandoffSystem,
  InMemoryRepository,
  Orchestrator,
  PermissionSystem,
  ProjectRegistry,
  SoftwareFactoryOrchestrator,
  TaskSystem,
  ToolRegistry,
  WorkflowSystem,
  NotFoundError,
  ValidationError,
  type Agent,
  type OperatorPrincipal,
  type SoftwareFactoryEnvironmentProvider,
  type Task,
  type TaskDraft,
} from "../core/index.js";
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

const PROJECT = "sf";

function makeAgent(id: string, over: Partial<Agent> = {}): Agent {
  return {
    id,
    name: id.replace(/-/g, " "),
    description: `${id} test agent`,
    capabilities: ["dev"],
    allowedTools: [],
    allowedProjects: [PROJECT],
    supportedTaskTypes: ["dev", "qa", "ops"],
    permissions: [],
    metadata: {},
    ...over,
  };
}

function draft(description: string, over: Partial<TaskDraft> = {}): TaskDraft {
  return { type: "dev", description, projectId: PROJECT, ...over };
}

function blockAllEnvironments(): SoftwareFactoryEnvironmentProvider {
  return {
    requirementFor() {
      return null;
    },
    route(codes: readonly string[]) {
      return codes.map((code) => ({
        code,
        requirement: null,
        outcome: {
          outcome: "NO_AVAILABLE_ENVIRONMENT" as const,
          reason: `no ${code} environment provisioned`,
        },
      }));
    },
  };
}

interface HarnessOptions {
  denyExecute?: boolean;
  environments?: SoftwareFactoryEnvironmentProvider;
}

function harness(opts: HarnessOptions = {}) {
  const audit = new AuditLog();
  const agents = new AgentRegistry();
  agents.register(makeAgent("dev-agent"));

  const taskRepo = new InMemoryRepository<Task>();
  const tasks = new TaskSystem(taskRepo);
  const workflows = new WorkflowSystem();
  const approvals = new ApprovalSystem();
  const permissions = new PermissionSystem(
    opts.denyExecute
      ? []
      : [
          { effect: "allow", action: "read", projectId: PROJECT },
          { effect: "allow", action: "execute", projectId: PROJECT },
        ],
  );
  const handoffs = new HandoffSystem();
  const tools = new ToolRegistry(audit);
  const projects = new ProjectRegistry();

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
        if (task.description.startsWith("failure:")) {
          throw new Error(`simulated failure for ${task.id}`);
        }
        return { ok: true };
      },
    },
    approvals,
    {
      permissions,
      agentGate: agentOps,
      approvalPolicy: {
        evaluate: () => ({ required: false }),
      },
    },
  );

  const softwareFactory = new SoftwareFactoryOrchestrator(
    orchestrator,
    tasks,
    opts.environments ?? blockAllEnvironments(),
  );

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
    softwareFactory,
  };

  return {
    ctx,
    audit,
    agents,
    tasks,
    taskRepo,
    workflows,
    approvals,
    orchestrator,
    softwareFactory,
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

/* ------------------------------------------------------------------ */
/* Planning · querying                                                */
/* ------------------------------------------------------------------ */

test("software factory: program, workstream and planned task lifecycle", () => {
  const h = harness();
  const sf = h.softwareFactory;

  assert.throws(
    () => sf.createProgram("", "P1", "ship the factory"),
    ValidationError,
  );
  const program = sf.createProgram("p1", "P1", "ship the factory");
  assert.equal(program.status, "active");
  assert.deepEqual(program.workstreams, []);

  assert.throws(
    () => sf.createWorkstream("nope", "ws1", "W", "w"),
    (error: unknown) =>
      error instanceof NotFoundError && /unknown program/.test(error.message),
  );

  const ws = sf.createWorkstream("p1", "ws1", "Build", "compile + verify");
  assert.equal(ws.status, "active");
  assert.deepEqual(sf.overview().programs[0].workstreamIds, ["ws1"]);

  const task = sf.addTask(
    ws.id,
    draft("compile", { requirements: ["committed code"] }),
  );
  assert.equal(task.programId, "p1");
  assert.equal(task.workstreamId, "ws1");
  assert.equal(task.status, "created");
  assert.deepEqual(task.dependencies, []);
  assert.deepEqual(task.environmentRequirements, []);
  assert.deepEqual(task.completionCriteria, []);

  const graph = sf.getGraphProjection("p1");
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].status, "created");
  assert.deepEqual(graph.edges, []);

  const detail = sf.programDetail("p1");
  assert.equal(detail?.program.id, "p1");
  assert.equal(detail?.workstreams[0].tasks.length, 1);
  // no environment requirements declared → routing summarised as skipped
  assert.equal(detail?.routes[0].status, "skipped");
});

test("software factory: addTask rejects unknown dependency ids", () => {
  const h = harness();
  const sf = h.softwareFactory;
  const program = sf.createProgram("p1", "P1", "obj");
  const ws = sf.createWorkstream(program.id, "ws1", "W", "obj");

  assert.throws(
    () => sf.addTask(ws.id, draft("a", { dependencies: ["ghost"] })),
    (error: unknown) =>
      error instanceof ValidationError &&
      /not a task in workstream/.test(error.message),
  );
  // nothing was persisted by the rejected add
  assert.equal(h.tasks.list().length, 0);
});

test("software factory: cycle addition is rejected and nothing persists", () => {
  const h = harness();
  const sf = h.softwareFactory;
  const program = sf.createProgram("p1", "P1", "obj");
  const ws = sf.createWorkstream(program.id, "ws1", "W", "obj");

  const a = sf.addTask(ws.id, draft("a"));
  const b = sf.addTask(ws.id, draft("b", { dependencies: [a.id] }));
  assert.equal(ws.tasks.length, 2);

  // A legacy/external writer corrupts the graph so that a depends on b, making
  // a → b → a a cycle the orchestrator must detect before persisting anything.
  const corrupted = h.taskRepo.findById(a.id)!;
  h.taskRepo.upsert({ ...corrupted, dependencies: [b.id] });

  assert.throws(
    () => sf.addTask(ws.id, draft("c", { dependencies: [a.id] })),
    (error: unknown) =>
      error instanceof ValidationError && /cycle detected/.test(error.message),
  );

  // The rejected task was rolled back out of the shared store and never joined
  // the workstream.
  assert.equal(h.tasks.list().length, 2);
  assert.equal(ws.tasks.length, 2);
});

/* ------------------------------------------------------------------ */
/* Governed dispatch                                                   */
/* ------------------------------------------------------------------ */

test("software factory: tick dispatches a READY DAG through the governed Orchestrator", async () => {
  const h = harness();
  const sf = h.softwareFactory;
  const program = sf.createProgram("p1", "P1", "obj");
  const ws = sf.createWorkstream(program.id, "ws1", "W", "obj");

  const a = sf.addTask(ws.id, draft("a"));
  const b = sf.addTask(ws.id, draft("b", { dependencies: [a.id] }));

  await sf.tick();

  // Both tasks were executed via the Orchestrator (audit + executor), and the
  // executed ids replaced the planned placeholders in the workstream.
  assert.equal(h.executed.length, 2);
  assert.equal(h.tasks.get(a.id), undefined, "planned placeholder retired");
  assert.equal(h.audit.query({ type: "task_completed" }).length, 2);
  assert.equal(
    h.audit.query({ type: "task_completed", taskId: b.id }).length,
    0,
    "planned id is retired — audit follows the executed id",
  );

  const [executedA, executedB] = [...ws.tasks];
  assert.notEqual(executedA, a.id);
  assert.notEqual(executedB, b.id);
  assert.equal(h.tasks.require(executedA).status, "completed");
  assert.equal(h.tasks.require(executedB).status, "completed");

  // The graph follows the executed ids and preserves the a → b dependency.
  const graph = sf.getGraphProjection(program.id);
  assert.deepEqual(
    graph.nodes.map((node) => node.id).sort(),
    [executedA, executedB].sort(),
  );
  assert.deepEqual(graph.edges, [
    { from: executedA, to: executedB, type: "blocking" },
  ]);
});

test("software factory: permission gate still applies on dispatch", async () => {
  const h = harness({ denyExecute: true });
  const sf = h.softwareFactory;
  const program = sf.createProgram("p1", "P1", "obj");
  const ws = sf.createWorkstream(program.id, "ws1", "W", "obj");

  sf.addTask(
    ws.id,
    draft("gated", {
      requiredPermissions: [{ action: "execute" }],
    }),
  );

  await sf.tick();

  // The gate blocked execution: the task failed via the Orchestrator and the
  // denial was audited — never executed.
  assert.equal(h.executed.length, 0);
  assert.equal(h.audit.query({ type: "permission_decision" }).length, 1);
  assert.equal(h.audit.query({ type: "task_completed" }).length, 0);
  const [executedId] = [...ws.tasks];
  assert.equal(h.tasks.require(executedId).status, "failed");
  assert.match(
    h.tasks.require(executedId).errors.at(-1) ?? "",
    /permission denied/,
  );
});

test("software factory: environment gate blocks unrouted declared codes", async () => {
  const h = harness();
  const sf = h.softwareFactory;
  const program = sf.createProgram("p1", "P1", "obj");
  const ws = sf.createWorkstream(program.id, "ws1", "W", "obj");

  const task = sf.addTask(
    ws.id,
    draft("docker build", {
      environmentRequirements: ["docker"],
    }),
  );

  await sf.tick();

  assert.equal(h.executed.length, 0, "task must not dispatch");
  assert.equal(h.tasks.require(task.id).status, "created");
  assert.equal(h.audit.query({ type: "agent_executed" }).length, 0);

  // The block is surfaced (redacted, never the full route) on program detail.
  const detail = sf.programDetail(program.id)!;
  const route = detail.routes.find((entry) => entry.taskId === task.id)!;
  assert.equal(route.code, "docker");
  assert.equal(route.status, "no_environment");
  assert.ok(route.detail.length > 0);
});

test('software factory: declared "none" environment releases dispatch', async () => {
  const h = harness({ environments: blockAllEnvironments() });
  const sf = h.softwareFactory;
  const program = sf.createProgram("p1", "P1", "obj");
  const ws = sf.createWorkstream(program.id, "ws1", "W", "obj");

  sf.addTask(
    ws.id,
    draft("local only", {
      environmentRequirements: ["none"],
    }),
  );

  await sf.tick();
  assert.equal(h.executed.length, 1, '"none" is unconditionally routable');
});

/* ------------------------------------------------------------------ */
/* Control-plane surface (commands · queries)                          */
/* ------------------------------------------------------------------ */

test("software factory: viewer may read but writes are denied", async () => {
  const h = harness();

  const denied = await h.command.createProgram(VIEWER, {
    id: "p1",
    name: "P1",
    objective: "obj",
  });
  assert.equal(denied.outcome, "denied");
  assert.equal(denied.errorKind, "forbidden");

  const deniedTick = await h.command.tickSoftwareFactory(VIEWER, {});
  assert.equal(deniedTick.outcome, "denied");
  assert.equal(deniedTick.errorKind, "forbidden");

  // Reads are allowed for the viewer.
  assert.deepEqual(h.query.getSoftwareFactoryOverview(VIEWER), {
    programs: [],
  });
  assert.throws(
    () => h.query.getSoftwareFactoryProgramDetail(VIEWER, "p1"),
    (error: unknown) =>
      error instanceof NotFoundError &&
      /unknown program: p1/.test(error.message),
  );
});

test("software factory: operator commands validate their inputs", async () => {
  const h = harness();

  const emptyId = await h.command.createProgram(OPERATOR, {
    id: "",
    name: "P1",
    objective: "obj",
  });
  assert.equal(emptyId.errorKind, "invalid_request");

  const unknownProgram = await h.command.createWorkstream(OPERATOR, {
    programId: "nope",
    id: "ws1",
    name: "W",
    objective: "obj",
  });
  assert.equal(unknownProgram.errorKind, "not_found");

  const program = await h.command.createProgram(OPERATOR, {
    id: "p1",
    name: "P1",
    objective: "obj",
  });
  assert.equal(program.outcome, "executed");

  const workstream = await h.command.createWorkstream(OPERATOR, {
    programId: "p1",
    id: "ws1",
    name: "Build",
    objective: "compile + verify",
  });
  assert.equal(workstream.outcome, "executed");

  const task = await h.command.addTaskToWorkstream(OPERATOR, {
    workstreamId: "ws1",
    task: { type: "dev", description: "compile", projectId: PROJECT },
  });
  assert.equal(task.outcome, "executed");

  const overview = h.query.getSoftwareFactoryOverview(OPERATOR);
  assert.equal(overview.programs.length, 1);
  assert.equal(overview.programs[0].taskCount, 1);
});
