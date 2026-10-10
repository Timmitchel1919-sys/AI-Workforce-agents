/**
 * EO-3.2 — Execution plan persistence, serialization, versioning and
 * concurrency.
 *
 * The authoritative copy of every plan lives in an `ExecutionPlanStore`
 * (Firestore in production). Every write is an atomic commit with an
 * optimistic precondition, so two instances can never fork a plan's history.
 * Stored records are read fail-closed. Nothing here executes a plan.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createControlPlaneApi } from "../api/index.js";
import {
  EXECUTION_PLAN_HEADS_COLLECTION,
  EXECUTION_PLANS_COLLECTION,
  FirestoreExecutionPlanStore,
} from "../adapters/index.js";
import {
  AgentOperationalStore,
  WorkflowControlStore,
  WorkforceCommandService,
  WorkforceQueryService,
  type ControlPlaneContext,
} from "../control/index.js";
import {
  AuditLog,
  CorruptPlanRecordError,
  ExecutionPlanRepository,
  ExecutionPlanningService,
  InMemoryExecutionPlanStore,
  ModelCapabilityRegistry,
  PermissionSystem,
  PlanRevisionConflictError,
  ProjectRegistry,
  TaskSystem,
  ToolRegistry,
  WorkflowSystem,
  deserializeExecutionPlan,
  serializeExecutionPlan,
  type ExecutionPlan,
  type ExecutionPlanStore,
  type OperatorPrincipal,
  type ProjectAdapter,
} from "../core/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";
import {
  FIXED_TIME,
  IOS_AGENT,
  MAC_HOST,
  MODEL_PROFILES,
  WEB_AGENT,
  WEB_HOST,
  WEB_INSTANCE,
  XCODE_INSTANCE,
  agent,
  iosRequest,
  planningFixture,
  webRequest,
} from "./fixtures/planning.js";

const ACTOR = { id: "operator-1" };

function productionWebRequest(): Record<string, unknown> {
  return {
    ...webRequest(),
    deployments: [
      {
        componentId: "web",
        targetType: "firebase_hosting",
        stage: "production",
        credentialRef: {
          kind: "secret_manager",
          ref: "projects/ai-workforce-agents/secrets/hosting-deployer",
        },
      },
    ],
    constraints: { destructiveMigration: true },
  };
}

/** A second "instance": same registry/agents/approvals/store, own cache. */
function secondInstance(
  f: ReturnType<typeof planningFixture>,
  store: ExecutionPlanStore,
): ExecutionPlanningService {
  return new ExecutionPlanningService({
    environments: f.registry,
    agents: f.agents,
    audit: f.audit,
    approvals: f.approvals,
    store,
    repository: new ExecutionPlanRepository(),
    models: new ModelCapabilityRegistry(MODEL_PROFILES),
    clock: () => FIXED_TIME,
    idFactory: () => "plan_second",
  });
}

function fixtureWithStore(store: ExecutionPlanStore) {
  const f = planningFixture({ agents: [IOS_AGENT, WEB_AGENT] });
  // Rebuild the primary service on the shared store.
  const planning = new ExecutionPlanningService({
    environments: f.registry,
    agents: f.agents,
    audit: f.audit,
    approvals: f.approvals,
    store,
    models: new ModelCapabilityRegistry(MODEL_PROFILES),
    projectExists: (id) => ["alpha", "beta"].includes(id),
    clock: () => FIXED_TIME,
    idFactory: () => "plan_primary",
  });
  return { ...f, planning };
}

/* ------------------------------------------------------------------ */
/* Serialization                                                      */
/* ------------------------------------------------------------------ */

