/**
 * Layer 11 — Portfolio & Multi-Project Intelligence: registry view, health from real signals,
 * dependencies, resource conflicts, priorities, dashboard, question answering, isolation.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  PortfolioError,
  PortfolioIntelligence,
  computeProjectHealth,
  inMemoryPortfolioRepos,
  type AlertFact,
  type ExecutionRun,
  type MemoryRecord,
  type UsageRecord,
} from "../core/index.js";
import { PortfolioIntelligenceControlService } from "../control/services/platform-layers-control.js";
import {
  ADMIN,
  ALPHA_ONLY,
  OPERATOR,
  VIEWER,
  derive,
  makeSecurity,
  run,
  task,
  usage,
} from "./helpers/platform-fixtures.js";

interface Data {
  runs: ExecutionRun[];
  usage: UsageRecord[];
  alerts: AlertFact[];
  memories: MemoryRecord[];
}

function rig(data: Partial<Data> = {}, projects = ["alpha", "beta", "gamma"]) {
  const f = makeSecurity();
  const d: Data = { runs: [], usage: [], alerts: [], memories: [], ...data };
  const pf = new PortfolioIntelligence(inMemoryPortfolioRepos(), {
    projects: () =>
      projects.map((p) => ({
        projectId: p,
        name: p.toUpperCase(),
        repository: `https://github.com/acme/${p}`,
        branch: "main",
        stack: ["TypeScript"],
      })),
    runs: () => d.runs,
    deriveRunStatus: derive,
    usage: () => d.usage,
    alerts: () => d.alerts,
    memories: () => d.memories,
    reusableExtensions: () => [
      {
        kind: "SKILL",
        extensionId: "skill.react-development",
        name: "React development",
      },
    ],
    agentsFor: (p) => [
      ...new Set(
        d.runs
          .filter((r) => r.projectId === p)
          .flatMap((r) =>
            r.tasks
              .map((t) => t.assignedAgent?.agentId)
              .filter((a): a is string => !!a),
          ),
      ),
    ],
    ledger: f.security.ledger,
    clock: f.clock.iso,
  });
  const control = new PortfolioIntelligenceControlService(
    { audit: f.audit, clock: f.clock.iso },
    pf,
  );
  return { ...f, pf, data: d, control };
}
const all = () => true;
const only =
  (...ids: string[]) =>
  (id: string) =>
    ids.includes(id);
const alert = (o: Partial<AlertFact> = {}): AlertFact => ({
  alertId: `a-${Math.random()}`,
  projectId: "alpha",
  severity: "MEDIUM",
  status: "OPEN",
  event: "e",
  description: "d",
  ...o,
});

/* ------------------------------- health ------------------------------- */

test("health: a project with no data is UNKNOWN, not healthy", () => {
  const h = rig().pf.health("alpha", all);
  assert.equal(h.state, "UNKNOWN");
  assert.equal(h.evidenceCount, 0);
  assert.ok(
    h.signals.every((s) => s.status === "UNKNOWN" || s.status === "OK"),
  );
});

test("health: HEALTHY only with real evidence and no warnings", () => {
  const r = rig({
    runs: [
      run("alpha", [
        task({
          status: "COMPLETED",
          type: "TEST",
          result: {
            claimed: "success",
            verified: true,
            summary: "",
            evidence: [],
            checks: [],
          } as never,
        }),
        task({ status: "COMPLETED" }),
      ]),
    ],
  });
  const h = r.pf.health("alpha", all);
  assert.equal(h.state, "HEALTHY");
  assert.ok(h.evidenceCount > 0);
  assert.equal(h.signals.find((s) => s.name === "Tests")!.status, "OK");
});

