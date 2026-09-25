import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
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
  type EnvironmentCodeRoute,
  type EnvironmentType,
  type SoftwareFactoryEnvironmentProvider,
  type Task,
  type TaskDraft,
  type Workstream,
} from "../core/index.js";
import {
  AgentOperationalStore,
  WorkflowControlStore,
  WorkforceCommandService,
  WorkforceQueryService,
  type ControlPlaneContext,
} from "../control/index.js";
import { createControlPlaneApi } from "../api/index.js";
import {
  FirebaseOperatorDirectory,
  type FirebaseAuthLike,
} from "../adapters/firebase/index.js";
import type {
  OperatorAccount,
  OperatorAccountChange,
  OperatorAccountStore,
} from "../contracts/index.js";

/* ------------------------------------------------------------------ */
/* Harness                                                            */
/* ------------------------------------------------------------------ */

const PROJECT = "sf";
const OTHER_PROJECT = "other";

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

function dualRoutedEnvironments(): SoftwareFactoryEnvironmentProvider {
  return {
    requirementFor() {
      return null;
    },
    route(codes: readonly string[]): readonly EnvironmentCodeRoute[] {
      return codes.map((code) => ({
        code: code as EnvironmentType,
        requirement: null,
        outcome: {
          outcome: "ROUTED",
          instance: {
            id: `inst-${code}`,
            descriptorId: `descriptor-${code}`,
            hostId: `host-${code}`,
            environmentType: code as EnvironmentType,
            name: `instance ${code}`,
            availability: "available",
            capabilities: [],
            toolchains: [],
            trustLevel: "verified",
            fingerprint: `fp-${code}`,
          },
          host: {
            id: `host-record-${code}`,
            hostId: `host-${code}`,
            name: `host ${code}`,
            hostType: "container_host",
            os: { os: "linux", version: "1", architecture: "x64" },
            trustLevel: "verified",
            availability: "available",
            capabilities: [],
            fingerprint: `host-fp-${code}`,
          },
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
  const projectsRegistered = new Set<string>([PROJECT, OTHER_PROJECT]);
  for (const projectId of projectsRegistered) {
    projects.register({
      projectId,
      describe: async () => ({ name: projectId, capabilities: [] }),
      execute: async () => ({ ok: true }),
    });
  }

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

  const workstreamRepo = new InMemoryRepository<Workstream>();
  const softwareFactory = new SoftwareFactoryOrchestrator(
    orchestrator,
    tasks,
    opts.environments ?? blockAllEnvironments(),
    {
      persistence: {
        programs: new InMemoryRepository(),
        workstreams: workstreamRepo,
        executionAliases: new InMemoryRepository(),
      },
      projectExists: (projectId) => projectsRegistered.has(projectId),
    },
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
    workstreamRepo,
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
/* HTTP harness — the API boundary the UI actually calls              */
/* ------------------------------------------------------------------ */

class TokenAuth implements FirebaseAuthLike {
  async verifyIdToken(token: string): Promise<{
    uid: string;
    email: string;
    email_verified: boolean;
  }> {
    const uid = token.startsWith("tok-") ? token.slice(4) : "";
    if (!uid) throw new Error("invalid token");
    return { uid, email: `${uid}@example.test`, email_verified: true };
  }
}

function operatorAccount(over: Partial<OperatorAccount> = {}): OperatorAccount {
  return {
    id: "op",
    status: "active",
    role: "operator",
    allowedProjects: "*",
    email: "op@example.test",
    emailVerified: true,
    requestedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    revision: 1,
    ...over,
  };
}

class SeededAccountStore implements OperatorAccountStore {
  private accounts = new Map<string, OperatorAccount>();

  seed(account: OperatorAccount): void {
    this.accounts.set(account.id, account);
  }

  async get(operatorId: string): Promise<OperatorAccount | undefined> {
    return this.accounts.get(operatorId);
  }

  async list(): Promise<OperatorAccount[]> {
    return [...this.accounts.values()];
  }

  async commit(_change: OperatorAccountChange): Promise<"committed"> {
    throw new Error("not used in this test");
  }
}

async function httpHarness() {
  const store = new SeededAccountStore();
  store.seed(operatorAccount());
  const services = { auth: new TokenAuth(), accounts: store };
  const directory = new FirebaseOperatorDirectory(services.auth, store);
  const h = harness();
  const ctx: ControlPlaneContext = { ...h.ctx, access: undefined as never };
  const server = http.createServer(
    createControlPlaneApi({
      query: new WorkforceQueryService(ctx),
      command: new WorkforceCommandService(ctx),
      operatorDirectory: directory,
      identityVerifier: directory,
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const call = async (
    method: "GET" | "POST",
    path: string,
    token?: string,
    body?: unknown,
  ) => {
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: res.status,
      body: (await res.json()) as Record<string, unknown>,
    };
  };
  return {
    call,
    store,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/* ------------------------------------------------------------------ */
/* Planning · querying                                                */
/* ------------------------------------------------------------------ */

test("software factory: program, workstream and planned task lifecycle", () => {
  const h = harness();
  const sf = h.softwareFactory;

  assert.throws(
    () => sf.createProgram("", "P1", "ship the factory", PROJECT),
    ValidationError,
  );
  assert.throws(
    () => sf.createProgram("p1", "P1", "ship the factory", "ghost"),
    NotFoundError,
  );
  const program = sf.createProgram("p1", "P1", "ship the factory", PROJECT);
  assert.equal(program.projectId, PROJECT);
  assert.equal(program.schemaVersion, 1);
  assert.equal(program.status, "active");
  assert.deepEqual(program.workstreams, []);

  assert.throws(
    () => sf.createWorkstream("nope", "ws1", "W", "w", PROJECT),
    (error: unknown) =>
      error instanceof NotFoundError && /unknown program/.test(error.message),
  );
  assert.throws(
    () => sf.createWorkstream("p1", "ws1", "W", "w", "other"),
    NotFoundError,
    "a program is never reachable through another project",
  );

  const ws = sf.createWorkstream(
    "p1",
    "ws1",
    "Build",
    "compile + verify",
    PROJECT,
  );
  assert.equal(ws.status, "active");
  assert.equal(ws.projectId, PROJECT);
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

  const graph = sf.getGraphProjection("p1", PROJECT);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].status, "created");
  assert.equal(
    "input" in (graph.nodes[0].task as unknown as Record<string, unknown>),
    false,
    "the graph view is redacted",
  );
  assert.deepEqual(graph.edges, []);

  assert.equal(sf.programDetail("p1", "other"), undefined);
  const detail = sf.programDetail("p1", PROJECT);
  assert.equal(detail?.program.id, "p1");
  assert.equal(detail?.workstreams[0].tasks.length, 1);
  // no environment requirements declared → routing summarised as skipped
  assert.equal(detail?.routes[0].status, "skipped");
});

test("software factory: addTask rejects unknown dependency ids", () => {
  const h = harness();
  const sf = h.softwareFactory;
  const program = sf.createProgram("p1", "P1", "obj", PROJECT);
  const ws = sf.createWorkstream(program.id, "ws1", "W", "obj", PROJECT);

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
  const program = sf.createProgram("p1", "P1", "obj", PROJECT);
  const ws = sf.createWorkstream(program.id, "ws1", "W", "obj", PROJECT);

  const a = sf.addTask(ws.id, draft("a"));
  const b = sf.addTask(ws.id, draft("b", { dependencies: [a.id] }));
  assert.equal(h.workstreamRepo.findById("ws1")?.tasks.length, 2);

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
  assert.equal(h.workstreamRepo.findById("ws1")?.tasks.length, 2);
});

/* ------------------------------------------------------------------ */
/* Governed dispatch                                                   */
/* ------------------------------------------------------------------ */

test("software factory: tick dispatches a READY DAG through the governed Orchestrator", async () => {
  const h = harness();
  const sf = h.softwareFactory;
  const program = sf.createProgram("p1", "P1", "obj", PROJECT);
  const ws = sf.createWorkstream(program.id, "ws1", "W", "obj", PROJECT);

  const a = sf.addTask(ws.id, draft("a"));
  const b = sf.addTask(ws.id, draft("b", { dependencies: [a.id] }));

  await sf.tick(program.id);

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

  const [executedA, executedB] = [...h.workstreamRepo.findById("ws1")!.tasks];
  assert.notEqual(executedA, a.id);
  assert.notEqual(executedB, b.id);
  assert.equal(h.tasks.require(executedA).status, "completed");
  assert.equal(h.tasks.require(executedB).status, "completed");

  // The graph follows the executed ids and preserves the a → b dependency.
  const graph = sf.getGraphProjection(program.id, PROJECT);
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
  const program = sf.createProgram("p1", "P1", "obj", PROJECT);
  const ws = sf.createWorkstream(program.id, "ws1", "W", "obj", PROJECT);

  sf.addTask(
    ws.id,
    draft("gated", {
      requiredPermissions: [{ action: "execute" }],
    }),
  );

  await sf.tick(program.id);

  // The gate blocked execution: the task failed via the Orchestrator and the
  // denial was audited — never executed.
  assert.equal(h.executed.length, 0);
  assert.equal(h.audit.query({ type: "permission_decision" }).length, 1);
  assert.equal(h.audit.query({ type: "task_completed" }).length, 0);
  const [executedId] = [...h.workstreamRepo.findById("ws1")!.tasks];
  assert.equal(h.tasks.require(executedId).status, "failed");
  assert.match(
    h.tasks.require(executedId).errors.at(-1) ?? "",
    /permission denied/,
  );
});

test("software factory: environment gate blocks unrouted declared codes", async () => {
  const h = harness();
  const sf = h.softwareFactory;
  const program = sf.createProgram("p1", "P1", "obj", PROJECT);
  const ws = sf.createWorkstream(program.id, "ws1", "W", "obj", PROJECT);

  const task = sf.addTask(
    ws.id,
    draft("docker build", {
      environmentRequirements: ["docker"],
    }),
  );

  await sf.tick(program.id);

  assert.equal(h.executed.length, 0, "task must not dispatch");
  assert.equal(h.tasks.require(task.id).status, "created");
  assert.equal(h.audit.query({ type: "agent_executed" }).length, 0);

  // The block is surfaced (redacted, never the full route) on program detail.
  const detail = sf.programDetail(program.id, PROJECT)!;
  const route = detail.routes.find((entry) => entry.taskId === task.id)!;
  assert.equal(route.code, "docker");
  assert.equal(route.status, "no_environment");
  assert.ok(route.detail.length > 0);
});

test("software factory: two routed environments never dispatch without a placement", async () => {
  const h = harness({ environments: dualRoutedEnvironments() });
  const sf = h.softwareFactory;
  const program = sf.createProgram("p1", "P1", "obj", PROJECT);
  sf.createWorkstream(program.id, "ws1", "W", "obj", PROJECT);

  const task = sf.addTask("ws1", {
    type: "dev",
    description: "two environments",
    projectId: PROJECT,
    environmentRequirements: ["docker", "xcode"],
  });

  await sf.tick(program.id);

  assert.equal(h.executed.length, 0, "ambiguous placement must not dispatch");
  assert.equal(h.tasks.require(task.id).status, "created");
});

test("software factory: a single routed environment becomes the execution context", async () => {
  const h = harness({ environments: dualRoutedEnvironments() });
  const sf = h.softwareFactory;
  const program = sf.createProgram("p1", "P1", "obj", PROJECT);
  sf.createWorkstream(program.id, "ws1", "W", "obj", PROJECT);
  const task = sf.addTask("ws1", {
    type: "dev",
    description: "one environment",
    projectId: PROJECT,
    environmentRequirements: ["docker"],
  });
  await sf.tick(program.id);

  const executedTask = h.tasks.list().find((entry) => entry.id !== task.id);
  assert.ok(executedTask, "the planned task was replaced by the executed one");
  assert.deepEqual(executedTask.executionContext, {
    environment: {
      code: "docker",
      instanceId: "inst-docker",
      hostId: "host-docker",
      descriptorId: "descriptor-docker",
    },
  });
});

test('software factory: declared "none" environment releases dispatch', async () => {
  const h = harness({ environments: blockAllEnvironments() });
  const sf = h.softwareFactory;
  const program = sf.createProgram("p1", "P1", "obj", PROJECT);
  const ws = sf.createWorkstream(program.id, "ws1", "W", "obj", PROJECT);

  sf.addTask(
    ws.id,
    draft("local only", {
      environmentRequirements: ["none"],
    }),
  );

  await sf.tick(program.id);
  assert.equal(h.executed.length, 1, '"none" is unconditionally routable');
});

/* ------------------------------------------------------------------ */
/* Control-plane surface (commands · queries)                          */
/* ------------------------------------------------------------------ */

test("software factory: viewer may read but writes are denied", async () => {
  const h = harness();

  const denied = await h.command.createProgram(VIEWER, {
    projectId: PROJECT,
    id: "p1",
    name: "P1",
    objective: "obj",
  });
  assert.equal(denied.outcome, "denied");
  assert.equal(denied.errorKind, "forbidden");

  const deniedTick = await h.command.tickSoftwareFactory(VIEWER, {
    projectId: PROJECT,
    programId: "p1",
  });
  assert.equal(deniedTick.outcome, "denied");
  assert.equal(deniedTick.errorKind, "forbidden");

  assert.deepEqual(h.query.getSoftwareFactoryOverview(VIEWER), {
    programs: [],
  });
  assert.throws(
    () => h.query.getSoftwareFactoryProgramDetail(VIEWER, PROJECT, "p1"),
    (error: unknown) =>
      error instanceof NotFoundError && /unknown program/.test(error.message),
  );
});

test("software factory: commands are project-scoped and audited", async () => {
  const h = harness();

  const program = await h.command.createProgram(OPERATOR, {
    projectId: PROJECT,
    id: "p1",
    name: "P1",
    objective: "obj",
  });
  assert.equal(program.outcome, "executed");

  // A program is never reachable through a different project scope.
  const wrongProject = await h.command.createWorkstream(OPERATOR, {
    projectId: OTHER_PROJECT,
    programId: "p1",
    id: "ws1",
    name: "Build",
    objective: "compile + verify",
  });
  assert.equal(wrongProject.outcome, "rejected");
  assert.equal(wrongProject.errorKind, "not_found");

  const workstream = await h.command.createWorkstream(OPERATOR, {
    projectId: PROJECT,
    programId: "p1",
    id: "ws1",
    name: "Build",
    objective: "compile + verify",
  });
  assert.equal(workstream.outcome, "executed");

  const task = await h.command.addTaskToWorkstream(OPERATOR, {
    projectId: PROJECT,
    programId: "p1",
    workstreamId: "ws1",
    task: { type: "dev", description: "compile" },
  });
  assert.equal(task.outcome, "executed");

  const overview = h.query.getSoftwareFactoryOverview(OPERATOR, PROJECT);
  assert.equal(overview.programs.length, 1);
  assert.equal(overview.programs[0].taskCount, 1);
  assert.deepEqual(
    h.query.getSoftwareFactoryOverview(OPERATOR, OTHER_PROJECT).programs,
    [],
  );
});

test("software factory: a task draft may not claim its own ownership", async () => {
  const h = harness();
  await h.command.createProgram(OPERATOR, {
    projectId: PROJECT,
    id: "p1",
    name: "P1",
    objective: "obj",
  });
  await h.command.createWorkstream(OPERATOR, {
    projectId: PROJECT,
    programId: "p1",
    id: "ws1",
    name: "Build",
    objective: "compile + verify",
  });

  const spoofed = await h.command.addTaskToWorkstream(OPERATOR, {
    projectId: PROJECT,
    programId: "p1",
    workstreamId: "ws1",
    task: { type: "dev", description: "compile", projectId: OTHER_PROJECT },
  });
  assert.equal(spoofed.outcome, "rejected");
  assert.equal(spoofed.errorKind, "invalid_request");
  assert.equal(h.tasks.list().length, 0);
});

test("software factory: an operator without project access is denied", async () => {
  const h = harness();
  const scoped: OperatorPrincipal = {
    id: "operator-2",
    role: "operator",
    allowedProjects: [OTHER_PROJECT],
  };

  const denied = await h.command.createProgram(scoped, {
    projectId: PROJECT,
    id: "p1",
    name: "P1",
    objective: "obj",
  });
  assert.equal(denied.outcome, "denied");
  assert.equal(denied.errorKind, "forbidden");

  await h.command.createProgram(OPERATOR, {
    projectId: PROJECT,
    id: "p1",
    name: "P1",
    objective: "obj",
  });
  assert.deepEqual(h.query.getSoftwareFactoryOverview(scoped), {
    programs: [],
  });
  assert.throws(
    () => h.query.getSoftwareFactoryProgramDetail(scoped, PROJECT, "p1"),
    NotFoundError,
  );
});

test("software factory: operator commands validate their inputs", async () => {
  const h = harness();

  const missingProject = await h.command.createProgram(OPERATOR, {
    id: "p1",
    name: "P1",
    objective: "obj",
  });
  assert.equal(missingProject.errorKind, "invalid_request");

  const unknownProject = await h.command.createProgram(OPERATOR, {
    projectId: "ghost",
    id: "p1",
    name: "P1",
    objective: "obj",
  });
  assert.equal(unknownProject.errorKind, "not_found");

  const emptyId = await h.command.createProgram(OPERATOR, {
    projectId: PROJECT,
    id: "",
    name: "P1",
    objective: "obj",
  });
  assert.equal(emptyId.errorKind, "invalid_request");

  const unknownProgram = await h.command.createWorkstream(OPERATOR, {
    projectId: PROJECT,
    programId: "nope",
    id: "ws1",
    name: "W",
    objective: "obj",
  });
  assert.equal(unknownProgram.errorKind, "not_found");

  const unknownWorkstream = await h.command.addTaskToWorkstream(OPERATOR, {
    projectId: PROJECT,
    programId: "p1",
    workstreamId: "nope",
    task: { type: "dev", description: "compile" },
  });
  assert.equal(unknownWorkstream.errorKind, "not_found");

  const unknownTick = await h.command.tickSoftwareFactory(OPERATOR, {
    projectId: PROJECT,
    programId: "nope",
  });
  assert.equal(unknownTick.errorKind, "not_found");
});

test("software factory: a tick only advances the program it was scoped to", async () => {
  const h = harness();
  const first = h.softwareFactory.createProgram("p1", "P1", "obj", PROJECT);
  const second = h.softwareFactory.createProgram("p2", "P2", "obj", PROJECT);
  h.softwareFactory.createWorkstream(first.id, "ws1", "W", "obj", PROJECT);
  h.softwareFactory.createWorkstream(second.id, "ws2", "W", "obj", PROJECT);
  h.softwareFactory.addTask("ws1", draft("a"));
  h.softwareFactory.addTask("ws2", draft("b"));

  await h.softwareFactory.tick(first.id);

  assert.equal(h.tasks.list().length, 2, "both planned tasks still exist");
  assert.equal(h.executed.length, 1, "only the scoped program dispatched");
});

/* ------------------------------------------------------------------ */
/* HTTP edge — project scope is enforced at the API boundary          */
/* ------------------------------------------------------------------ */

test("software factory: HTTP routes require and enforce the project scope", async () => {
  const h = await httpHarness();
  try {
    const missingProject = await h.call(
      "GET",
      "/software-factory/programs/p1",
      "tok-op",
    );
    assert.equal(missingProject.status, 400);
    assert.equal(missingProject.body.ok, undefined);

    const created = await h.call("POST", "/commands/create-program", "tok-op", {
      projectId: PROJECT,
      id: "p1",
      name: "P1",
      objective: "obj",
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.outcome, "executed");

    const detail = await h.call(
      "GET",
      `/software-factory/programs/p1?projectId=${PROJECT}`,
      "tok-op",
    );
    assert.equal(detail.status, 200);
    const program = (detail.body as { program: { projectId: string } }).program;
    assert.equal(program.projectId, PROJECT);

    // The same program is not reachable through another project scope.
    const otherProject = await h.call(
      "GET",
      `/software-factory/programs/p1?projectId=${OTHER_PROJECT}`,
      "tok-op",
    );
    assert.equal(otherProject.status, 404);

    const scopedOverview = await h.call(
      "GET",
      `/software-factory?projectId=${OTHER_PROJECT}`,
      "tok-op",
    );
    assert.deepEqual(scopedOverview.body, { programs: [] });
  } finally {
    await h.close();
  }
});
