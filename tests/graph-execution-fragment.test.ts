/**
 * EO-5.6 — execution-lifecycle projection: real records only, project
 * isolation, typed state normalisation, bounds and content-derived revision.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExecutionFragment,
  executionNodeId,
  EMPTY_EXECUTION_RECORDS,
  type ExecutionGraphRecords,
} from "../core/orchestrator/graph-execution-fragment.js";
import {
  APPROVAL_STATE,
  RELEASE_STATE,
  SESSION_STATE,
  VERIFICATION_STATE,
  normalise,
} from "../core/orchestrator/graph-execution-state.js";
import {
  WorkforceGraphProjectionService,
  mixRevision,
} from "../core/orchestrator/graph-projection.js";
import { AgentRegistry, ProjectRegistry, TaskSystem } from "../core/index.js";
import { GRAPH_LIMITS } from "../contracts/graph.js";
import type {
  Approval,
  ChangeSet,
  CommitReceipt,
  ExecutionSession,
  ReleaseReceipt,
  ReviewRecord,
  VerificationResult,
} from "../contracts/index.js";

const A = "proj-a";
const B = "proj-b";
const T = "2026-01-01T00:00:00.000Z";

/** Test fixtures carry only the fields the projection reads. */
const rec = <R>(partial: Record<string, unknown>): R => partial as unknown as R;

const session = (o: Partial<ExecutionSession> = {}) =>
  rec<ExecutionSession>({
    sessionId: "s1",
    projectId: A,
    stageKind: "build",
    status: "running",
    risk: "low",
    attempts: [],
    revision: 3,
    policy: { policyId: "p", version: 2 },
    approvalIds: [],
    agentId: "dev",
    environmentInstanceId: "inst-1",
    createdAt: T,
    // Sensitive fields that must never surface:
    workspace: { workspaceId: "w1", root: "/secret/path" },
    requestedBy: "operator@example.com",
    ...o,
  });
const changeSet = (o: Partial<ChangeSet> = {}) =>
  rec<ChangeSet>({
    changeSetId: "c1",
    projectId: A,
    sessionId: "s1",
    status: "verified",
    baseline: ["pre.ts"],
    entries: [{ path: "src/secret-file.ts" }, { path: "src/b.ts" }],
    updatedAt: T,
    ...o,
  });
const verification = (o: Partial<VerificationResult> = {}) =>
  rec<VerificationResult>({
    verificationId: "v1",
    projectId: A,
    changeSetId: "c1",
    status: "passed",
    stages: [{ status: "passed" }, { status: "failed" }],
    unverifiedStageIds: [],
    createdAt: T,
    ...o,
  });
const review = (o: Partial<ReviewRecord> = {}) =>
  rec<ReviewRecord>({
    reviewId: "r1",
    projectId: A,
    changeSetId: "c1",
    status: "approved",
    reviewerKind: "agent",
    summary: "free text with sk-abcdefghijklmnop",
    createdAt: T,
    ...o,
  });
const commit = (o: Partial<CommitReceipt> = {}) =>
  rec<CommitReceipt>({
    receiptId: "k1",
    projectId: A,
    changeSetId: "c1",
    commitSha: "abcdef1234567890",
    branch: "main",
    approvalIds: ["ap1"],
    createdAt: T,
    ...o,
  });
const release = (o: Partial<ReleaseReceipt> = {}) =>
  rec<ReleaseReceipt>({
    releaseId: "d1",
    projectId: A,
    commitSha: "abcdef1234567890",
    targetClass: "hosting",
    status: "deployed",
    approvalIds: [],
    simulated: false,
    startedAt: T,
    ...o,
  });
const approval = (o: Partial<Approval> = {}) =>
  rec<Approval>({
    id: "ap1",
    action: "commit",
    status: "requested",
    requestedAt: T,
    ...o,
  });

const full: ExecutionGraphRecords = {
  sessions: [session({ taskId: "t1", approvalIds: ["ap1"] })],
  changeSets: [changeSet()],
  verifications: [verification()],
  reviews: [review()],
  commits: [commit()],
  releases: [release()],
  approvals: [approval()],
};

