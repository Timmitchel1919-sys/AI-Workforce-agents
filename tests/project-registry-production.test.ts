/**
 * PROJECT-1 — production project registry and the first internal project
 * (AI Workforce). Synthetic fixtures live only in these in-memory tests and
 * are never written to production persistence.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_WORKFORCE_PROJECT_ID,
  AI_WORKFORCE_REPOSITORY,
  AiWorkforceProjectAdapter,
} from "../adapters/projects/ai-workforce/index.js";
import {
  PRODUCTION_WORKFORCE_CONFIGURATION,
  createAiWorkforceProductionBinding,
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
  AccessService,
  ApprovalSystem,
  AuditLog,
  InMemoryOperatorAccountStore,
  PermissionSystem,
  ProjectRegistry,
  TaskSystem,
  ToolRegistry,
  WorkflowSystem,
  parseProjectRepositoryRef,
  repositoryKey,
  type OperatorPrincipal,
  type ProjectAdapter,
} from "../core/index.js";
import { principalFor, ValidationError } from "../contracts/index.js";

const AI = AI_WORKFORCE_PROJECT_ID;

/** Hermetic production wiring: never depends on MONEY_MIND_REPO_PATH. */
function productionBootstrap() {
  return createProductionWorkforceBootstrap({
    ...PRODUCTION_WORKFORCE_CONFIGURATION,
    projectAdapters: [
      createAiWorkforceProductionBinding(),
      createMoneyMindProductionBinding({}),
    ],
  });
}

function controlPlane() {
  const audit = new AuditLog();
  const bootstrap = productionBootstrap();
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
  return {
    ctx,
    bootstrap,
    query: new WorkforceQueryService(ctx),
    graph: new GraphQueryService(ctx),
  };
}

const admin: OperatorPrincipal = {
  id: "adm",
  role: "admin",
  allowedProjects: "*",
};
const aiMember: OperatorPrincipal = {
  id: "m1",
  role: "viewer",
  allowedProjects: [AI],
};
const mmMember: OperatorPrincipal = {
  id: "m2",
  role: "viewer",
  allowedProjects: ["money-mind"],
};
const nobody: OperatorPrincipal = {
  id: "n",
  role: "viewer",
  allowedProjects: [],
};

const stub = (projectId: string): ProjectAdapter => ({
  projectId,
  async describe() {
    return { name: projectId, capabilities: [] };
  },
  async execute() {
    return {};
  },
});

/* ---------------- registry ---------------- */

test("AI Workforce is registered with a stable immutable id and a credential-free repository reference", () => {
  const { bootstrap } = controlPlane();
  assert.equal(AI, "ai-workforce");
  const reg = bootstrap.projects.get(AI);
  assert.ok(reg);
  assert.equal(reg.displayName, "AI Workforce");
  assert.deepEqual(reg.metadata.repository, {
    url: "https://github.com/Timmitchel1919-sys/AI-Workforce-agents",
    defaultBranch: "main",
  });
  assert.equal(JSON.stringify(reg.metadata).includes("@"), false);
});

test("registration is idempotent across boots: each boot yields exactly one AI Workforce", () => {
  for (let i = 0; i < 3; i += 1) {
    const b = productionBootstrap();
    assert.deepEqual(b.projects.ids(), ["ai-workforce", "money-mind"]);
    assert.equal(b.report.projectAdapterCount, 2);
  }
});

test("duplicate project id, adapter id and repository binding are rejected", () => {
  const r = new ProjectRegistry();
  r.register(stub("p1"), {
    metadata: {
      repository: { url: "https://github.com/o/r", defaultBranch: "main" },
    },
  });
  assert.throws(() => r.register(stub("p1")), /already registered/);
  assert.throws(
    () =>
      r.register(stub("p2"), {
        metadata: {
          repository: {
            url: "https://GitHub.com/O/R.git/",
            defaultBranch: "dev",
          },
        },
      }),
    /repository already bound to project p1/,
  );
  assert.equal(r.has("p2"), false, "a failed registration leaves no residue");
  assert.throws(
    () =>
      createProductionWorkforceBootstrap({
        ...PRODUCTION_WORKFORCE_CONFIGURATION,
        projectAdapters: [
          createAiWorkforceProductionBinding(),
          createAiWorkforceProductionBinding(),
        ],
      }),
    /duplicate|already/i,
  );
});

