/**
 * Registering the first production project must not widen anyone's access:
 * scoped operators still see nothing, and the health detail no longer leaks
 * project ids.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  PRODUCTION_WORKFORCE_CONFIGURATION,
  createMoneyMindProductionBinding,
  createProductionWorkforceBootstrap,
} from "../api/index.js";
import {
  AgentOperationalStore,
  GraphQueryService,
  WorkflowControlStore,
  WorkforceQueryService,
  type ControlPlaneContext,
} from "../control/index.js";
import {
  ApprovalSystem,
  AuditLog,
  PermissionSystem,
  TaskSystem,
  ToolRegistry,
  WorkflowSystem,
  type OperatorPrincipal,
} from "../core/index.js";

function setup() {
  const audit = new AuditLog();
  const bootstrap = createProductionWorkforceBootstrap({
    ...PRODUCTION_WORKFORCE_CONFIGURATION,
    projectAdapters: [createMoneyMindProductionBinding({})],
  });
  const ctx = {
    agents: bootstrap.agents,
    tasks: new TaskSystem(),
    workflows: new WorkflowSystem(),
    approvals: new ApprovalSystem(),
    permissions: new PermissionSystem([]),
    tools: new ToolRegistry(audit),
    projects: bootstrap.projects,
    audit,
    agentOps: new AgentOperationalStore(),
    workflowControl: new WorkflowControlStore(),
  } as unknown as ControlPlaneContext;
  return { ctx, query: new WorkforceQueryService(ctx) };
}

const admin: OperatorPrincipal = {
  id: "a",
  role: "admin",
  allowedProjects: "*",
};
const member: OperatorPrincipal = {
  id: "m",
  role: "viewer",
  allowedProjects: ["money-mind"],
};
const scoped: OperatorPrincipal = {
  id: "s",
  role: "operator",
  allowedProjects: ["some-other"],
};
const none: OperatorPrincipal = {
  id: "n",
  role: "viewer",
  allowedProjects: [],
};

test("only operators granted the project (or '*') can see it", async () => {
  const { query } = setup();
  assert.deepEqual(
    (await query.getProjects(admin)).map((p) => p.projectId),
    ["money-mind"],
  );
  assert.deepEqual(
    (await query.getProjects(member)).map((p) => p.projectId),
    ["money-mind"],
  );
  for (const p of [scoped, none]) {
    assert.deepEqual(await query.getProjects(p), []);
    assert.equal(await query.getProject(p, "money-mind"), undefined);
  }
});

test("the project view exposes no repository URL or source-availability internals", async () => {
  const { query } = setup();
  const view = await query.getProject(member, "money-mind");
  const json = JSON.stringify(view);
  assert.ok(view);
  assert.equal(json.includes("github.com"), false);
  assert.equal(json.includes("sourceAvailable"), false);
});

test("graph access follows project scope for the registered project", () => {
  const { ctx } = setup();
  const graph = new GraphQueryService({
    ...ctx,
    softwareFactory: undefined,
  } as ControlPlaneContext);
  assert.ok(graph.getWorkforceGraph(member, { projectId: "money-mind" }));
  assert.equal(
    graph.getWorkforceGraph(scoped, { projectId: "money-mind" }),
    undefined,
  );
  assert.equal(
    graph.getWorkforceGraph(none, { projectId: "money-mind" }),
    undefined,
  );
});

test("system health does not disclose project ids to scoped operators", () => {
  const { query } = setup();
  const health = JSON.stringify(query.getSystemHealth(scoped));
  assert.equal(health.includes("money-mind"), false);
  assert.match(health, /1 project adapter registered/);
});