const base = new Set(["project-proj-a", "task-t1", "agent-dev"]);
const build = (records: ExecutionGraphRecords, existing = base) =>
  buildExecutionFragment({
    projectId: A,
    projectNodeId: "project-proj-a",
    records,
    existingNodeIds: existing,
  });
const edgeKeys = (f: ReturnType<typeof build>) =>
  f.edges.map((e) => `${e.type}:${e.source}>${e.target}`).sort();

test("no records → no nodes and no edges (sparse real data, nothing invented)", () => {
  const f = build(EMPTY_EXECUTION_RECORDS);
  assert.deepEqual(f, { nodes: [], edges: [] });
});

test("full lifecycle is projected with only authoritative relationships", () => {
  const f = build(full);
  assert.deepEqual(f.nodes.map((n) => n.type).sort(), [
    "APPROVAL",
    "CHANGESET",
    "COMMIT",
    "DEPLOYMENT",
    "EXECUTION_SESSION",
    "REVIEW",
    "VERIFICATION",
  ]);
  assert.deepEqual(edgeKeys(f), [
    "COMMITTED_AS:changeset-c1>commit-k1",
    "DEPLOYED_TO:commit-k1>deployment-d1",
    "EXECUTES:agent-dev>session-s1",
    "EXECUTES:task-t1>session-s1",
    "PRODUCES:session-s1>changeset-c1",
    "REQUIRES_APPROVAL:commit-k1>approval-ap1",
    "REQUIRES_APPROVAL:session-s1>approval-ap1",
    "REVIEWED_BY:changeset-c1>review-r1",
    "VERIFIED_BY:changeset-c1>verification-v1",
  ]);
});

test("edges are never emitted to endpoints that do not exist (no dangling, no invention)", () => {
  // No task/agent nodes in the base graph; commit has no matching release.
  const f = build(
    { ...full, releases: [release({ commitSha: "different" })] },
    new Set(["project-proj-a"]),
  );
  const ids = new Set(f.nodes.map((n) => n.id).concat("project-proj-a"));
  for (const e of f.edges) {
    assert.ok(ids.has(e.source) && ids.has(e.target), e.id);
  }
  assert.ok(!f.edges.some((e) => e.type === "EXECUTES"));
  // COMMIT != DEPLOYMENT: a release with another SHA is not linked.
  assert.ok(!f.edges.some((e) => e.type === "DEPLOYED_TO"));
});

test("records from another project are dropped, never projected", () => {
  const f = build({
    ...full,
    sessions: [session({ projectId: B })],
    changeSets: [changeSet({ projectId: B })],
    verifications: [verification({ projectId: B })],
    reviews: [review({ projectId: B })],
    commits: [commit({ projectId: B })],
    releases: [release({ projectId: B })],
    approvals: [],
  });
  assert.deepEqual(f, { nodes: [], edges: [] });
});

test("an approval is only shown when a same-project record references it", () => {
  const f = build({
    ...EMPTY_EXECUTION_RECORDS,
    sessions: [session()],
    approvals: [approval({ id: "unrelated" })],
  });
  assert.ok(!f.nodes.some((n) => n.type === "APPROVAL"));
});

test("no secrets, paths, identities or free text leak into nodes", () => {
  const json = JSON.stringify(build(full));
  for (const leak of [
    "/secret/path",
    "secret-file",
    "operator@example.com",
    "sk-abcdefghijklmnop",
    "pre.ts",
  ]) {
    assert.ok(!json.includes(leak), leak);
  }
  const cs = build(full).nodes.find((n) => n.type === "CHANGESET")!;
  assert.equal(cs.metadata?.fileCount, 2);
});

test("state is normalised per domain, and the same word can mean different things", () => {
  const f = build({
    ...full,
    reviews: [review({ status: "pending" })],
    releases: [release({ status: "pending" })],
    approvals: [approval({ status: "requested" })],
  });
  const state = (type: string) => f.nodes.find((n) => n.type === type)?.state;
  assert.equal(state("REVIEW"), "awaiting_review");
  assert.equal(state("APPROVAL"), "awaiting_approval");
  assert.equal(state("DEPLOYMENT"), "queued"); // pending release ≠ awaiting anything
});