test("repository references reject credentials, non-https, query strings and bad branches", () => {
  const ok = { url: "https://github.com/o/r", defaultBranch: "main" };
  assert.ok(parseProjectRepositoryRef(ok));
  for (const bad of [
    { ...ok, url: "https://user:ghp_secret@github.com/o/r" },
    { ...ok, url: "https://ghp_secret@github.com/o/r" },
    { ...ok, url: "http://github.com/o/r" },
    { ...ok, url: "git@github.com:o/r.git" },
    { ...ok, url: "https://github.com/o/r?token=abc" },
    { ...ok, url: "https://github.com/o/r#frag" },
    { ...ok, url: "https://github.com/onlyowner" },
    { ...ok, url: "https://github.com:8443/o/r" },
    { ...ok, url: "https://localhost/o/r" },
    { ...ok, url: "https://127.0.0.1/o/r" },
    { ...ok, url: "https://[::1]/o/r" },
    { ...ok, url: "https://github.com/%67hp_secret/repo" },
    { ...ok, url: "https://github.com/o/r%2Fx" },
    { ...ok, url: "https://github.com/o/re po" },
    { ...ok, defaultBranch: "../evil" },
    { ...ok, defaultBranch: "" },
    { url: 5, defaultBranch: "main" },
    null,
    "https://github.com/o/r",
  ]) {
    assert.equal(
      parseProjectRepositoryRef(bad),
      undefined,
      JSON.stringify(bad),
    );
  }
  assert.equal(
    repositoryKey({
      url: "https://GitHub.com/O/R.git/",
      defaultBranch: "main",
    }),
    repositoryKey({ url: "https://github.com/o/r", defaultBranch: "x" }),
  );
  // registering with a credential-bearing reference fails loudly
  assert.throws(
    () =>
      new ProjectRegistry().register(stub("p"), {
        metadata: {
          repository: {
            url: "https://u:p@github.com/o/r",
            defaultBranch: "main",
          },
        },
      }),
    ValidationError,
  );
});

test("multi-project compatible: further projects register alongside AI Workforce", () => {
  const b = productionBootstrap();
  b.projects.register(stub("future-project"), { displayName: "Future" });
  assert.deepEqual(b.projects.ids(), [
    "ai-workforce",
    "future-project",
    "money-mind",
  ]);
});

/* ---------------- adapter ---------------- */

test("the AI Workforce adapter is read-only, static and secret-free; it starts nothing", async () => {
  const adapter = new AiWorkforceProjectAdapter();
  const described = await adapter.describe();
  assert.equal(described.name, "AI Workforce");
  assert.deepEqual(
    described.capabilities.map((c) => [c.operation, c.action]),
    [["READ_PROJECT", "read"]],
  );
  const out = (await adapter.execute("READ_PROJECT", {})) as {
    repository: unknown;
  };
  assert.deepEqual(out.repository, AI_WORKFORCE_REPOSITORY);
  await assert.rejects(() => adapter.execute("RUN_TESTS", {}), /not exposed/);
  await assert.rejects(() => adapter.execute("DEPLOY", {}), /not exposed/);
  assert.match(
    JSON.stringify(out),
    /^(?!.*(token|secret|password|apikey)).*$/is,
  );
});

/* ---------------- authorization / IDOR ---------------- */

