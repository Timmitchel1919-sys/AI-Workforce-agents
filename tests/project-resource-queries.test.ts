/**
 * CP-8C — Project resource query contracts.
 *
 * Authoritative, server-side queries for a Project's Agents, Tasks, and
 * Workflows:
 *
 *   GET /projects/:projectId/agents
 *   GET /tasks?projectId=...        (already project-scoped; bounded here)
 *   GET /workflows?projectId=...
 *
 * The Control Plane (WorkforceQueryService) resolves project membership; the
 * frontend never reads Firestore, downloads global registries, or joins
 * membership client-side.
 */
import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { createControlPlaneApi, type ApiHandler } from "../api/index.js";
import {
  AgentOperationalStore,
  WorkflowControlStore,
  WorkforceQueryService,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type ControlPlaneContext,
  type WorkforceCommandService,
} from "../control/index.js";
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
  type ProjectAdapter,
} from "../core/index.js";
import type { OperatorDirectory } from "../contracts/index.js";

/* ------------------------------------------------------------------ */
/* Harness                                                            */
/* ------------------------------------------------------------------ */

const PROJECT = "money-mind";
const OTHER = "aims";
const EMPTY = "empty-project";
const GHOST = "ghost-project";

function makeAgent(id: string, allowedProjects: readonly string[]): Agent {
  return {
    id,
    name: id.replace(/-/g, " "),
    description: `${id} test agent`,
    capabilities: ["testing"],
    allowedTools: [],
    allowedProjects,
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

function makeWorkflowDraft(
  projectId: string,
  agentId: string,
): Parameters<WorkflowSystem["create"]>[0] {
  return {
    name: `workflow for ${projectId}`,
    description: "test workflow",
    projectId,
    participatingAgents: [agentId],
    tasks: [
      {
        id: "step",
        type: "ops",
        description: "step one",
        agentId,
      },
    ],
  };
}

const VIEWER: OperatorPrincipal = {
  id: "viewer-1",
  role: "viewer",
  allowedProjects: "*",
};
const SCOPED: OperatorPrincipal = {
  id: "scoped-1",
  role: "operator",
  allowedProjects: [OTHER],
};

interface Harness {
  ctx: ControlPlaneContext;
  query: WorkforceQueryService;
  tasks: TaskSystem;
  workflows: WorkflowSystem;
  agents: AgentRegistry;
  projects: ProjectRegistry;
}

function harness(options: { includeGlobalAgent?: boolean } = {}): Harness {
  const includeGlobal = options.includeGlobalAgent ?? true;
  const audit = new AuditLog();
  const agents = new AgentRegistry();

  agents.register(makeAgent("project-agent", [PROJECT]));
  agents.register(makeAgent("other-agent", [OTHER]));
  if (includeGlobal) agents.register(makeAgent("global-agent", []));

  const tasks = new TaskSystem();
  const workflows = new WorkflowSystem();
  const approvals = new ApprovalSystem();
  const permissions = new PermissionSystem([
    { effect: "allow", action: "read", projectId: PROJECT },
    { effect: "allow", action: "read", projectId: OTHER },
  ]);
  const handoffs = new HandoffSystem();
  const tools = new ToolRegistry(audit);
  const projects = new ProjectRegistry();
  projects.register(stubAdapter(PROJECT), { displayName: "Money Mind" });
  projects.register(stubAdapter(OTHER), { displayName: "Aims" });
  projects.register(stubAdapter(EMPTY), { displayName: "Empty" });

  const agentOps = new AgentOperationalStore();
  const workflowControl = new WorkflowControlStore();

  const orchestrator = new Orchestrator(
    agents,
    tasks,
    handoffs,
    audit,
    { execute: async () => ({ ok: true }) },
    approvals,
    { permissions, agentGate: agentOps },
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
    orchestrator: {
      recordApprovalDecision:
        orchestrator.recordApprovalDecision.bind(orchestrator),
      resume: orchestrator.resume.bind(orchestrator),
    },
  };

  return {
    ctx,
    query: new WorkforceQueryService(ctx),
    tasks,
    workflows,
    agents,
    projects,
  };
}

function seedTasks(h: Harness, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    ids.push(
      h.tasks.create({
        type: "ops",
        description: `task ${i}`,
        projectId: PROJECT,
      }).id,
    );
  }
  return ids;
}

function seedWorkflows(h: Harness, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    ids.push(
      h.workflows.create(makeWorkflowDraft(PROJECT, "project-agent")).id,
    );
  }
  return ids;
}