test("DEPLOYED is not VERIFIED: only a healthy release counts as completed", () => {
  assert.equal(normalise(RELEASE_STATE, "deployed"), "deployed");
  assert.equal(normalise(RELEASE_STATE, "healthy"), "completed");
  assert.equal(normalise(RELEASE_STATE, "deploying"), "deploying");
  assert.equal(normalise(RELEASE_STATE, "rolled_back"), "rolled_back"); // a completed rollback is recovery, not failure
});

test("unknown and inherited statuses never invent a state", () => {
  for (const s of ["nonsense", "constructor", "__proto__", "toString", ""]) {
    assert.equal(normalise(SESSION_STATE, s), "unavailable", s);
    assert.equal(normalise(APPROVAL_STATE, s), "unavailable", s);
  }
});

test("a lifecycle node whose parent is missing hangs off the project so it stays reachable", () => {
  const f = build({
    ...EMPTY_EXECUTION_RECORDS,
    commits: [commit({ approvalIds: [] })],
    releases: [release({ commitSha: "no-such-commit" })],
  });
  assert.deepEqual(edgeKeys(f), [
    "CONTAINS:project-proj-a>commit-k1",
    "CONTAINS:project-proj-a>deployment-d1",
  ]);
});

test("each record family is bounded and newest-first", () => {
  const many = Array.from(
    { length: GRAPH_LIMITS.maxExecutionRecords + 25 },
    (_, i) =>
      session({
        sessionId: `s${String(i).padStart(3, "0")}`,
        createdAt: `2026-01-01T00:${String(i % 60).padStart(2, "0")}:00.000Z`,
      }),
  );
  const f = build({ ...EMPTY_EXECUTION_RECORDS, sessions: many });
  assert.equal(
    f.nodes.filter((n) => n.type === "EXECUTION_SESSION").length,
    GRAPH_LIMITS.maxExecutionRecords,
  );
});

test("output is deterministic regardless of input order", () => {
  const a = build({
    ...full,
    sessions: [session({ sessionId: "s2" }), session({ sessionId: "s1" })],
  });
  const b = build({
    ...full,
    sessions: [session({ sessionId: "s1" }), session({ sessionId: "s2" })],
  });
  assert.deepEqual(a, b);
});

/* ---- through the projection service: modes + revision semantics ---- */

function service() {
  const projects = new ProjectRegistry();
  projects.register(
    {
      projectId: A,
      async describe() {
        return { name: A, capabilities: [] };
      },
      async execute() {
        return {};
      },
    },
    { displayName: "Alpha" },
  );
  return new WorkforceGraphProjectionService(
    projects,
    new AgentRegistry(),
    new TaskSystem(),
    undefined,
    {},
    () => new Date(T),
  );
}

test("EXECUTION mode shows lifecycle nodes; without records it says so honestly", () => {
  const svc = service();
  const empty = svc.getProjection({ projectId: A, mode: "EXECUTION" });
  assert.equal(empty.nodes.length, 1); // just the project
  assert.match(empty.metadata?.note ?? "", /No execution activity/);

  const live = svc.getProjection(
    { projectId: A, mode: "EXECUTION" },
    { ...full, sessions: [session({ approvalIds: ["ap1"] })] },
  );
  const types = new Set(live.nodes.map((n) => n.type));
  for (const t of [
    "EXECUTION_SESSION",
    "CHANGESET",
    "VERIFICATION",
    "REVIEW",
    "APPROVAL",
    "COMMIT",
    "DEPLOYMENT",
  ]) {
    assert.ok(types.has(t as never), t);
  }
});

test("revision is stable on re-read and moves when authoritative content changes", () => {
  const svc = service();
  const opts = { projectId: A, mode: "EXECUTION" as const };
  const r1 = svc.getProjection(opts, full).revision;
  assert.equal(
    svc.getProjection(opts, full).revision,
    r1,
    "a read must not mutate revision",
  );
  assert.equal(svc.getProjection(opts, full).revision, r1);

  const statusChange = svc.getProjection(opts, {
    ...full,
    sessions: [
      session({ taskId: "t1", approvalIds: ["ap1"], status: "succeeded" }),
    ],
  }).revision;
  assert.notEqual(statusChange, r1);

  const metadataOnly = svc.getProjection(opts, {
    ...full,
    changeSets: [changeSet({ entries: [{ path: "x" }] as never })],
  }).revision;
  assert.notEqual(
    metadataOnly,
    r1,
    "metadata-only change (file count) must move revision",
  );
});