test("project list and detail are server-authorized per operator", async () => {
  const { query } = controlPlane();
  assert.deepEqual(
    (await query.getProjects(admin)).map((p) => p.projectId),
    ["ai-workforce", "money-mind"],
  );
  assert.deepEqual(
    (await query.getProjects(aiMember)).map((p) => p.projectId),
    ["ai-workforce"],
  );
  assert.deepEqual(
    (await query.getProjects(mmMember)).map((p) => p.projectId),
    ["money-mind"],
  );
  assert.deepEqual(await query.getProjects(nobody), []);
});

test("cross-project IDOR is denied: a member of one project cannot read another's detail or graph", async () => {
  const { query, graph } = controlPlane();
  assert.equal(await query.getProject(mmMember, AI), undefined);
  assert.equal(await query.getProject(aiMember, "money-mind"), undefined);
  assert.equal(await query.getProject(aiMember, "does-not-exist"), undefined);
  assert.equal(graph.getWorkforceGraph(mmMember, { projectId: AI }), undefined);
  assert.equal(graph.getWorkforceGraph(nobody, { projectId: AI }), undefined);
  assert.ok(graph.getWorkforceGraph(aiMember, { projectId: AI }));
});

test("project view exposes the validated repository reference only", async () => {
  const { query } = controlPlane();
  const ai = await query.getProject(aiMember, AI);
  assert.deepEqual(ai?.repository, AI_WORKFORCE_REPOSITORY);
  assert.equal(JSON.stringify(ai).includes("sourceAvailable"), false);
  const mm = await query.getProject(mmMember, "money-mind");
  assert.equal(
    mm?.repository,
    undefined,
    "no reference is invented for a project that declares none",
  );
});

test("wildcard administrators see every registered project", async () => {
  const { query } = controlPlane();
  assert.equal((await query.getProjects(admin)).length, 2);
});

test("pending, rejected, suspended and revoked accounts yield no principal (no project access)", () => {
  for (const status of [
    "pending",
    "rejected",
    "suspended",
    "revoked",
  ] as const) {
    assert.equal(
      principalFor({
        id: "u",
        status,
        role: "admin",
        allowedProjects: "*",
        requestedAt: "t",
        updatedAt: "t",
        revision: 1,
      } as never),
      null,
      status,
    );
  }
});

/* ---------------- Users & Access ---------------- */

test("Users & Access accepts the real AI Workforce project id and still rejects unknown ids", async () => {
  const { bootstrap } = controlPlane();
  const store = new InMemoryOperatorAccountStore();
  const access = new AccessService({
    store,
    audit: new AuditLog(),
    projects: bootstrap.projects,
  });
  await access.bootstrapInitialAdmin({ uid: "boss", emailVerified: true });
  const boss = (await access.resolvePrincipal({
    uid: "boss",
    emailVerified: true,
  }))!;
  await access.myAccess({
    uid: "newbie",
    email: "n@example.test",
    emailVerified: true,
  });

  // pending user has no principal, even though projects now exist
  assert.equal(
    await access.resolvePrincipal({ uid: "newbie", emailVerified: true }),
    null,
  );

  await assert.rejects(
    () =>
      access.apply(
        "approve",
        { principal: boss },
        {
          operatorId: "newbie",
          role: "viewer",
          allowedProjects: ["ghost-project"],
        },
      ),
    /unknown projects/,
  );
  const view = await access.apply(
    "approve",
    { principal: boss },
    { operatorId: "newbie", role: "viewer", allowedProjects: [AI] },
  );
  assert.equal(view.status, "active");
  const principal = (await access.resolvePrincipal({
    uid: "newbie",
    emailVerified: true,
  }))!;
  assert.deepEqual(principal.allowedProjects, [AI]);

  // and that grant is exactly project-scoped
  const { query } = controlPlane();
  assert.deepEqual(
    (await query.getProjects(principal)).map((p) => p.projectId),
    [AI],
  );
  assert.equal(await query.getProject(principal, "money-mind"), undefined);

  // suspension removes access again
  await access.apply("suspend", { principal: boss }, { operatorId: "newbie" });
  assert.equal(
    await access.resolvePrincipal({ uid: "newbie", emailVerified: true }),
    null,
  );
});