const directory: OperatorDirectory = {
  async resolve(credential) {
    if (credential === "viewer") return VIEWER;
    if (credential === "scoped") return SCOPED;
    return null;
  },
};

function makeApi(h: Harness): ApiHandler {
  return createControlPlaneApi({
    query: h.query,
    command: {} as unknown as WorkforceCommandService,
    operatorDirectory: directory,
  });
}

async function withServer<T>(
  handler: ApiHandler,
  fn: (base: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/* ================================================================== */
/* GET /projects/:projectId/agents                                    */
/* ================================================================== */

test("project agents: returns the Agents connected to the Project", async () => {
  const h = harness();
  const agents = await h.query.getProjectAgents(VIEWER, PROJECT);

  assert.ok(agents);
  const ids = agents.map((a) => a.agentId).sort();
  // project-agent allows PROJECT; global-agent is project-neutral.
  assert.deepEqual(ids, ["global-agent", "project-agent"]);
});

test("project agents: multiple connected Agents resolve as AgentViews", async () => {
  const h = harness();
  h.agents.register(makeAgent("extra-project-agent", [PROJECT]));
  h.agents.register(makeAgent("project-second", [PROJECT]));
  const agents = await h.query.getProjectAgents(VIEWER, PROJECT);
  assert.ok(agents);
  assert.equal(agents.length, 4); // three project agents + one neutral
  assert.ok(agents.every((a) => "stats" in a && "enabled" in a));
});

test("project agents: Project with zero Agents returns an empty collection", async () => {
  const h = harness({ includeGlobalAgent: false });
  const agents = await h.query.getProjectAgents(VIEWER, EMPTY);
  assert.deepEqual(agents, []);
});

test("project agents: nonexistent Project resolves to not-found (no fabricated empty project)", async () => {
  const h = harness();
  assert.equal(await h.query.getProjectAgents(VIEWER, GHOST), undefined);
});

test("project agents: malformed Project ID resolves to not-found", async () => {
  const h = harness();
  assert.equal(await h.query.getProjectAgents(VIEWER, "  "), undefined);
  assert.equal(await h.query.getProjectAgents(VIEWER, ""), undefined);
});

test("project agents: dangling Agent references cannot surface (derived from the live registry)", async () => {
  const h = harness();
  const agents = await h.query.getProjectAgents(VIEWER, PROJECT);
  assert.ok(agents);
  for (const view of agents) {
    // Every returned Agent is a live registry entry — a stale stored id would
    // be skipped, never fabricated, and never crash the endpoint.
    assert.equal(h.agents.has(view.agentId), true);
  }
  // ProjectView.connectedAgents and the scoped query agree on membership.
  const projectView = await h.query.getProject(VIEWER, PROJECT);
  assert.ok(projectView);
  assert.deepEqual(
    [...projectView.connectedAgents].sort(),
    agents.map((a) => a.agentId).sort(),
  );
});

test("project agents: duplicate allowed-project references yield no duplicate Agents", async () => {
  const h = harness();
  h.agents.register(makeAgent("dup-agent", [PROJECT, PROJECT]));
  const agents = await h.query.getProjectAgents(VIEWER, PROJECT);
  assert.ok(agents);
  const count = agents.filter((a) => a.agentId === "dup-agent").length;
  assert.equal(count, 1);
});

test("project agents: an out-of-scope operator cannot read another Project's Agents", async () => {
  const h = harness();
  // SCOPED may only access OTHER — PROJECT must not be observable.
  assert.equal(await h.query.getProjectAgents(SCOPED, PROJECT), undefined);
  const theirs = await h.query.getProjectAgents(SCOPED, OTHER);
  assert.ok(theirs);
  assert.deepEqual(theirs.map((a) => a.agentId).sort(), [
    "global-agent",
    "other-agent",
  ]);
});

test("project agents: HTTP — authorized query returns an AgentView array", async () => {
  const h = harness();
  await withServer(makeApi(h), async (base) => {
    const res = await fetch(`${base}/api/projects/${PROJECT}/agents`, {
      headers: { authorization: "Bearer viewer" },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Array<{ agentId: string }>;
    assert.deepEqual(body.map((a) => a.agentId).sort(), [
      "global-agent",
      "project-agent",
    ]);
  });
});

test("project agents: HTTP — unknown project and malformed id are 404", async () => {
  const h = harness();
  await withServer(makeApi(h), async (base) => {
    const ghost = await fetch(`${base}/api/projects/${GHOST}/agents`, {
      headers: { authorization: "Bearer viewer" },
    });
    assert.equal(ghost.status, 404);
    assert.deepEqual(await ghost.json(), {
      error: { message: "resource not found" },
    });

    const blank = await fetch(`${base}/api/projects/%20%20/agents`, {
      headers: { authorization: "Bearer viewer" },
    });
    assert.equal(blank.status, 404);
  });
});

test("project agents: HTTP — zero-Agent Project returns an empty array, not an error", async () => {
  const h = harness({ includeGlobalAgent: false });
  await withServer(makeApi(h), async (base) => {
    const res = await fetch(`${base}/api/projects/${EMPTY}/agents`, {
      headers: { authorization: "Bearer viewer" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  });
});

test("project agents: HTTP — unauthenticated request is 401", async () => {
  const h = harness();
  await withServer(makeApi(h), async (base) => {
    const res = await fetch(`${base}/api/projects/${PROJECT}/agents`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), {
      error: { message: "authentication required" },
    });
  });
});

test("project agents: HTTP — forbidden (out-of-scope) request is indistinguishable from not-found", async () => {
  const h = harness();
  await withServer(makeApi(h), async (base) => {
    const res = await fetch(`${base}/api/projects/${PROJECT}/agents`, {
      headers: { authorization: "Bearer scoped" },
    });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), {
      error: { message: "resource not found" },
    });
  });
});

/* ================================================================== */
/* GET /tasks?projectId=...                                           */
/* ================================================================== */

test("tasks: projectId filter is authoritative and project-safe", () => {
  const h = harness();
  const aIds = seedTasks(h, 3);
  h.tasks.create({ type: "ops", description: "b", projectId: OTHER });

  const mine = h.query.getTasks(VIEWER, { projectId: PROJECT, limit: 50 });
  assert.deepEqual(mine.items.map((t) => t.taskId).sort(), [...aIds].sort());

  const theirs = h.query.getTasks(VIEWER, { projectId: OTHER, limit: 50 });
  assert.deepEqual(
    theirs.items.map((t) => t.taskId),
    [h.tasks.list().find((t) => t.projectId === OTHER)!.id],
  );
});

test("tasks: Project A cannot return Project B tasks", () => {
  const h = harness();
  seedTasks(h, 4);
  h.tasks.create({ type: "ops", description: "b", projectId: OTHER });

  const q = h.query.getTasks(VIEWER, { projectId: PROJECT, limit: 100 });
  assert.ok(q.items.length >= 4);
  assert.ok(q.items.every((t) => t.projectId === PROJECT));
});

test("tasks: empty result for a Project without tasks", () => {
  const h = harness();
  const q = h.query.getTasks(VIEWER, { projectId: EMPTY });
  assert.equal(q.items.length, 0);
  assert.equal(q.total, 0);
  assert.equal(q.nextCursor, null);
});

test("tasks: unknown-project filter is an empty collection (filter semantics)", () => {
  const h = harness();
  const q = h.query.getTasks(VIEWER, { projectId: GHOST });
  assert.deepEqual(q, { items: [], total: 0, nextCursor: null });
});

test("tasks: pagination first page / next page / no next page", () => {
  const h = harness();
  const ids = seedTasks(h, 12);

  const first = h.query.getTasks(VIEWER, {
    projectId: PROJECT,
    limit: 5,
  });
  assert.equal(first.items.length, 5);
  assert.equal(first.total, 12);
  assert.equal(first.nextCursor, "5");

  const second = h.query.getTasks(VIEWER, {
    projectId: PROJECT,
    limit: 5,
    cursor: first.nextCursor ?? undefined,
  });
  assert.equal(second.items.length, 5);
  assert.equal(second.nextCursor, "10");

  const third = h.query.getTasks(VIEWER, {
    projectId: PROJECT,
    limit: 5,
    cursor: second.nextCursor ?? undefined,
  });
  assert.equal(third.items.length, 2);
  assert.equal(third.nextCursor, null);

  const seen = new Set(
    [...first.items, ...second.items, ...third.items].map((t) => t.taskId),
  );
  assert.equal(seen.size, 12);
  assert.deepEqual([...seen].sort(), [...ids].sort());
});

test("tasks: maximum page size is enforced server-side", () => {
  const h = harness();
  seedTasks(h, MAX_PAGE_SIZE + 15);

  const page = h.query.getTasks(VIEWER, {
    projectId: PROJECT,
    limit: 1_000_000,
  });
  assert.equal(page.items.length, MAX_PAGE_SIZE);
  assert.equal(page.total, MAX_PAGE_SIZE + 15);
  assert.equal(page.nextCursor, String(MAX_PAGE_SIZE));
});

test("tasks: invalid limit falls back to the default page size", () => {
  const h = harness();
  seedTasks(h, DEFAULT_PAGE_SIZE + 5);
  const page = h.query.getTasks(VIEWER, {
    projectId: PROJECT,
    limit: Number.NaN as unknown as number,
  });
  assert.equal(page.items.length, DEFAULT_PAGE_SIZE);
});

test("tasks: invalid cursor is deterministically treated as the first page", () => {
  const h = harness();
  seedTasks(h, 4);
  const expected = h.query.getTasks(VIEWER, { projectId: PROJECT });
  const garbage = h.query.getTasks(VIEWER, {
    projectId: PROJECT,
    cursor: "not-a-number",
  });
  const negative = h.query.getTasks(VIEWER, {
    projectId: PROJECT,
    cursor: "-5",
  });
  assert.deepEqual(
    garbage.items.map((t) => t.taskId),
    expected.items.map((t) => t.taskId),
  );
  assert.deepEqual(
    negative.items.map((t) => t.taskId),
    expected.items.map((t) => t.taskId),
  );
});

test("tasks: deterministic stable ordering (updatedAt desc, id desc tie-break)", () => {
  const h = harness();
  seedTasks(h, 6);
  const one = h.query.getTasks(VIEWER, { projectId: PROJECT, limit: 100 });
  const two = h.query.getTasks(VIEWER, { projectId: PROJECT, limit: 100 });
  assert.deepEqual(
    one.items.map((t) => t.taskId),
    two.items.map((t) => t.taskId),
  );
  for (let i = 1; i < one.items.length; i += 1) {
    const prev = one.items[i - 1]!;
    const cur = one.items[i]!;
    if (prev.updatedAt !== cur.updatedAt) {
      assert.ok(prev.updatedAt >= cur.updatedAt);
    } else {
      assert.ok(prev.taskId.localeCompare(cur.taskId) > 0);
    }
  }
});

test("tasks: filters compose with projectId", () => {
  const h = harness();
  for (let i = 0; i < 4; i += 1) {
    const t = h.tasks.create({
      type: "ops",
      description: `boom ${i}`,
      projectId: PROJECT,
    });
    h.tasks.transition(t.id, "queued");
    h.tasks.assign(t.id, "project-agent");
    if (i % 2 === 0) h.tasks.fail(t.id, "[project-agent:tool_failure] nope");
  }
  const failed = h.query.getTasks(VIEWER, {
    projectId: PROJECT,
    status: "failed",
  });
  assert.equal(failed.items.length, 2);
  assert.ok(failed.items.every((t) => t.projectId === PROJECT));
  assert.ok(failed.items.every((t) => t.status === "failed"));
});

test("tasks: HTTP — projectId composes with status and is clamped server-side", async () => {
  const h = harness();
  seedTasks(h, 3);
  await withServer(makeApi(h), async (base) => {
    const res = await fetch(
      `${base}/api/tasks?projectId=${PROJECT}&limit=1000000`,
      { headers: { authorization: "Bearer viewer" } },
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      items: Array<{ projectId: string }>;
      total: number;
      nextCursor: string | null;
    };
    assert.equal(body.total, 3);
    assert.equal(body.items.length, 3);
    assert.ok(body.items.every((t) => t.projectId === PROJECT));
    assert.equal(body.nextCursor, null);
  });
});

test("tasks: HTTP — unauthenticated request is 401", async () => {
  const h = harness();
  await withServer(makeApi(h), async (base) => {
    const res = await fetch(`${base}/api/tasks?projectId=${PROJECT}`);
    assert.equal(res.status, 401);
  });
});

/* ================================================================== */
/* GET /workflows?projectId=...                                       */
/* ================================================================== */

test("workflows: projectId filter is authoritative", () => {
  const h = harness();
  const wfIds = seedWorkflows(h, 3);
  h.workflows.create(makeWorkflowDraft(OTHER, "other-agent"));

  const mine = h.query.getWorkflows(VIEWER, { projectId: PROJECT, limit: 50 });
  assert.deepEqual(
    mine.items.map((w) => w.workflowId).sort(),
    [...wfIds].sort(),
  );

  const theirs = h.query.getWorkflows(VIEWER, { projectId: OTHER, limit: 50 });
  assert.equal(theirs.items.length, 1);
  assert.equal(theirs.items[0]!.projectId, OTHER);
});

test("workflows: cross-project isolation — scoped operator sees nothing from PROJECT", () => {
  const h = harness();
  seedWorkflows(h, 2);
  h.workflows.create(makeWorkflowDraft(OTHER, "other-agent"));

  const theirs = h.query.getWorkflows(SCOPED, { projectId: OTHER });
  assert.equal(theirs.items.length, 1);

  const outOfScope = h.query.getWorkflows(SCOPED, { projectId: PROJECT });
  assert.equal(outOfScope.items.length, 0);

  // Default listing only shows the operator's own projects.
  const all = h.query.getWorkflows(SCOPED, { limit: 100 });
  assert.ok(all.items.every((w) => w.projectId === OTHER));
});

test("workflows: empty result and unknown-project filter semantics", () => {
  const h = harness();
  const empty = h.query.getWorkflows(VIEWER, { projectId: EMPTY });
  assert.deepEqual(empty, { items: [], total: 0, nextCursor: null });

  const ghost = h.query.getWorkflows(VIEWER, { projectId: GHOST });
  assert.deepEqual(ghost, { items: [], total: 0, nextCursor: null });
});

test("workflows: pagination across pages with no next page", () => {
  const h = harness();
  const ids = seedWorkflows(h, 12);

  const first = h.query.getWorkflows(VIEWER, {
    projectId: PROJECT,
    limit: 5,
  });
  assert.equal(first.items.length, 5);
  assert.equal(first.total, 12);
  assert.equal(first.nextCursor, "5");

  const second = h.query.getWorkflows(VIEWER, {
    projectId: PROJECT,
    limit: 5,
    cursor: first.nextCursor ?? undefined,
  });
  assert.equal(second.items.length, 5);
  assert.equal(second.nextCursor, "10");

  const third = h.query.getWorkflows(VIEWER, {
    projectId: PROJECT,
    limit: 5,
    cursor: second.nextCursor ?? undefined,
  });
  assert.equal(third.items.length, 2);
  assert.equal(third.nextCursor, null);

  const seen = new Set(
    [...first.items, ...second.items, ...third.items].map((w) => w.workflowId),
  );
  assert.equal(seen.size, 12);
  assert.deepEqual([...seen].sort(), [...ids].sort());
});

test("workflows: maximum page size enforced; invalid cursor is page zero", () => {
  const h = harness();
  seedWorkflows(h, MAX_PAGE_SIZE + 5);

  const clamped = h.query.getWorkflows(VIEWER, {
    projectId: PROJECT,
    limit: 1_000_000,
  });
  assert.equal(clamped.items.length, MAX_PAGE_SIZE);

  const invalid = h.query.getWorkflows(VIEWER, {
    projectId: PROJECT,
    cursor: "junk",
  });
  const base = h.query.getWorkflows(VIEWER, { projectId: PROJECT });
  assert.deepEqual(
    invalid.items.map((w) => w.workflowId),
    base.items.map((w) => w.workflowId),
  );
});

test("workflows: deterministic stable ordering (updatedAt desc, id desc tie-break)", () => {
  const h = harness();
  seedWorkflows(h, 6);
  const one = h.query.getWorkflows(VIEWER, { projectId: PROJECT, limit: 100 });
  const two = h.query.getWorkflows(VIEWER, { projectId: PROJECT, limit: 100 });
  assert.deepEqual(
    one.items.map((w) => w.workflowId),
    two.items.map((w) => w.workflowId),
  );
  for (let i = 1; i < one.items.length; i += 1) {
    const prev = one.items[i - 1]!;
    const cur = one.items[i]!;
    if (prev.updatedAt !== cur.updatedAt) {
      assert.ok(prev.updatedAt >= cur.updatedAt);
    } else {
      assert.ok(prev.workflowId.localeCompare(cur.workflowId) > 0);
    }
  }
});

test("workflows: HTTP — projectId filter returns a PageResult envelope", async () => {
  const h = harness();
  seedWorkflows(h, 3);
  await withServer(makeApi(h), async (base) => {
    const res = await fetch(
      `${base}/api/workflows?projectId=${PROJECT}&limit=2`,
      {
        headers: { authorization: "Bearer viewer" },
      },
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      items: Array<{ projectId: string }>;
      total: number;
      nextCursor: string | null;
    };
    assert.equal(body.items.length, 2);
    assert.equal(body.total, 3);
    assert.equal(body.nextCursor, "2");
    assert.ok(body.items.every((w) => w.projectId === PROJECT));
  });
});

test("workflows: HTTP — default listing preserves the PageResult envelope", async () => {
  const h = harness();
  seedWorkflows(h, 2);
  await withServer(makeApi(h), async (base) => {
    const res = await fetch(`${base}/api/workflows`, {
      headers: { authorization: "Bearer viewer" },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      items: unknown[];
      total: number;
      nextCursor: string | null;
    };
    assert.ok(Array.isArray(body.items));
    assert.equal(body.total, 2);
    assert.equal(body.nextCursor, null);
  });
});

test("workflows: HTTP — unauthenticated request is 401", async () => {
  const h = harness();
  await withServer(makeApi(h), async (base) => {
    const res = await fetch(`${base}/api/workflows?projectId=${PROJECT}`);
    assert.equal(res.status, 401);
  });
});

/* ================================================================== */
/* Security regressions                                               */
/* ================================================================== */

test("security: a scaled operator cannot enumerate another Project's resources", async () => {
  const h = harness();
  seedTasks(h, 2);
  seedWorkflows(h, 1);

  const tasks = h.query.getTasks(SCOPED, { projectId: PROJECT });
  assert.equal(tasks.total, 0);
  const workflows = h.query.getWorkflows(SCOPED, { projectId: PROJECT });
  assert.equal(workflows.total, 0);
  assert.equal(await h.query.getProjectAgents(SCOPED, PROJECT), undefined);
});

test("security: the HTTP surface never returns Firestore internals", async () => {
  const h = harness();
  seedTasks(h, 1);
  await withServer(makeApi(h), async (base) => {
    const res = await fetch(`${base}/api/tasks?projectId=${PROJECT}`, {
      headers: { authorization: "Bearer viewer" },
    });
    const raw = await res.text();
    assert.ok(!raw.includes("documentRef"));
    assert.ok(!raw.includes("FirestoreSnapshot"));
  });
});

test("security: malformed pagination input cannot trigger an unbounded read", () => {
  const h = harness();
  seedTasks(h, MAX_PAGE_SIZE + 20);
  const page = h.query.getTasks(VIEWER, {
    projectId: PROJECT,
    limit: Number.MAX_SAFE_INTEGER,
    cursor: "shallow garbage",
  });
  assert.ok(page.items.length <= MAX_PAGE_SIZE);
  assert.ok(page.total === MAX_PAGE_SIZE + 20);
});
