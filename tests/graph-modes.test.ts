/**
 * EO-5.6 — graph modes over one projection: workforce, project, agent,
 * workflow, dependency, environment, knowledge.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentOperationalStore,
  GraphQueryService,
  type ControlPlaneContext,
} from "../control/index.js";
import { WorkflowControlStore } from "../control/index.js";
import { WorkforceGraphProjectionService } from "../core/orchestrator/graph-projection.js";
import { KnowledgeSourceRegistry } from "../core/orchestrator/graph-knowledge-fragment.js";
import type { SoftwareFactoryOrchestrator } from "../core/orchestrator/software-factory-orchestrator.js";
import {
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  PermissionSystem,
  ProjectRegistry,
  TaskSystem,
  ToolRegistry,
  WorkflowSystem,
  type Agent,
  type ProjectAdapter,
} from "../core/index.js";
import {
  GRAPH_MODES,
  type GraphMode,
  type WorkforceGraphProjection,
} from "../contracts/graph.js";
import type { TaskEnvironmentRoutingSummary } from "../contracts/orchestration.js";

const A = "proj-a";
const B = "proj-b";

const agent = (id: string, projects: string[]): Agent => ({
  id,
  name: id,
  description: `${id} role`,
  capabilities: ["code"],
  allowedTools: [],
  allowedProjects: projects,
  supportedTaskTypes: ["ops"],
  permissions: [],
});
const adapter = (projectId: string): ProjectAdapter => ({
  projectId,
  async describe() {
    return { name: projectId, capabilities: [] };
  },
  async execute() {
    return {};
  },
});

function fakeFactory(
  routes: TaskEnvironmentRoutingSummary[],
): SoftwareFactoryOrchestrator {
  return {
    overview: () => ({
      programs: [
        {
          id: "prog",
          projectId: A,
          name: "Prog",
          objective: "",
          status: "active",
          workstreamIds: [],
          taskCount: 0,
          activeTaskCount: 0,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
    programDetail: () => ({ routes }),
  } as unknown as SoftwareFactoryOrchestrator;
}

function build(
  opts: {
    ids?: string[];
    routes?: TaskEnvironmentRoutingSummary[];
    knowledge?: KnowledgeSourceRegistry;
  } = {},
) {
  let i = 0;
  const ids = opts.ids ?? [];
  const tasks = new TaskSystem(undefined, {
    newId: () => ids[i++] ?? `auto-${++i}`,
  });
  const agents = new AgentRegistry();
  agents.register(agent("dev", [A]));
  agents.register(agent("qa", [A]));
  agents.register(agent("foreign", [B]));
  const projects = new ProjectRegistry();
  projects.register(adapter(A), { displayName: "Alpha" });
  projects.register(adapter(B), { displayName: "Beta" });
  const workflows = new WorkflowSystem();
  const agentOps = new AgentOperationalStore();
  const svc = new WorkforceGraphProjectionService(
    projects,
    agents,
    tasks,
    opts.routes ? fakeFactory(opts.routes) : undefined,
    {
      agentOps,
      workflows,
      ...(opts.knowledge ? { knowledge: opts.knowledge } : {}),
    },
    () => new Date("2026-01-01T00:00:00.000Z"),
  );
  return { tasks, agents, projects, workflows, agentOps, svc };
}

const types = (g: WorkforceGraphProjection) =>
  new Set(g.nodes.map((n) => n.type));

test("WORKFORCE is the default and roots at the control-plane hub", () => {
  const h = build({ ids: ["t1"] });
  h.tasks.create({ type: "ops", description: "x", projectId: A });
  const g = h.svc.getProjection({ projectId: A });
  assert.equal(g.mode, "WORKFORCE");
  assert.ok(g.nodes.some((n) => n.id === "control-plane"));
  assert.ok(g.edges.some((e) => e.id === "control-plane-has-project-proj-a"));
  assert.equal(
    g.nodes.some((n) => n.type === "WORKFLOW_STEP"),
    false,
  );
});

test("PROJECT mode omits the hub and stays inside the project", () => {
  const h = build();
  const g = h.svc.getProjection({ projectId: A, mode: "PROJECT" });
  assert.equal(
    g.nodes.some((n) => n.type === "CONTROL_PLANE"),
    false,
  );
  assert.equal(
    g.nodes.some((n) => n.id === "agent-foreign"),
    false,
  );
  assert.ok(g.nodes.some((n) => n.id === "agent-dev"));
});

test("AGENT mode: overview without a root, scoped neighbourhood with one", () => {
  const h = build({ ids: ["t1", "t2"] });
  const t1 = h.tasks.create({ type: "ops", description: "mine", projectId: A });
  h.tasks.create({ type: "ops", description: "not mine", projectId: A });
  h.tasks.transition(t1.id, "queued");
  h.tasks.assign(t1.id, "dev");

  const overview = h.svc.getProjection({ projectId: A, mode: "AGENT" });
  assert.deepEqual([...types(overview)].sort(), ["AGENT", "PROJECT"]);
  assert.ok(overview.metadata?.note);

  const scoped = h.svc.getProjection({
    projectId: A,
    mode: "AGENT",
    rootNodeId: "agent-dev",
    depth: 1,
  });
  assert.equal(scoped.rootNodeId, "agent-dev");
  assert.ok(scoped.nodes.some((n) => n.id === "task-t1"));
  assert.equal(
    scoped.nodes.some((n) => n.id === "task-t2"),
    false,
  );
  // a non-agent root is ignored in AGENT mode, not honoured
  const bad = h.svc.getProjection({
    projectId: A,
    mode: "AGENT",
    rootNodeId: "task-t1",
  });
  assert.deepEqual([...types(bad)].sort(), ["AGENT", "PROJECT"]);
});

test("WORKFLOW mode uses real workflow specs and their dependencies", () => {
  const h = build();
  h.workflows.create({
    name: "Delivery",
    description: "d",
    projectId: A,
    participatingAgents: ["dev"],
    tasks: [
      { id: "analyze", type: "ops", description: "Analyze", agentId: "dev" },
      {
        id: "build",
        type: "ops",
        description: "Build",
        agentId: "dev",
        dependsOn: ["analyze"],
      },
    ],
  });
  const g = h.svc.getProjection({ projectId: A, mode: "WORKFLOW" });
  const steps = g.nodes.filter((n) => n.type === "WORKFLOW_STEP");
  assert.equal(steps.length, 2);
  assert.ok(
    g.edges.some(
      (e) =>
        e.type === "DEPENDS_ON" &&
        e.source.endsWith("-build") &&
        e.target.endsWith("-analyze"),
    ),
  );
  assert.equal(
    g.nodes.some((n) => n.type === "TASK"),
    false,
  );

  const empty = build().svc.getProjection({ projectId: A, mode: "WORKFLOW" });
  assert.ok(empty.metadata?.note);
});

test("DEPENDENCY mode: tasks only, blocking vs satisfied, cycle-safe, root scoping", () => {
  const h = build({ ids: ["d1", "d2", "d3", "lone"] });
  h.tasks.create({ type: "ops", description: "1", projectId: A });
  h.tasks.create({
    type: "ops",
    description: "2",
    projectId: A,
    dependencies: ["d1"],
  });
  h.tasks.create({
    type: "ops",
    description: "3",
    projectId: A,
    dependencies: ["d2", "d3"],
  }); // d3 self-cycle
  h.tasks.create({ type: "ops", description: "lone", projectId: A });
  const g = h.svc.getProjection({ projectId: A, mode: "DEPENDENCY" });
  assert.deepEqual([...types(g)], ["TASK"]);
  assert.equal(
    g.nodes.some((n) => n.id === "task-lone"),
    false,
  );
  const edge = g.edges.find((e) => e.id === "task-dep-d2-d1")!;
  assert.equal(edge.status, "blocking");
  assert.equal(
    g.nodes.find((n) => n.id === "task-d1")!.metadata?.downstreamDependents,
    1,
  );

  const scoped = h.svc.getProjection({
    projectId: A,
    mode: "DEPENDENCY",
    rootNodeId: "task-d1",
    depth: 1,
  });
  assert.deepEqual(
    scoped.nodes.map((n) => n.id),
    ["task-d1", "task-d2"],
  );
  assert.equal(scoped.truncated, true);
});

test("DEPENDENCY: completed dependency is satisfied", () => {
  const h = build({ ids: ["x1", "x2"] });
  const x1 = h.tasks.create({ type: "ops", description: "1", projectId: A });
  h.tasks.create({
    type: "ops",
    description: "2",
    projectId: A,
    dependencies: ["x1"],
  });
  h.tasks.transition(x1.id, "queued");
  h.tasks.transition(x1.id, "running");
  h.tasks.complete(x1.id, {});
  const g = h.svc.getProjection({ projectId: A, mode: "DEPENDENCY" });
  assert.equal(g.edges[0].status, "satisfied");
});

test("ENVIRONMENT mode: Project → Task → Router → Environment from real routing only", () => {
  const h = build({
    ids: ["e1", "e2"],
    routes: [
      { taskId: "e1", code: "docker", status: "routed", detail: "ok" },
      { taskId: "e2", code: "xcode", status: "no_environment", detail: "none" },
      {
        taskId: "ghost-from-other-project",
        code: "unity",
        status: "routed",
        detail: "x",
      },
    ],
  });
  h.tasks.create({
    type: "ops",
    description: "1",
    projectId: A,
    environmentRequirements: ["docker"],
  });
  h.tasks.create({
    type: "ops",
    description: "2",
    projectId: A,
    environmentRequirements: ["xcode"],
  });
  h.tasks.create({ type: "ops", description: "unrouted", projectId: A });
  const g = h.svc.getProjection({ projectId: A, mode: "ENVIRONMENT" });
  assert.ok(g.nodes.some((n) => n.type === "ENVIRONMENT_ROUTER"));
  const docker = g.nodes.find((n) => n.id === "env-docker")!;
  const xcode = g.nodes.find((n) => n.id === "env-xcode")!;
  assert.equal(docker.state, "active");
  assert.notEqual(xcode.state, "active");
  assert.equal(
    g.nodes.some((n) => n.id === "env-unity"),
    false,
    "no fabricated / foreign environment",
  );
  assert.equal(
    g.nodes.some((n) => n.label === "unrouted"),
    false,
  );
  assert.ok(g.edges.some((e) => e.type === "EXECUTES_IN"));
});

test("ENVIRONMENT mode without routing state says so instead of inventing environments", () => {
  const g = build().svc.getProjection({ projectId: A, mode: "ENVIRONMENT" });
  assert.equal(
    g.nodes.some((n) => n.type === "ENVIRONMENT"),
    false,
  );
  assert.ok(g.metadata?.note);
});

test("KNOWLEDGE mode: registered, project-scoped sources only", () => {
  const knowledge = new KnowledgeSourceRegistry();
  knowledge.register({
    id: "arch",
    kind: "architecture",
    title: "Architecture",
    projectIds: [A],
    usedByAgentIds: ["dev", "foreign"],
    referencesSourceIds: ["pol", "secret-b"],
    describesTaskIds: ["k1"],
  });
  knowledge.register({
    id: "pol",
    kind: "policy",
    title: "Policy",
    projectIds: ["*"],
  });
  knowledge.register({
    id: "secret-b",
    kind: "documentation",
    title: "B only",
    projectIds: [B],
  });
  const h = build({ ids: ["k1"], knowledge });
  h.tasks.create({ type: "ops", description: "k", projectId: A });
  const g = h.svc.getProjection({ projectId: A, mode: "KNOWLEDGE" });
  const ids = g.nodes.map((n) => n.id);
  assert.ok(ids.includes("knowledge-arch") && ids.includes("knowledge-pol"));
  assert.equal(ids.includes("knowledge-secret-b"), false);
  assert.equal(JSON.stringify(g).includes("B only"), false);
  assert.equal(ids.includes("agent-foreign"), false);
  assert.ok(
    g.edges.some((e) => e.type === "USED_BY" && e.target === "agent-dev"),
  );
  assert.ok(
    g.edges.some(
      (e) => e.type === "REFERENCES" && e.target === "knowledge-pol",
    ),
  );
  assert.equal(
    g.edges.some((e) => e.target === "knowledge-secret-b"),
    false,
  );
  assert.ok(
    g.edges.some((e) => e.type === "DESCRIBES" && e.target === "task-k1"),
  );

  const none = build().svc.getProjection({ projectId: A, mode: "KNOWLEDGE" });
  assert.equal(
    none.nodes.some((n) => n.type === "KNOWLEDGE_SOURCE"),
    false,
  );
  assert.ok(none.metadata?.note);
});

test("every mode is deterministic, bounded, and free of dangling edges", () => {
  const knowledge = new KnowledgeSourceRegistry();
  knowledge.register({
    id: "doc",
    kind: "documentation",
    title: "Docs",
    projectIds: [A],
  });
  const h = build({
    ids: ["m1", "m2"],
    knowledge,
    routes: [{ taskId: "m1", code: "docker", status: "routed", detail: "" }],
  });
  h.tasks.create({ type: "ops", description: "1", projectId: A });
  h.tasks.create({
    type: "ops",
    description: "2",
    projectId: A,
    dependencies: ["m1"],
  });
  for (const mode of GRAPH_MODES as readonly GraphMode[]) {
    const one = h.svc.getProjection({ projectId: A, mode });
    const two = h.svc.getProjection({ projectId: A, mode });
    assert.deepEqual(one, two, mode);
    const ids = new Set(one.nodes.map((n) => n.id));
    assert.ok(one.nodes.length <= 500);
    for (const e of one.edges)
      assert.ok(ids.has(e.source) && ids.has(e.target), `${mode} dangling`);
    assert.equal(
      one.nodes.some((n) => n.projectId !== A),
      false,
    );
  }
});

test("authorisation applies to every mode", () => {
  const h = build();
  const svc = new GraphQueryService({
    agents: h.agents,
    tasks: h.tasks,
    workflows: h.workflows,
    approvals: new ApprovalSystem(),
    permissions: new PermissionSystem([]),
    tools: new ToolRegistry(new AuditLog()),
    projects: h.projects,
    audit: new AuditLog(),
    agentOps: h.agentOps,
    workflowControl: new WorkflowControlStore(),
  } as unknown as ControlPlaneContext);
  const outsider = { id: "o", role: "operator" as const, allowedProjects: [B] };
  for (const mode of GRAPH_MODES) {
    assert.equal(
      svc.getWorkforceGraph(outsider, { projectId: A, mode }),
      undefined,
      mode,
    );
  }
});