test("health: failures, unverified tests and alerts lower the state, each with its reason", () => {
  const failedOnly = rig({
    runs: [run("alpha", [task({ status: "FAILED" })])],
  }).pf.health("alpha", all);
  assert.equal(
    failedOnly.state,
    "AT_RISK",
    "one BAD signal (latest run failed) plus a warning",
  );
  const failedRun = rig({
    runs: [run("alpha", [task({ status: "FAILED", type: "TEST" })])],
  }).pf.health("alpha", all);
  assert.equal(
    failedRun.state,
    "CRITICAL",
    "latest run failed AND tests failed = two BAD signals",
  );
  assert.ok(failedRun.reasons.some((x) => /latest run failed/.test(x)));
  const unverified = rig({
    runs: [run("alpha", [task({ status: "COMPLETED", type: "TEST" })])],
  }).pf.health("alpha", all);
  assert.equal(unverified.state, "AT_RISK");
  assert.ok(unverified.reasons.some((x) => /not verified/.test(x)));
  const crit = rig({
    runs: [run("alpha", [task({ status: "COMPLETED" })])],
    alerts: [alert({ severity: "CRITICAL" })],
  }).pf.health("alpha", all);
  assert.equal(crit.state, "CRITICAL");
  const med = rig({
    runs: [run("alpha", [task({ status: "COMPLETED" })])],
    alerts: [alert({ severity: "MEDIUM" })],
  }).pf.health("alpha", all);
  assert.equal(med.state, "AT_RISK");
  const closed = rig({
    runs: [run("alpha", [task({ status: "COMPLETED" })])],
    alerts: [alert({ status: "RESOLVED", severity: "CRITICAL" })],
  }).pf.health("alpha", all);
  assert.equal(
    closed.state,
    "HEALTHY",
    "a resolved alert is not a current problem",
  );
});

test("health: blocked work makes the project BLOCKED with the reason attached", () => {
  const r = rig({
    runs: [
      run("alpha", [
        task({
          status: "BLOCKED",
          blockKind: "budget",
          blockedReason: "limit",
        }),
        task({ status: "COMPLETED" }),
      ]),
    ],
  });
  const h = r.pf.health("alpha", all);
  assert.equal(h.state, "BLOCKED");
  assert.ok(h.reasons.some((x) => /budget/.test(x)));
});

test("health is computed per project: another project's failures do not leak in", () => {
  const r = rig({
    runs: [
      run("beta", [task({ status: "FAILED", type: "TEST" })]),
      run("alpha", [task({ status: "COMPLETED" })]),
    ],
  });
  assert.equal(r.pf.health("alpha", all).state, "HEALTHY");
  assert.equal(r.pf.health("beta", all).state, "CRITICAL");
});

test("health: a pure function over the same inputs gives the same answer", () => {
  const input = {
    projectId: "alpha",
    runs: [run("alpha", [task({ status: "FAILED" })])],
    deriveRunStatus: derive,
    alerts: [],
    now: "t",
  };
  assert.deepEqual(computeProjectHealth(input), computeProjectHealth(input));
});

/* ------------------------------ dependencies ------------------------------ */

test("dependencies: A orchestrates B; a consumer is warned when its dependency is critical", () => {
  const r = rig({
    runs: [
      run("beta", [task({ status: "FAILED", type: "TEST" })]),
      run("alpha", [task({ status: "COMPLETED" })]),
    ],
  });
  r.pf.addDependency(
    { from: "alpha", to: "beta", kind: "DEPENDS_ON", weight: 4 },
    "owner",
    all,
  );
  const h = r.pf.health("alpha", all);
  assert.equal(
    h.state,
    "AT_RISK",
    "healthy on its own, but its dependency is critical",
  );
  assert.ok(h.reasons.some((x) => /depends on beta \(CRITICAL\)/.test(x)));
  const sum = r.pf.summary("alpha", all);
  assert.deepEqual(sum.dependsOn, [{ projectId: "beta", kind: "DEPENDS_ON" }]);
  assert.deepEqual(r.pf.summary("beta", all).dependedOnBy, [
    { projectId: "alpha", kind: "DEPENDS_ON" },
  ]);
});