test("serialization: deterministic, canonical, lossless round-trip of every plan structure", async () => {
  const f = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [WEB_AGENT, agent("sec-agent", ["security_review"])],
  });
  const plan = await f.planning.createPlan(productionWebRequest(), ACTOR);

  const record = serializeExecutionPlan(plan);
  assert.equal(
    JSON.stringify(serializeExecutionPlan(plan)),
    JSON.stringify(record),
  );
  assert.deepEqual(Object.keys(record), [...Object.keys(record)].sort());

  const back = deserializeExecutionPlan(JSON.parse(JSON.stringify(record)));
  assert.deepEqual(back, plan);
  assert.equal(
    JSON.stringify(serializeExecutionPlan(back)),
    JSON.stringify(record),
  );

  // Everything that matters survives.
  for (const key of [
    "planId",
    "projectId",
    "version",
    "status",
    "architecture",
    "analysis",
    "environments",
    "agentRequirements",
    "agents",
    "models",
    "dependencies",
    "build",
    "tests",
    "security",
    "deployment",
    "approvalRequirements",
    "blockers",
    "createdAt",
    "updatedAt",
    "inputsFingerprint",
  ] as const) {
    assert.deepEqual(back[key], plan[key], key);
  }
  assert.equal(back.environments[0]!.match.selectedInstanceId, "web-1");
  assert.equal(back.agents[0]!.agentId, "web-agent");
  assert.equal(back.deployment[0]!.credentialRef?.kind, "secret_manager");
});

test("malformed storage: corrupt records are rejected fail-closed, never returned", async () => {
  const f = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [WEB_AGENT],
  });
  const plan = await f.planning.createPlan(webRequest(), ACTOR);
  const good = serializeExecutionPlan(plan) as Record<string, unknown> &
    ExecutionPlan;

  const corruptions: Record<string, unknown>[] = [
    { ...good, blockers: undefined },
    { ...good, status: "running" },
    { ...good, status: "blocked" },
    { ...good, schemaVersion: 99 },
    { ...good, build: [{ ...good.build[0]!, status: "succeeded" }] },
    { ...good, tests: [{ ...good.tests[0]!, status: "passed" }] },
    {
      ...good,
      dependencies: {
        ...good.dependencies,
        order: [...good.dependencies.order].reverse(),
      },
    },
    {
      ...good,
      dependencies: { ...good.dependencies, order: ["toolchain:ghost"] },
    },
    {
      ...good,
      build: [{ ...good.build[0]!, environmentRequirementId: "env-404" }],
    },
    { ...good, agents: [{ ...good.agents[0]!, agentId: undefined }] },
    { ...good, cost: { status: "estimated", amount: 12 } },
    {
      ...good,
      request: {
        ...good.request,
        summary: "token sk-proj-abcdefghijklmnopqrstuv",
      },
    },
    { ...good, id: "plan_1@v7" },
  ];
  for (const [index, corrupt] of corruptions.entries()) {
    assert.throws(
      () => deserializeExecutionPlan(JSON.parse(JSON.stringify(corrupt))),
      CorruptPlanRecordError,
      `corruption #${index}`,
    );
  }
  assert.throws(() => deserializeExecutionPlan(null), CorruptPlanRecordError);
  assert.throws(() => deserializeExecutionPlan("plan"), CorruptPlanRecordError);

  // Through the service: a corrupt stored record blocks the read.
  const store = new InMemoryExecutionPlanStore();
  const g = fixtureWithStore(store);
  const stored = await g.planning.createPlan(iosRequest(), ACTOR);
  store.unsafePut({ ...serializeExecutionPlan(stored), status: "approved" });
  await assert.rejects(
    () => g.planning.refreshProject("alpha"),
    CorruptPlanRecordError,
  );
  const error = new CorruptPlanRecordError("x", "detail");
  assert.doesNotMatch(error.message, /detail|approved/);
});

/* ------------------------------------------------------------------ */
/* Versioning, current revision                                       */
/* ------------------------------------------------------------------ */

test("history: revisions retained in deterministic order with exactly one current", async () => {
  const f = planningFixture({ agents: [IOS_AGENT] });
  const v1 = await f.planning.createPlan(iosRequest(), ACTOR);
  f.registry.upsertHost(MAC_HOST);
  f.registry.upsertInstance(XCODE_INSTANCE);
  const v2 = (await f.planning.replan(v1.planId, ACTOR)).plan;
  f.disabled.add("ios-agent");
  const v3 = (await f.planning.replan(v1.planId, ACTOR)).plan;

  assert.deepEqual(
    f.planning.versions(v1.planId).map((p) => [p.version, p.status]),
    [
      [3, "blocked"],
      [2, "superseded"],
      [1, "superseded"],
    ],
  );
  assert.equal(f.planning.latest(v1.planId)?.id, v3.id);
  assert.equal(
    f.planning.versions(v1.planId).filter((p) => p.status !== "superseded")
      .length,
    1,
  );
  assert.equal(f.planning.get(v2.id)?.supersededBy, v3.id);
  // Audit history is append-only: every event is still there.
  assert.deepEqual(
    f.audit.query({ type: "execution_plan_event" }).map((e) => e.data.action),
    [
      "created",
      "blocked",
      "replanned",
      "superseded",
      "ready",
      "replanned",
      "superseded",
      "blocked",
    ],
  );
});