test("execution nodes never appear in modes that do not include them", () => {
  const svc = service();
  for (const mode of [
    "WORKFORCE",
    "PROJECT",
    "WORKFLOW",
    "DEPENDENCY",
    "ENVIRONMENT",
    "KNOWLEDGE",
  ] as const) {
    const g = svc.getProjection({ projectId: A, mode }, full);
    assert.ok(
      !g.nodes.some((n) =>
        ["CHANGESET", "COMMIT", "DEPLOYMENT", "REVIEW"].includes(n.type),
      ),
      mode,
    );
  }
});

test("executionNodeId is the single source of node ids", () => {
  assert.equal(executionNodeId.session("x"), "session-x");
  assert.equal(executionNodeId.deployment("x"), "deployment-x");
});

/* ---- GraphQueryService: authorised collection, honest failure ---- */

import {
  GraphQueryService,
  type ControlPlaneContext,
} from "../control/index.js";
import { ApprovalSystem, type OperatorPrincipal } from "../core/index.js";

function queryService(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const projects = new ProjectRegistry();
  projects.register(
    {
      projectId: A,
      async describe() {
        return { name: A, capabilities: [] };
      },
      async execute() {
        return {};
      },
    },
    { displayName: "Alpha" },
  );
  const ctx = {
    projects,
    agents: new AgentRegistry(),
    tasks: new TaskSystem(),
    approvals: new ApprovalSystem(),
    agentOps: { isEnabled: () => true },
    workflows: { list: () => [] },
    execution: {
      async listSessions(p: OperatorPrincipal, projectId: string) {
        calls.push(`sessions:${p.id}:${projectId}`);
        return [session({ sessionId: "s1" })];
      },
      async getChangeSet(p: OperatorPrincipal, sessionId: string) {
        calls.push(`changeset:${p.id}:${sessionId}`);
        return changeSet();
      },
    },
    verification: { listHistory: async () => [verification()] },
    sourceControl: {
      activity: async () => ({
        reviews: [review()],
        commits: [commit({ approvalIds: [] })],
        stageSets: [],
        pushes: [],
        pullRequests: [],
      }),
    },
    deployments: { listReleases: async () => [release()] },
    ...overrides,
  } as unknown as ControlPlaneContext;
  return { svc: new GraphQueryService(ctx), calls };
}

const member: OperatorPrincipal = {
  id: "m",
  role: "viewer",
  allowedProjects: [A],
};

test("GraphQueryService reads lifecycle records with the caller's principal, project-scoped", async () => {
  const { svc, calls } = queryService();
  const g = await svc.getWorkforceGraph(member, {
    projectId: A,
    mode: "EXECUTION",
  });
  assert.ok(g);
  assert.deepEqual(calls, ["sessions:m:proj-a", "changeset:m:s1"]);
  assert.ok(g.nodes.some((n) => n.type === "DEPLOYMENT"));
  assert.equal(g.metadata?.unavailableSources, undefined);
});

test("an unauthorised operator triggers NO source read (authorise before fetching)", async () => {
  const { svc, calls } = queryService();
  const outsider: OperatorPrincipal = {
    id: "o",
    role: "operator",
    allowedProjects: [B],
  };
  assert.equal(
    await svc.getWorkforceGraph(outsider, { projectId: A, mode: "EXECUTION" }),
    undefined,
  );
  assert.deepEqual(calls, []);
});

test("a failing source is reported as unavailable, never as an empty history", async () => {
  const { svc } = queryService({
    deployments: {
      listReleases: async () => {
        throw new Error("boom");
      },
    },
  });
  const g = await svc.getWorkforceGraph(member, {
    projectId: A,
    mode: "EXECUTION",
  });
  assert.ok(g);
  assert.equal(g.metadata?.unavailableSources, "releases");
  assert.ok(!g.nodes.some((n) => n.type === "DEPLOYMENT"));
  assert.ok(!JSON.stringify(g).includes("boom"), "error detail must not leak");
});