test("dependencies: self, duplicate, cyclic and unknown relationships are refused", () => {
  const r = rig();
  assert.throws(
    () => r.pf.addDependency({ from: "alpha", to: "alpha" }, "o", all),
    /two different projects/,
  );
  r.pf.addDependency(
    { from: "alpha", to: "beta", kind: "ORCHESTRATES" },
    "o",
    all,
  );
  assert.throws(
    () =>
      r.pf.addDependency(
        { from: "alpha", to: "beta", kind: "ORCHESTRATES" },
        "o",
        all,
      ),
    (e: unknown) => e instanceof PortfolioError && e.code === "conflict",
  );
  r.pf.addDependency({ from: "beta", to: "gamma", kind: "CONSUMES" }, "o", all);
  assert.throws(
    () =>
      r.pf.addDependency(
        { from: "gamma", to: "alpha", kind: "DEPENDS_ON" },
        "o",
        all,
      ),
    /cycle/,
  );
  assert.throws(
    () => r.pf.addDependency({ from: "alpha", to: "ghost" }, "o", all),
    /project not found/,
  );
  assert.throws(
    () =>
      r.pf.addDependency(
        { from: "alpha", to: "gamma", kind: "LOVES" },
        "o",
        all,
      ),
    /kind must be/,
  );
  assert.equal(r.pf.listDependencies(all).length, 2);
});

/* ------------------------------ resource conflicts ------------------------------ */

test("resource conflicts: exclusive declared claims conflict, shared ones are informational", () => {
  const r = rig();
  r.pf.claim(
    {
      projectId: "alpha",
      kind: "ENVIRONMENT",
      resourceId: "staging-1",
      exclusive: true,
    },
    "o",
    all,
  );
  r.pf.claim(
    { projectId: "beta", kind: "ENVIRONMENT", resourceId: "staging-1" },
    "o",
    all,
  );
  r.pf.claim(
    { projectId: "alpha", kind: "MODEL", resourceId: "claude-sonnet-5" },
    "o",
    all,
  );
  r.pf.claim(
    { projectId: "gamma", kind: "MODEL", resourceId: "claude-sonnet-5" },
    "o",
    all,
  );
  const c = r.pf.conflicts(all);
  const env = c.find((x) => x.resourceId === "staging-1")!;
  assert.equal(env.severity, "CONFLICT");
  assert.deepEqual(env.projects.sort(), ["alpha", "beta"]);
  assert.match(env.explanation, /exclusive/);
  assert.equal(
    c.find((x) => x.resourceId === "claude-sonnet-5")!.severity,
    "INFO",
  );
  assert.throws(
    () =>
      r.pf.claim(
        { projectId: "alpha", kind: "ENVIRONMENT", resourceId: "staging-1" },
        "o",
        all,
      ),
    /already claims/,
  );
  assert.throws(
    () =>
      r.pf.claim(
        { projectId: "alpha", kind: "COFFEE", resourceId: "x" },
        "o",
        all,
      ),
    /kind must be/,
  );
});

test("resource conflicts: observed — the same agent or exclusive lock in flight for two projects", () => {
  const r = rig({
    runs: [
      run("alpha", [
        task({ status: "RUNNING", agent: "dev-agent", resources: ["db:prod"] }),
      ]),
      run("beta", [
        task({ status: "QUEUED", agent: "dev-agent", resources: ["db:prod"] }),
      ]),
      run("gamma", [
        task({
          status: "COMPLETED",
          agent: "dev-agent",
          resources: ["db:prod"],
        }),
      ]),
    ],
  });
  const c = r.pf.conflicts(all);
  const agent = c.find((x) => x.kind === "AGENT")!;
  assert.deepEqual(
    agent.projects.sort(),
    ["alpha", "beta"],
    "a finished task is not contention",
  );
  assert.equal(agent.source, "observed");
  const lock = c.find((x) => x.kind === "LOCK")!;
  assert.equal(lock.severity, "CONFLICT");
  assert.equal(lock.resourceId, "db:prod");
});

