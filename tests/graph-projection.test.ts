/**
 * EO-5.5 / EO-5.6 — workforce graph projection, query authorisation, bounds.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentOperationalStore,
  GraphQueryService,
  parseGraphQueryParams,
  type ControlPlaneContext,
} from "../control/index.js";
import {
  WorkforceGraphProjectionService,
  boundedView,
  resolveBounds,
} from "../core/orchestrator/graph-projection.js";
import { toGraphState } from "../core/orchestrator/graph-state.js";
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
  type OperatorPrincipal,
  type ProjectAdapter,
} from "../core/index.js";
import { WorkflowControlStore } from "../control/index.js";
import {
  GRAPH_LIMITS,
  type WorkforceGraphEdge,
  type WorkforceGraphNode,
} from "../contracts/graph.js";
import { NotFoundError, ValidationError } from "../contracts/index.js";

const A = "proj-a";
const B = "proj-b";

function agent(
  id: string,
  projects: string[],
  extra: Partial<Agent> = {},
): Agent {
  return {
    id,
    name: id,
    description: `${id} role`,
    capabilities: ["code"],
    allowedTools: [],
    allowedProjects: projects,
    supportedTaskTypes: ["ops"],
    permissions: [],
    ...extra,
  };
}

function adapter(projectId: string): ProjectAdapter {
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

function build(taskIds: string[] = []) {
  let i = 0;
  const tasks = new TaskSystem(undefined, {
    newId: () => taskIds[i++] ?? `auto-${++i}`,
  });
  const agents = new AgentRegistry();
  agents.register(
    agent("dev", [A], {
      metadata: { apiKey: "sk-secret-value" },
      modelPolicy: { provider: "anthropic", model: "claude-x" },
    }),
  );
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
    undefined,
    { agentOps, workflows },
    () => new Date("2026-01-01T00:00:00.000Z"),
  );
  return { tasks, agents, projects, workflows, agentOps, svc };
}

const byType = (nodes: WorkforceGraphNode[], type: string) =>
  nodes.filter((n) => n.type === type);

test("projection carries operational state, whitelisted metadata and ordering", () => {
  const h = build(["t1", "t2"]);
  const t1 = h.tasks.create({ type: "ops", description: "one", projectId: A });
  h.tasks.transition(t1.id, "queued");
  h.tasks.assign(t1.id, "dev"); // queued -> running with an assignee
  h.tasks.create({
    type: "ops",
    description: "two",
    projectId: A,
    dependencies: ["t1"],
  });
  const g = h.svc.getProjection({ projectId: A });

  assert.equal(g.mode, "WORKFORCE");
  assert.equal(g.truncated, false);
  const task1 = g.nodes.find((n) => n.id === "task-t1")!;
  assert.equal(task1.state, "running");
  assert.equal(g.nodes.find((n) => n.id === "task-t2")!.state, "queued");
  // running task => agent is running
  assert.equal(g.nodes.find((n) => n.id === "agent-dev")!.state, "running");
  assert.ok(
    g.edges.some((e) => e.id === "task-dep-t2-t1" && e.type === "DEPENDS_ON"),
  );
  assert.ok(
    g.edges.some(
      (e) => e.id === "agent-assigned-t1" && e.type === "ASSIGNED_TO",
    ),
  );
  const ids = g.nodes.map((n) => n.id);
  assert.deepEqual(ids, [...ids].sort());
});

test("agent metadata is whitelisted: no secrets from agent.metadata leak", () => {
  const h = build();
  const g = h.svc.getProjection({ projectId: A });
  const dev = g.nodes.find((n) => n.id === "agent-dev")!;
  assert.equal(dev.metadata?.model, "claude-x");
  assert.equal(JSON.stringify(g).includes("sk-secret-value"), false);
  assert.equal(JSON.stringify(g).includes("apiKey"), false);
});

test("disabled agents project as offline; no cost is fabricated", () => {
  const h = build();
  h.agentOps.disable("dev", "op-1", "maintenance");
  const g = h.svc.getProjection({ projectId: A });
  const dev = g.nodes.find((n) => n.id === "agent-dev")!;
  assert.equal(dev.state, "offline");
  assert.equal(dev.metadata && "cost" in dev.metadata, false);
});

test("project isolation: other projects' agents, tasks and dependencies never appear", () => {
  const h = build(["a1", "b1"]);
  h.tasks.create({
    type: "ops",
    description: "a task depending on foreign task",
    projectId: A,
    dependencies: ["b1"],
  });
  h.tasks.create({ type: "ops", description: "b task", projectId: B });
  const g = h.svc.getProjection({ projectId: A });
  assert.equal(
    g.nodes.some((n) => n.projectId !== A),
    false,
  );
  assert.equal(
    g.nodes.some((n) => n.id === "agent-foreign"),
    false,
  );
  assert.equal(
    g.nodes.some((n) => n.id === "task-b1"),
    false,
  );
  const nodeIds = new Set(g.nodes.map((n) => n.id));
  for (const e of g.edges) {
    assert.ok(
      nodeIds.has(e.source) && nodeIds.has(e.target),
      "no dangling edge",
    );
  }
  assert.equal(
    g.edges.some((e) => e.id === "task-dep-a1-b1"),
    false,
  );
});

test("projection is deterministic for identical state", () => {
  const h = build(["t1", "t2", "t3"]);
  for (const d of ["x", "y", "z"]) {
    h.tasks.create({ type: "ops", description: d, projectId: A });
  }
  const one = h.svc.getProjection({ projectId: A });
  const two = h.svc.getProjection({ projectId: A });
  assert.deepEqual(one, two);
  assert.equal(one.revision, two.revision);
});

test("node bounds: maxNodes caps output, sets truncated, and clamps abusive input", () => {
  const h = build();
  for (let n = 0; n < 40; n += 1) {
    h.tasks.create({ type: "ops", description: `t${n}`, projectId: A });
  }
  const capped = h.svc.getProjection({ projectId: A, maxNodes: 10 });
  assert.equal(capped.nodes.length, 10);
  assert.equal(capped.truncated, true);

  const abusive = h.svc.getProjection({
    projectId: A,
    maxNodes: 10_000_000,
    depth: 9999,
    maxEdges: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(abusive.appliedLimits.maxNodes, GRAPH_LIMITS.maxNodes);
  assert.equal(abusive.appliedLimits.depth, GRAPH_LIMITS.maxDepth);
  assert.equal(abusive.appliedLimits.maxEdges, GRAPH_LIMITS.maxEdges);
  assert.deepEqual(resolveBounds({ projectId: A, maxNodes: -5, depth: NaN }), {
    depth: GRAPH_LIMITS.defaultDepth,
    maxNodes: 1,
    maxEdges: GRAPH_LIMITS.maxEdges,
  });
});

test("depth/root scoping is bounded and cycle-safe", () => {
  const h = build(["c1", "c2", "c3"]);
  h.tasks.create({
    type: "ops",
    description: "1",
    projectId: A,
    dependencies: ["c2"],
  });
  h.tasks.create({
    type: "ops",
    description: "2",
    projectId: A,
    dependencies: ["c3"],
  });
  h.tasks.create({
    type: "ops",
    description: "3",
    projectId: A,
    dependencies: ["c1"],
  }); // cycle
  const g = h.svc.getProjection({
    projectId: A,
    rootNodeId: "task-c1",
    depth: 1,
  });
  assert.equal(g.rootNodeId, "task-c1");
  assert.ok(g.nodes.some((n) => n.id === "task-c1"));
  assert.equal(g.truncated, true);
  // unknown root is ignored, not an error and not a leak
  const unknown = h.svc.getProjection({
    projectId: A,
    rootNodeId: "task-nope",
  });
  assert.equal(unknown.rootNodeId, undefined);

  const nodes = [
    {
      id: "n1",
      type: "TASK",
      label: "",
      status: "created",
      state: "queued",
      projectId: A,
      referenceId: "1",
    },
    {
      id: "n2",
      type: "TASK",
      label: "",
      status: "created",
      state: "queued",
      projectId: A,
      referenceId: "2",
    },
  ] as WorkforceGraphNode[];
  const edges = [
    { id: "e1", type: "DEPENDS_ON", source: "n1", target: "n2" },
    { id: "e2", type: "DEPENDS_ON", source: "n2", target: "n1" },
  ] as WorkforceGraphEdge[];
  const view = boundedView(nodes, edges, "n1", {
    depth: 50,
    maxNodes: 10,
    maxEdges: 10,
  });
  assert.equal(view.nodes.length, 2);
  assert.equal(view.truncated, false);
});

test("workflows project with progress and membership", () => {
  const h = build();
  h.workflows.create({
    name: "wf",
    description: "d",
    projectId: A,
    participatingAgents: ["dev"],
    tasks: [{ id: "s1", type: "ops", description: "s", agentId: "dev" }],
  });
  const g = h.svc.getProjection({ projectId: A });
  const wf = byType(g.nodes, "WORKFLOW");
  assert.equal(wf.length, 1);
  assert.equal(wf[0].metadata?.progressPercent, 0);
  assert.ok(g.edges.some((e) => e.type === "BELONGS_TO"));
  assert.ok(g.edges.some((e) => e.type === "PARTICIPATES_IN"));
});

test("state mapping never invents a state", () => {
  assert.equal(toGraphState("running"), "running");
  assert.equal(toGraphState("awaiting_approval"), "blocked");
  assert.equal(toGraphState("something-new"), "unavailable");
  assert.equal(toGraphState(undefined), "unavailable");
});

/* ---- Control-plane authorisation + query parsing ---- */