/* ---------------- project resources & graph ---------------- */

test("AI Workforce has honest empty project resources: nothing is fabricated", async () => {
  const { query, ctx } = controlPlane();
  assert.deepEqual(await query.getProjectAgents(aiMember, AI), []);
  assert.equal(ctx.tasks.list().filter((t) => t.projectId === AI).length, 0);
  assert.equal(
    ctx.workflows.list().filter((w) => w.projectId === AI).length,
    0,
  );
  const view = await query.getProject(aiMember, AI);
  assert.equal(view?.activeWorkflows, 0);
  assert.deepEqual(view?.recentTaskIds, []);
  assert.deepEqual(view?.connectedAgents, []);
});

test("graph: the AI Workforce project is the real root; only real relationships; isolated; no fake data", () => {
  const { graph } = controlPlane();
  const g = graph.getWorkforceGraph(aiMember, { projectId: AI })!;
  assert.ok(g);
  assert.equal(g.projectId, AI);
  const project = g.nodes.find((n) => n.type === "PROJECT")!;
  assert.equal(project.id, "project-ai-workforce");
  assert.equal(project.label, "AI Workforce");
  assert.equal(project.referenceId, AI);
  // no fabricated resources
  const types = new Set(g.nodes.map((n) => n.type));
  for (const fake of [
    "TASK",
    "WORKFLOW",
    "WORKFLOW_STEP",
    "AGENT",
    "ENVIRONMENT",
    "ENVIRONMENT_ROUTER",
    "KNOWLEDGE_SOURCE",
    "PROGRAM",
  ]) {
    assert.equal(types.has(fake as never), false, `unexpected ${fake}`);
  }
  // valid graph: no dangling edges, nothing from another project
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const e of g.edges) assert.ok(ids.has(e.source) && ids.has(e.target));
  assert.equal(
    g.nodes.some((n) => n.projectId !== AI),
    false,
  );
  assert.equal(
    JSON.stringify(g).includes("money-mind"),
    false,
    "no cross-project data",
  );
  assert.equal(g.truncated, false);
});

test("graph: the Money Mind project still resolves its own scoped agent, isolated from AI Workforce", () => {
  const { graph } = controlPlane();
  const mm = graph.getWorkforceGraph(mmMember, { projectId: "money-mind" })!;
  assert.ok(
    mm.nodes.some(
      (n) =>
        n.type === "AGENT" && n.referenceId === "control-plane-analysis-agent",
    ),
  );
  const ai = graph.getWorkforceGraph(aiMember, { projectId: AI })!;
  assert.equal(
    ai.nodes.some((n) => n.type === "AGENT"),
    false,
    "agents are not auto-connected to every project",
  );
});

test("a failed registration leaves no residue and later registrations still work", () => {
  const r = new ProjectRegistry();
  r.register(stub("a"), {
    metadata: {
      repository: { url: "https://github.com/o/r", defaultBranch: "main" },
    },
  });
  assert.throws(() =>
    r.register(stub("b"), {
      metadata: {
        repository: { url: "https://github.com/o/r", defaultBranch: "main" },
      },
    }),
  );
  assert.throws(() =>
    r.register(stub("c"), {
      metadata: {
        repository: {
          url: "https://u:p@github.com/x/y",
          defaultBranch: "main",
        },
      },
    }),
  );
  r.register(stub("d")); // repository-less
  r.register(stub("e"), {
    metadata: {
      repository: { url: "https://github.com/x/y", defaultBranch: "main" },
    },
  });
  assert.deepEqual(r.ids(), ["a", "d", "e"]);
});

test("the adapter rejects prototype-chain operation names cleanly", async () => {
  const adapter = new AiWorkforceProjectAdapter();
  for (const op of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    await assert.rejects(() => adapter.execute(op, {}), /not exposed/, op);
  }
});