test("releasing a claim removes the conflict", () => {
  const r = rig();
  r.pf.claim(
    { projectId: "alpha", kind: "COMPUTE", resourceId: "gpu", exclusive: true },
    "o",
    all,
  );
  const b = r.pf.claim(
    { projectId: "beta", kind: "COMPUTE", resourceId: "gpu" },
    "o",
    all,
  );
  assert.equal(r.pf.conflicts(all).length, 1);
  r.pf.release(b.id, "o", all);
  assert.equal(r.pf.conflicts(all).length, 0);
});

/* ------------------------------- priorities ------------------------------- */

test("priorities: owner-set priority, importance, urgency, health and dependents decide the order, with the arithmetic shown", () => {
  const r = rig({ runs: [run("beta", [task({ status: "FAILED" })])] });
  r.pf.setProfile(
    "alpha",
    { priority: "CRITICAL", strategicImportance: 5, urgency: 5 },
    "o",
  );
  r.pf.setProfile(
    "gamma",
    { priority: "LOW", strategicImportance: 1, urgency: 1 },
    "o",
  );
  const ranking = r.pf.priorities(all);
  assert.deepEqual(
    ranking.map((x) => x.projectId),
    ["alpha", "beta", "gamma"],
  );
  assert.equal(
    ranking[0]!.score,
    ranking[0]!.breakdown.reduce((n, b) => n + b.points, 0),
  );
  assert.ok(
    ranking[1]!.breakdown.find((b) => b.factor === "health")!.points > 0,
  );
});

test("priorities: a project is placed after an unhealthy project it depends on", () => {
  const r = rig({ runs: [run("beta", [task({ status: "FAILED" })])] });
  r.pf.setProfile(
    "alpha",
    { priority: "CRITICAL", strategicImportance: 5, urgency: 5 },
    "o",
  );
  r.pf.addDependency(
    { from: "alpha", to: "beta", kind: "DEPENDS_ON" },
    "o",
    all,
  );
  const ranking = r.pf.priorities(all);
  const a = ranking.find((x) => x.projectId === "alpha")!;
  const b = ranking.find((x) => x.projectId === "beta")!;
  assert.ok(b.rank < a.rank, "the dependency comes first");
  assert.deepEqual(a.waitFor, ["beta"]);
});

test("profiles validate their inputs; archiving hides but deletes nothing", () => {
  const r = rig();
  assert.throws(
    () => r.pf.setProfile("alpha", { priority: "URGENT!" }, "o"),
    /priority must be/,
  );
  assert.throws(
    () => r.pf.setProfile("alpha", { urgency: 9 }, "o"),
    /urgency must be/,
  );
  assert.throws(
    () => r.pf.setProfile("ghost", { priority: "HIGH" }, "o"),
    /project not found/,
  );
  r.pf.setProfile(
    "alpha",
    {
      stack: ["React", "Firebase"],
      deploymentTarget: "Firebase Hosting",
      firebaseProject: "alpha-prod",
      environment: "PRODUCTION",
      objectives: ["Ship v2"],
    },
    "o",
  );
  const s = r.pf.summary("alpha", all);
  assert.deepEqual(s.stack, ["React", "Firebase"]);
  assert.equal(s.firebaseProject, "alpha-prod");
  assert.equal(s.repository, "https://github.com/acme/alpha");
  r.pf.setArchived("alpha", true, "o");
  assert.equal(
    r.pf.summaries(all).some((x) => x.projectId === "alpha"),
    false,
  );
  assert.equal(
    r.pf.summaries(all, true).some((x) => x.projectId === "alpha"),
    true,
  );
});

/* ------------------------------- dashboard ------------------------------- */