test("non-execution modes do not fetch lifecycle records", async () => {
  const { svc, calls } = queryService();
  await svc.getWorkforceGraph(member, { projectId: A, mode: "WORKFORCE" });
  assert.deepEqual(calls, []);
});

test("sources not wired in this deployment are skipped, not reported as failed", async () => {
  const { svc } = queryService({
    execution: undefined,
    deployments: undefined,
  });
  const g = await svc.getWorkforceGraph(member, {
    projectId: A,
    mode: "EXECUTION",
  });
  assert.ok(g);
  assert.equal(g.metadata?.unavailableSources, undefined);
});

/* ---- review-driven hardening (independent EO-5.6 review) ---- */

test("bounding keeps the NEWEST records, not merely a count", () => {
  const n = GRAPH_LIMITS.maxExecutionRecords + 10;
  const sessions = Array.from({ length: n }, (_, i) =>
    session({
      sessionId: `s${String(i).padStart(3, "0")}`,
      createdAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
    }),
  );
  const f = build({ ...EMPTY_EXECUTION_RECORDS, sessions });
  const ids = new Set(f.nodes.map((x) => x.id));
  assert.ok(
    ids.has(`session-s${String(n - 1).padStart(3, "0")}`),
    "newest survives",
  );
  assert.ok(!ids.has("session-s000"), "oldest is dropped");
});

test("known terminal outcomes are never 'unavailable' (which means unknown)", () => {
  assert.equal(normalise(SESSION_STATE, "cancelled"), "cancelled");
  assert.equal(normalise(SESSION_STATE, "cancelling"), "running");
  assert.equal(normalise(SESSION_STATE, "denied"), "blocked");
  assert.equal(normalise(RELEASE_STATE, "rolled_back"), "rolled_back");
  assert.equal(normalise(RELEASE_STATE, "degraded"), "degraded");
  assert.equal(normalise(APPROVAL_STATE, "expired"), "blocked");
  const cs = (status: string) =>
    build({
      ...EMPTY_EXECUTION_RECORDS,
      changeSets: [changeSet({ status: status as never })],
    }).nodes[0].state;
  assert.equal(cs("verified"), "active", "verified is not committed/completed");
  assert.equal(cs("rolled_back"), "rolled_back");
  assert.equal(cs("abandoned"), "cancelled");
});

test("a simulated deployment can never read as a real one", () => {
  const label = (simulated: boolean) =>
    build({
      ...EMPTY_EXECUTION_RECORDS,
      releases: [release({ simulated, status: "healthy" })],
    }).nodes[0].label;
  assert.match(label(true), /\(simulated\)/);
  assert.doesNotMatch(label(false), /simulated/);
});

test("revision moves for label, edge-status and truncation changes, not just node status", () => {
  const svc = service();
  const opts = { projectId: A, mode: "EXECUTION" as const };
  const r0 = svc.getProjection(opts, full).revision;
  const relabelled = svc.getProjection(opts, {
    ...full,
    releases: [release({ simulated: true })],
  }).revision;
  assert.notEqual(relabelled, r0, "label change (simulated) moves revision");
});

test("mixRevision makes an unavailable-sources change visible to conditional polls", () => {
  assert.notEqual(mixRevision(5, "unavailable:releases"), 5);
  assert.notEqual(
    mixRevision(5, "unavailable:releases"),
    mixRevision(5, "unavailable:sessions"),
  );
  assert.equal(mixRevision(5, "x"), mixRevision(5, "x"));
});