/* ------------------------------------------------------------------ */
/* Concurrency                                                        */
/* ------------------------------------------------------------------ */

async function raceReplans(store: ExecutionPlanStore) {
  const f = fixtureWithStore(store);
  const v1 = await f.planning.createPlan(iosRequest(), ACTOR);
  const other = secondInstance(f, store);
  await other.refreshSeries(v1.planId);

  f.registry.upsertHost(MAC_HOST);
  f.registry.upsertInstance(XCODE_INSTANCE);
  const results = await Promise.allSettled([
    f.planning.replan(v1.planId, ACTOR),
    other.replan(v1.planId, { id: "operator-2" }),
  ]);
  return { f, other, v1, results };
}

test("concurrent replans (in-memory store): one wins, the other conflicts; no fork", async () => {
  const store = new InMemoryExecutionPlanStore();
  const { f, other, v1, results } = await raceReplans(store);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(
    (rejected[0] as PromiseRejectedResult).reason instanceof
      PlanRevisionConflictError,
  );

  const records = (await store.listSeries(v1.planId)).map(
    deserializeExecutionPlan,
  );
  assert.deepEqual(records.map((p) => p.version).sort(), [1, 2]);
  assert.equal(records.filter((p) => p.status !== "superseded").length, 1);

  // The loser refreshed on conflict: both instances now agree on v2.
  await f.planning.refreshSeries(v1.planId);
  assert.equal(other.latest(v1.planId)?.version, 2);
  assert.equal(f.planning.latest(v1.planId)?.version, 2);
});

test("concurrent replans (Firestore adapter, transactional): version consistency holds", async () => {
  const firestore = new FakeFirestore();
  const store = new FirestoreExecutionPlanStore(firestore);
  const { v1, results } = await raceReplans(store);

  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof PlanRevisionConflictError);

  const docs = firestore.collection(EXECUTION_PLANS_COLLECTION).values;
  assert.deepEqual([...docs.keys()].sort(), [
    `${v1.planId}@v1`,
    `${v1.planId}@v2`,
  ]);
  const head = firestore
    .collection(EXECUTION_PLAN_HEADS_COLLECTION)
    .values.get(v1.planId);
  assert.deepEqual(head, {
    planId: v1.planId,
    projectId: "alpha",
    currentVersion: 2,
  });
  assert.equal(docs.get(`${v1.planId}@v1`)?.status, "superseded");
  assert.ok(firestore.transactions >= 3);
});

test("Firestore adapter: a version document is never overwritten; reads are project-scoped", async () => {
  const firestore = new FakeFirestore();
  const store = new FirestoreExecutionPlanStore(firestore);
  const f = fixtureWithStore(store);
  const alpha = await f.planning.createPlan(iosRequest("alpha"), ACTOR);
  const record = serializeExecutionPlan(alpha);
  await assert.rejects(
    () => store.commit({ kind: "create_series", record }),
    PlanRevisionConflictError,
  );
  assert.equal((await store.listByProject("alpha")).length, 1);
  assert.equal((await store.listByProject("beta")).length, 0);
});