test("dashboard: counts, blocked projects, deployments, failures, security, costs and upcoming actions", () => {
  const r = rig({
    runs: [
      run("alpha", [
        task({ status: "COMPLETED" }),
        task({ status: "COMPLETED", type: "DEPLOYMENT" }),
        task({ status: "FAILED", type: "DEPLOYMENT" }),
      ]),
      run("beta", [
        task({ status: "BLOCKED", blockKind: "security" }),
        task({ status: "WAITING_APPROVAL" }),
        task({ status: "READY" }),
      ]),
    ],
    usage: [
      usage({ projectId: "alpha", usd: 1.25 }),
      usage({ projectId: "alpha", usd: null }),
    ],
    alerts: [alert({ projectId: "alpha", severity: "HIGH" })],
  });
  r.pf.addDependency({ from: "alpha", to: "beta" }, "o", all);
  const d = r.pf.dashboard(all);
  assert.equal(d.counts.projects, 3);
  assert.equal(d.counts.blocked, 1);
  assert.deepEqual(
    d.blockedProjects.map((b) => b.projectId),
    ["beta"],
  );
  assert.deepEqual(
    d.deployments.find((x) => x.projectId === "alpha"),
    {
      projectId: "alpha",
      total: 2,
      failed: 1,
      lastAt: "2026-10-01T00:10:00.000Z",
    },
  );
  assert.equal(d.failures.find((f) => f.projectId === "alpha")!.failedTasks, 1);
  assert.equal(d.security[0]!.critical, 1);
  assert.equal(d.costs.find((c) => c.projectId === "alpha")!.spentUsd, 1.25);
  assert.equal(d.costs.find((c) => c.projectId === "alpha")!.unpriced, 1);
  assert.equal(
    d.costs.find((c) => c.projectId === "gamma")!.spentUsd,
    null,
    "no usage is null, not zero",
  );
  const kinds = d.upcomingActions
    .filter((a) => a.projectId === "beta")
    .map((a) => a.kind)
    .sort();
  assert.deepEqual(kinds, ["APPROVAL", "BLOCKED_TASK", "READY_TASK"]);
  assert.equal(d.dependencies.length, 1);
});

/* ----------------------------- portfolio questions ----------------------------- */

test("ask: which project needs attention first — answered from health, alerts and approvals", () => {
  const r = rig({
    runs: [
      run("beta", [
        task({ status: "FAILED" }),
        task({ status: "WAITING_APPROVAL" }),
      ]),
      run("alpha", [task({ status: "COMPLETED" })]),
    ],
    alerts: [alert({ projectId: "beta", severity: "HIGH" })],
  });
  const a = r.pf.ask("Which project needs attention first?", all);
  assert.equal(a.intent, "attention");
  assert.match(a.answer, /^BETA needs attention first/);
  assert.equal((a.data as { projectId: string }[])[0]!.projectId, "beta");
  assert.ok(a.basis.length > 0);
});

test("ask: blocked, AI consumption, deployment risk and shared resources", () => {
  const r = rig({
    runs: [
      run("alpha", [task({ status: "BLOCKED", blockKind: "dependency" })]),
      run("beta", [
        task({ status: "FAILED", type: "DEPLOYMENT" }),
        task({ status: "FAILED", type: "TEST" }),
      ]),
    ],
    usage: [
      usage({ projectId: "alpha", totalTokens: 9000, usd: 3 }),
      usage({ projectId: "beta", totalTokens: 1000, usd: 0.1 }),
    ],
  });
  r.pf.claim(
    {
      projectId: "alpha",
      kind: "AGENT",
      resourceId: "dev-agent",
      exclusive: true,
    },
    "o",
    all,
  );
  r.pf.claim(
    { projectId: "beta", kind: "AGENT", resourceId: "dev-agent" },
    "o",
    all,
  );
  assert.match(
    r.pf.ask("Which project is blocked?", all).answer,
    /Blocked: ALPHA/,
  );
  const ai = r.pf.ask("What is consuming the most AI resources?", all);
  assert.match(ai.answer, /ALPHA uses the most AI: 9,000 tokens and \$3\.0000/);
  assert.equal(ai.confidence, "ESTABLISHED");
  const dep = r.pf.ask("Which project has the highest deployment risk?", all);
  assert.match(dep.answer, /BETA has the highest deployment risk/);
  assert.ok((dep.data as { reasons: string[] }[])[0]!.reasons.length >= 2);
  assert.match(
    r.pf.ask("Which projects depend on the same resource?", all).answer,
    /alpha and beta both claim agent "dev-agent"/,
  );
});