function ctxFor(h: ReturnType<typeof build>): ControlPlaneContext {
  return {
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
    orchestrator: {
      recordApprovalDecision: async () => ({}) as never,
      resume: async () => ({}) as never,
    },
  } as unknown as ControlPlaneContext;
}

test("GraphQueryService enforces project authorisation before projecting", () => {
  const h = build(["t1"]);
  h.tasks.create({ type: "ops", description: "x", projectId: A });
  const service = new GraphQueryService(ctxFor(h));
  const viewer: OperatorPrincipal = {
    id: "v",
    role: "viewer",
    allowedProjects: "*",
  };
  const scoped: OperatorPrincipal = {
    id: "s",
    role: "operator",
    allowedProjects: [B],
  };
  const none: OperatorPrincipal = {
    id: "n",
    role: "viewer",
    allowedProjects: [],
  };

  assert.ok(service.getWorkforceGraph(viewer, { projectId: A }));
  assert.equal(service.getWorkforceGraph(scoped, { projectId: A }), undefined);
  assert.equal(service.getWorkforceGraph(none, { projectId: A }), undefined);
  assert.throws(() =>
    service.getWorkforceGraph(
      { id: "", role: "viewer", allowedProjects: "*" },
      { projectId: A },
    ),
  );
});

test("graph query params are validated", () => {
  const ok = parseGraphQueryParams(
    A,
    new URLSearchParams(
      "mode=dependency&depth=2&maxNodes=50&rootNodeId=task-1",
    ),
  );
  assert.deepEqual(ok, {
    projectId: A,
    mode: "DEPENDENCY",
    depth: 2,
    maxNodes: 50,
    rootNodeId: "task-1",
  });
  assert.throws(
    () => parseGraphQueryParams(A, new URLSearchParams("mode=bogus")),
    ValidationError,
  );
  assert.throws(
    () => parseGraphQueryParams(A, new URLSearchParams("depth=-1")),
    ValidationError,
  );
  assert.throws(
    () => parseGraphQueryParams(A, new URLSearchParams("depth=abc")),
    ValidationError,
  );
  assert.throws(
    () => parseGraphQueryParams(A, new URLSearchParams("maxNodes=0")),
    ValidationError,
  );
  assert.throws(
    () => parseGraphQueryParams(A, new URLSearchParams("rootNodeId=../../etc")),
    ValidationError,
  );
});

test("free-text labels are scrubbed of credential shapes", () => {
  const h = build(["s1"]);
  h.tasks.create({
    type: "ops",
    description: "deploy with token=abc123XYZ and sk-live_ABCDEFGH1234 now",
    projectId: A,
  });
  const g = h.svc.getProjection({ projectId: A });
  const json = JSON.stringify(g);
  assert.equal(json.includes("abc123XYZ"), false);
  assert.equal(json.includes("sk-live_ABCDEFGH1234"), false);
  assert.ok(json.includes("[redacted]"));
});

test("unknown project is a NotFoundError (404), not a generic error", () => {
  const h = build();
  assert.throws(
    () => h.svc.getProjection({ projectId: "ghost" }),
    NotFoundError,
  );
});