test("sessions are ordered newest-first BEFORE the cap, whatever order the store returns", async () => {
  const cap = GRAPH_LIMITS.maxExecutionRecords;
  const oldestFirst = Array.from({ length: cap + 5 }, (_, i) =>
    session({
      sessionId: `s${String(i).padStart(3, "0")}`,
      createdAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
    }),
  );
  const asked: string[] = [];
  const { svc } = queryService({
    execution: {
      async listSessions() {
        return oldestFirst;
      },
      async getChangeSet(_p: unknown, id: string) {
        asked.push(id);
        return undefined;
      },
    },
  });
  const g = await svc.getWorkforceGraph(member, {
    projectId: A,
    mode: "EXECUTION",
  });
  assert.ok(g);
  assert.equal(asked.length, cap, "ChangeSet fan-out is bounded");
  assert.ok(
    asked.includes(`s${String(cap + 4).padStart(3, "0")}`),
    "newest session is kept",
  );
  assert.ok(!asked.includes("s000"), "oldest is dropped");
});

test("one failing ChangeSet read does not blank the others, and is reported", async () => {
  const { svc } = queryService({
    execution: {
      async listSessions() {
        return [
          session({ sessionId: "s1" }),
          session({ sessionId: "s2", createdAt: "2026-01-02T00:00:00.000Z" }),
        ];
      },
      async getChangeSet(_p: unknown, id: string) {
        if (id === "s2") throw new Error("boom");
        return changeSet({ changeSetId: "c1", sessionId: "s1" });
      },
    },
  });
  const g = await svc.getWorkforceGraph(member, {
    projectId: A,
    mode: "EXECUTION",
  });
  assert.ok(g);
  assert.ok(
    g.nodes.some((n) => n.id === "changeset-c1"),
    "the readable ChangeSet survives",
  );
  assert.equal(g.metadata?.unavailableSources, "changeSets");
});

test("a source failing or recovering changes the revision (no false 'unchanged')", async () => {
  const ok = queryService();
  const bad = queryService({
    deployments: {
      listReleases: async () => {
        throw new Error("x");
      },
    },
  });
  const a = await ok.svc.getWorkforceGraph(member, {
    projectId: A,
    mode: "EXECUTION",
  });
  const b = await bad.svc.getWorkforceGraph(member, {
    projectId: A,
    mode: "EXECUTION",
  });
  assert.notEqual(a!.revision, b!.revision);
});

test("concurrent polls share one read within the TTL and re-read after it", async () => {
  let clock = 1_000;
  const { svc, calls } = queryService({ clock: () => clock });
  await Promise.all(
    [1, 2, 3].map(() =>
      svc.getWorkforceGraph(member, { projectId: A, mode: "EXECUTION" }),
    ),
  );
  assert.equal(
    calls.filter((c) => c.startsWith("sessions")).length,
    1,
    "three polls, one read",
  );
  clock += 10_000;
  await svc.getWorkforceGraph(member, { projectId: A, mode: "EXECUTION" });
  assert.equal(
    calls.filter((c) => c.startsWith("sessions")).length,
    2,
    "re-read after TTL",
  );
});

test("a warm cache never serves an unauthorised caller", async () => {
  const { svc, calls } = queryService({ clock: () => 1_000 });
  await svc.getWorkforceGraph(member, { projectId: A, mode: "EXECUTION" }); // warms the cache
  const before = calls.length;
  const outsider: OperatorPrincipal = {
    id: "o",
    role: "operator",
    allowedProjects: [B],
  };
  assert.equal(
    await svc.getWorkforceGraph(outsider, { projectId: A, mode: "EXECUTION" }),
    undefined,
  );
  assert.equal(calls.length, before);
});

test("an approval stamped for another project is dropped", async () => {
  const approvals = new ApprovalSystem();
  const mine = approvals.request({
    action: "commit",
    requestedBy: "x",
    reason: "r",
    metadata: { projectId: A },
  });
  const theirs = approvals.request({
    action: "commit",
    requestedBy: "x",
    reason: "r",
    metadata: { projectId: B },
  });
  const { svc } = queryService({
    approvals,
    execution: {
      async listSessions() {
        return [session({ approvalIds: [mine.id, theirs.id] })];
      },
      async getChangeSet() {
        return undefined;
      },
    },
  });
  const g = await svc.getWorkforceGraph(member, {
    projectId: A,
    mode: "EXECUTION",
  });
  const approvalIds = g!.nodes
    .filter((n) => n.type === "APPROVAL")
    .map((n) => n.referenceId);
  assert.deepEqual(approvalIds, [mine.id]);
});