test("ask: honest when there is no data or the question is not supported", () => {
  const empty = rig();
  assert.equal(
    empty.pf.ask("Which project needs attention first?", all).confidence,
    "NO_DATA",
  );
  assert.match(
    empty.pf.ask("What is consuming the most AI resources?", all).answer,
    /No AI usage has been recorded/,
  );
  assert.match(
    empty.pf.ask("Which project has the highest deployment risk?", all).answer,
    /no deployment, test or alert evidence/i,
  );
  const unsupported = empty.pf.ask("What is the meaning of life?", all);
  assert.equal(unsupported.intent, "unsupported");
  assert.equal(unsupported.confidence, "NO_DATA");
  assert.equal(empty.pf.ask("anything", () => false).intent, "none");
});

/* --------------------------- isolation & knowledge --------------------------- */

test("project isolation: every read is filtered to the principal's projects", () => {
  const r = rig({
    runs: [
      run("alpha", [task({ status: "FAILED" })]),
      run("beta", [task({ status: "FAILED", type: "DEPLOYMENT" })]),
    ],
    usage: [usage({ projectId: "beta", usd: 99 })],
    alerts: [alert({ projectId: "beta", severity: "CRITICAL" })],
  });
  r.pf.addDependency({ from: "alpha", to: "beta" }, "o", all);
  r.pf.claim(
    { projectId: "alpha", kind: "AGENT", resourceId: "x", exclusive: true },
    "o",
    all,
  );
  r.pf.claim({ projectId: "beta", kind: "AGENT", resourceId: "x" }, "o", all);
  const a = only("alpha");
  assert.deepEqual(
    r.pf.summaries(a).map((s) => s.projectId),
    ["alpha"],
  );
  assert.equal(r.pf.dashboard(a).counts.projects, 1);
  assert.deepEqual(
    r.pf.listDependencies(a),
    [],
    "an edge to an inaccessible project is invisible",
  );
  assert.deepEqual(r.pf.conflicts(a), []);
  assert.equal(r.pf.summary("alpha", a).dependsOn.length, 0);
  assert.throws(() => r.pf.summary("beta", a), /project not found/);
  assert.throws(() => r.pf.health("beta", a), /project not found/);
  assert.ok(!JSON.stringify(r.pf.dashboard(a)).includes("beta"));
  assert.ok(
    !JSON.stringify(
      r.pf.ask("What is consuming the most AI resources?", a),
    ).includes("beta"),
  );
  assert.equal(r.pf.priorities(a).length, 1);
});

test("a cross-project relationship needs access to BOTH projects", () => {
  const r = rig();
  assert.throws(
    () => r.pf.addDependency({ from: "alpha", to: "beta" }, "o", only("alpha")),
    /project not found/,
  );
  assert.throws(
    () =>
      r.pf.claim(
        { projectId: "beta", kind: "AGENT", resourceId: "x" },
        "o",
        only("alpha"),
      ),
    /project not found/,
  );
  const d = r.pf.addDependency({ from: "alpha", to: "beta" }, "o", all);
  assert.throws(
    () => r.pf.removeDependency(d.id, "o", only("alpha")),
    /dependency not found/,
  );
  r.pf.removeDependency(d.id, "o", all);
  assert.equal(r.pf.listDependencies(all).length, 0);
});