test("concurrent approval submissions: one wins, the loser leaves no pending approval", async () => {
  const store = new InMemoryExecutionPlanStore();
  const f = fixtureWithStore(store);
  f.registry.upsertHost(WEB_HOST);
  f.registry.upsertInstance(WEB_INSTANCE);
  f.agents.register(agent("sec-agent", ["security_review"]));
  const plan = await f.planning.createPlan(productionWebRequest(), ACTOR);
  const other = secondInstance(f, store);
  await other.refreshSeries(plan.planId);

  const results = await Promise.allSettled([
    f.planning.submitForApproval(plan.planId, ACTOR),
    other.submitForApproval(plan.planId, { id: "operator-2" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.deepEqual(
    f.approvals
      .list()
      .map((a) => a.status)
      .sort(),
    ["expired", "requested"],
  );
});

test("multi-instance: a plan committed by one instance is visible to another", async () => {
  const store = new InMemoryExecutionPlanStore();
  const f = fixtureWithStore(store);
  const created = await f.planning.createPlan(iosRequest(), ACTOR);
  const other = secondInstance(f, store);
  assert.equal(other.listByProject("alpha").length, 0);
  await other.refreshProject("alpha");
  assert.deepEqual(other.get(created.id), created);
});

/* ------------------------------------------------------------------ */
/* Control Plane: current plan route, corrupt record → safe 500        */
/* ------------------------------------------------------------------ */

const ADMIN: OperatorPrincipal = {
  id: "admin-1",
  role: "admin",
  allowedProjects: "*",
};
const ALPHA: OperatorPrincipal = {
  id: "op-alpha",
  role: "operator",
  allowedProjects: ["alpha"],
};

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

async function api(store: InMemoryExecutionPlanStore) {
  const f = fixtureWithStore(store);
  const projects = new ProjectRegistry();
  projects.register(stubAdapter("alpha"));
  projects.register(stubAdapter("beta"));
  const audit = new AuditLog();
  const ctx: ControlPlaneContext = {
    agents: f.agents,
    tasks: new TaskSystem(),
    workflows: new WorkflowSystem(),
    approvals: f.approvals,
    permissions: new PermissionSystem([]),
    tools: new ToolRegistry(audit),
    projects,
    audit,
    agentOps: new AgentOperationalStore(),
    workflowControl: new WorkflowControlStore(),
    environments: f.registry,
    planning: f.planning,
  };
  const principals: Record<string, OperatorPrincipal> = {
    admin: ADMIN,
    alpha: ALPHA,
  };
  const server = http.createServer(
    createControlPlaneApi({
      query: new WorkforceQueryService(ctx),
      command: new WorkforceCommandService(ctx),
      operatorDirectory: { resolve: async (t) => principals[t] ?? null },
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    f,
    get: async (path: string, token = "admin") => {
      const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      return {
        status: res.status,
        body: (await res.json()) as Record<string, unknown>,
      };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("current plan route: null when none, the current revision after create, 404 cross-project", async () => {
  const store = new InMemoryExecutionPlanStore();
  const h = await api(store);
  try {
    const empty = await h.get("/projects/alpha/execution-plans/current");
    assert.equal(empty.status, 200);
    assert.equal(empty.body.plan, null);

    const plan = await h.f.planning.createPlan(iosRequest("beta"), ACTOR);
    const beta = await h.get("/projects/beta/execution-plans/current");
    assert.equal((beta.body.plan as { id: string }).id, plan.id);
    assert.equal(
      (await h.get("/projects/beta/execution-plans/current", "alpha")).status,
      404,
    );
    assert.equal(
      (await h.get("/projects/ghost/execution-plans/current")).status,
      404,
    );
  } finally {
    await h.close();
  }
});

test("blocked plan is a 200 with a persisted blocked plan; corrupt storage is a safe 500", async () => {
  const store = new InMemoryExecutionPlanStore();
  const h = await api(store);
  try {
    const plan = await h.f.planning.createPlan(iosRequest("alpha"), ACTOR);
    const ok = await h.get(`/projects/alpha/execution-plans/${plan.planId}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, "blocked");

    store.unsafePut({ ...serializeExecutionPlan(plan), blockers: [] });
    const broken = await h.get(
      `/projects/alpha/execution-plans/${plan.planId}`,
    );
    assert.equal(broken.status, 500);
    assert.deepEqual(broken.body, {
      error: { message: "stored execution plan record failed validation" },
    });
    assert.doesNotMatch(JSON.stringify(broken.body), /blockers|swiftui|alpha/);
  } finally {
    await h.close();
  }
});