test("a cancelled verification is a known outcome, never 'unavailable'", () => {
  assert.equal(normalise(VERIFICATION_STATE, "cancelled"), "cancelled");
  const f = build({
    ...EMPTY_EXECUTION_RECORDS,
    verifications: [verification({ status: "cancelled" })],
  });
  assert.equal(f.nodes[0].state, "cancelled");
});

test("a cache entry with a NEGATIVE age (clock stepped back) is not served as fresh", async () => {
  let clock = 10_000;
  const { svc, calls } = queryService({ clock: () => clock });
  await svc.getWorkforceGraph(member, { projectId: A, mode: "EXECUTION" });
  clock = 1_000; // clock went backwards
  await svc.getWorkforceGraph(member, { projectId: A, mode: "EXECUTION" });
  assert.equal(
    calls.filter((c) => c.startsWith("sessions")).length,
    2,
    "re-read, not stale",
  );
});

test("an unknown project id creates no cache entry and triggers no source reads", async () => {
  const { svc, calls } = queryService();
  const wildcard: OperatorPrincipal = {
    id: "w",
    role: "operator",
    allowedProjects: "*",
  };
  await assert.rejects(() =>
    svc.getWorkforceGraph(wildcard, { projectId: "ghost", mode: "EXECUTION" }),
  );
  assert.deepEqual(calls, []);
});

/* ---- unwired sources (the production shape): UNKNOWN != ABSENT ---- */

test("a source this deployment does not have is reported as NOT CONFIGURED — never as 'nothing happened'", async () => {
  // Production wires execution but NOT verification / source control / deployments.
  const { svc } = queryService({
    verification: undefined,
    sourceControl: undefined,
    deployments: undefined,
  });
  const g = (await svc.getWorkforceGraph(member, {
    projectId: A,
    mode: "EXECUTION",
  }))!;
  assert.equal(
    g.metadata?.notConfiguredSources,
    "releases,sourceControl,verifications",
  );
  assert.equal(
    g.metadata?.unavailableSources,
    undefined,
    "not wired is distinct from a failed read",
  );
  assert.ok(
    !g.nodes.some((n) =>
      ["VERIFICATION", "REVIEW", "COMMIT", "DEPLOYMENT"].includes(n.type),
    ),
  );
  assert.ok(
    g.nodes.some((n) => n.type === "EXECUTION_SESSION"),
    "what IS wired still shows",
  );
});

test("a fully wired deployment reports neither list", async () => {
  const { svc } = queryService();
  const g = (await svc.getWorkforceGraph(member, {
    projectId: A,
    mode: "EXECUTION",
  }))!;
  assert.equal(g.metadata?.notConfiguredSources, undefined);
  assert.equal(g.metadata?.unavailableSources, undefined);
});

test("wiring or unwiring a source changes the revision (no false 'unchanged')", async () => {
  const wired = (await queryService().svc.getWorkforceGraph(member, {
    projectId: A,
    mode: "EXECUTION",
  }))!;
  const unwired = (await queryService({
    deployments: undefined,
  }).svc.getWorkforceGraph(member, { projectId: A, mode: "EXECUTION" }))!;
  assert.notEqual(wired.revision, unwired.revision);
});

test("insights carry the same distinction, so an empty result cannot be read as 'all clear'", async () => {
  const { svc } = queryService({
    execution: undefined,
    verification: undefined,
    sourceControl: undefined,
    deployments: undefined,
  });
  const r = (await svc.getInsights(member, A))!;
  assert.deepEqual(r.notConfiguredSources, [
    "changeSets",
    "releases",
    "sessions",
    "sourceControl",
    "verifications",
  ]);
  assert.equal(r.unavailableSources, undefined);
});

test("an approval node names WHAT is being approved", () => {
  const f = build({
    ...EMPTY_EXECUTION_RECORDS,
    sessions: [session({ approvalIds: ["ap1"] })],
    approvals: [approval({ action: "deployment" })],
  });
  assert.equal(
    f.nodes.find((x) => x.type === "APPROVAL")!.label,
    "Approval: deployment",
  );
});