test("reusable knowledge: patterns shared by ≥2 accessible projects are SUGGESTED, never copied", () => {
  const mem = (projectId: string, id: string, tags: string[]): MemoryRecord =>
    ({
      memoryId: id,
      projectId,
      type: "ARCHITECTURAL",
      status: "ACTIVE",
      tags,
      title: id,
      content: "secret detail",
    }) as unknown as MemoryRecord;
  const r = rig({
    memories: [
      mem("alpha", "m1", ["firestore-rules"]),
      mem("beta", "m2", ["firestore-rules"]),
      mem("gamma", "m3", ["firestore-rules", "only-gamma"]),
    ],
  });
  const items = r.pf.reusableKnowledge(all);
  const pattern = items.find((i) => i.kind === "PATTERN")!;
  assert.deepEqual(pattern.projects.sort(), ["alpha", "beta", "gamma"]);
  assert.match(pattern.note, /Nothing is copied/);
  assert.ok(items.some((i) => i.kind === "SKILL"));
  assert.ok(
    !JSON.stringify(items).includes("secret detail"),
    "memory content is never included",
  );
  const limited = r.pf.reusableKnowledge(only("alpha", "beta"));
  assert.deepEqual(limited.find((i) => i.kind === "PATTERN")!.projects.sort(), [
    "alpha",
    "beta",
  ]);
  assert.equal(
    r.pf.reusableKnowledge(only("alpha")).some((i) => i.kind === "PATTERN"),
    false,
    "one project alone is not cross-project",
  );
});

/* --------------------------------- control --------------------------------- */

test("control: reads need view, commands need manage_portfolio, scope follows the principal", async () => {
  const r = rig({
    runs: [
      run("alpha", [task({ status: "COMPLETED" })]),
      run("beta", [task({ status: "FAILED" })]),
    ],
  });
  assert.equal(r.control.dashboard(VIEWER).counts.projects, 3);
  assert.equal(r.control.projects(ALPHA_ONLY).projects.length, 1);
  assert.throws(
    () => r.control.project(ALPHA_ONLY, "beta"),
    /project not found/,
  );
  assert.equal(
    (
      await r.control.execute("portfolio_set_profile", VIEWER, {
        projectId: "alpha",
        priority: "HIGH",
      })
    ).outcome,
    "denied",
  );
  assert.equal(
    (
      await r.control.execute("portfolio_set_profile", OPERATOR, {
        projectId: "alpha",
        priority: "HIGH",
      })
    ).outcome,
    "executed",
  );
  const crossing = await r.control.execute(
    "portfolio_add_dependency",
    ALPHA_ONLY,
    { from: "alpha", to: "beta" },
  );
  assert.equal(crossing.outcome, "rejected");
  assert.equal(crossing.errorKind, "not_found");
  const profile = await r.control.execute("portfolio_set_profile", ALPHA_ONLY, {
    projectId: "beta",
    priority: "LOW",
  });
  assert.equal(profile.errorKind, "not_found");
  assert.equal(
    (
      await r.control.execute("portfolio_add_dependency", ADMIN, {
        from: "alpha",
        to: "beta",
      })
    ).outcome,
    "executed",
  );
  assert.equal(
    (await r.control.execute("portfolio_nuke", ADMIN, {})).outcome,
    "rejected",
  );
  assert.match(
    r.control.priorities(VIEWER).note,
    /never changed automatically/,
  );
});

test("the portfolio layer changes nothing in the projects themselves", () => {
  const r = rig({ runs: [run("alpha", [task({ status: "FAILED" })])] });
  const before = JSON.stringify(r.data.runs);
  r.pf.dashboard(all);
  r.pf.priorities(all);
  r.pf.ask("Which project needs attention first?", all);
  r.pf.reusableKnowledge(all);
  assert.equal(JSON.stringify(r.data.runs), before);
});
