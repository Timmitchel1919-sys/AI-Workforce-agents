/**
 * Layer 13 — Analytics, Prediction & Optimization. Real service over real run/task/usage-shaped
 * data. Predictions must be ranges with labels, recommendations must carry trade-offs and pass the
 * owner, what-if must not change anything.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AnalyticsError,
  AnalyticsIntelligence,
  inMemoryAnalyticsRepos,
  linearTrend,
  median,
  quality,
  wilson,
  type ApprovalFact,
  type ExecutionRun,
  type Lesson,
  type ToolFact,
  type UsageRecord,
  type WorkflowInstance,
} from "../core/index.js";
import type { AlertFact } from "../core/portfolio-intelligence/health.js";
import { AnalyticsControlService } from "../control/services/platform-layers-control.js";
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
  approvals: ApprovalFact[];
  tools: ToolFact[];
  autonomy: WorkflowInstance[];
  health: { connectorId: string; status: string }[];
}
function rig(partial: Partial<Data> = {}, remember?: (l: Lesson) => boolean) {
  const f = makeSecurity();
  const d: Data = {
    runs: [],
    usage: [],
    alerts: [],
    approvals: [],
    tools: [],
    autonomy: [],
    health: [],
    ...partial,
  };
  const repos = inMemoryAnalyticsRepos();
  const analytics = new AnalyticsIntelligence(repos, {
    runs: () => d.runs,
    deriveRunStatus: derive,
    usage: () => d.usage,
    alerts: () => d.alerts,
    approvals: () => d.approvals,
    toolActivity: () => d.tools,
    connectorHealth: () => d.health,
    autonomy: () => d.autonomy,
    dependentsOf: (p) => (p === "beta" ? ["alpha"] : []),
    ...(remember ? { remember } : {}),
    ledger: f.security.ledger,
    clock: f.clock.iso,
    now: f.clock.now,
  });
  const control = new AnalyticsControlService(
    { audit: f.audit, clock: f.clock.iso },
    analytics,
  );
  return { ...f, analytics, control, data: d, repos };
}
const all = () => true;
const only =
  (...ids: string[]) =>
  (id: string) =>
    ids.includes(id);
const T = (iso: string) => ({
  startedAt: iso,
  completedAt: new Date(Date.parse(iso) + 600_000).toISOString(),
});

/* --------------------------------- statistics --------------------------------- */

test("statistics are honest about small samples", () => {
  const [lo, hi] = wilson(1, 2);
  assert.ok(lo < 0.1 && hi > 0.9, "1 of 2 says almost nothing");
  const [l2, h2] = wilson(50, 100);
  assert.ok(h2 - l2 < 0.25, "100 samples narrow the range");
  assert.deepEqual(wilson(0, 0), [0, 1]);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([]), null);
  assert.equal(linearTrend([1, 2]), null, "no trend from two points");
  assert.ok(linearTrend([1, 2, 3, 4])!.slope > 0.9);
  assert.equal(quality(0), "NO_DATA");
  assert.equal(quality(3), "LOW_CONFIDENCE");
  assert.equal(quality(20), "ESTABLISHED");
});

/* ---------------------------------- agents ---------------------------------- */

test("agent analytics: tasks, success rate, execution time, retries, corrections, tokens, cost, models and tools", () => {
  const r = rig({
    runs: [
      run("alpha", [
        task({
          agent: "dev",
          status: "COMPLETED",
          ...T("2026-10-02T00:00:00.000Z"),
          attempts: 2,
          corrections: 1,
        }),
        task({
          agent: "dev",
          status: "COMPLETED",
          ...T("2026-10-02T01:00:00.000Z"),
        }),
        task({ agent: "dev", status: "FAILED" }),
        task({
          agent: "dev",
          status: "RUNNING",
          completedAt: undefined as never,
        }),
        task({ agent: "qa", status: "COMPLETED" }),
      ]),
    ],
    usage: [
      usage({ agentId: "dev", usd: 0.4, model: "claude-sonnet-5" }),
      usage({ agentId: "dev", usd: null, model: "mystery-model" }),
      usage({ agentId: "qa", usd: 0.1 }),
    ],
    tools: [
      {
        agentId: "dev",
        capability: "repository.read",
        projectId: "alpha",
        outcome: "SUCCESS",
        at: "t",
      },
      {
        agentId: "dev",
        capability: "repository.read",
        projectId: "alpha",
        outcome: "SUCCESS",
        at: "t",
      },
    ],
  });
  const dev = r.analytics.agents(all).find((a) => a.agentId === "dev")!;
  assert.equal(dev.assigned, 4);
  assert.equal(dev.completed, 2);
  assert.equal(dev.failed, 1);
  assert.equal(dev.inProgress, 1);
  assert.deepEqual(
    [dev.successRate.numerator, dev.successRate.denominator],
    [2, 3],
  );
  assert.equal(dev.avgExecutionMs, 600_000);
  assert.equal(dev.retried, 1);
  assert.equal(dev.correctionsRequested, 1);
  assert.equal(dev.tokens, 3000);
  assert.equal(dev.costUsd, 0.4, "only the priced call is summed");
  assert.equal(
    dev.unpricedCalls,
    1,
    "the unpriced call is counted, not guessed",
  );
  assert.deepEqual(dev.models.map((m) => m.model).sort(), [
    "claude-sonnet-5",
    "mystery-model",
  ]);
  assert.deepEqual(dev.tools, [{ tool: "repository.read", calls: 2 }]);
  assert.equal(
    dev.quality,
    "LOW_CONFIDENCE",
    "3 finished tasks is not enough to be sure",
  );
});

test("agent analytics: an agent with no finished work has a null rate, not 0%", () => {
  const r = rig({
    runs: [run("alpha", [task({ agent: "new", status: "RUNNING" })])],
  });
  const a = r.analytics.agents(all)[0]!;
  assert.equal(a.successRate.value, null);
  assert.equal(a.quality, "NO_DATA");
});

/* -------------------------------- workflows -------------------------------- */

test("workflow analytics: completion/failure rates, duration, retries, failure points and approval waits", () => {
  const now = "2026-10-11T12:00:00.000Z";
  const failing = (n: number) =>
    Array.from({ length: n }, () =>
      task({
        status: "FAILED",
        type: "TEST",
        title: "Run tests",
        failures: [{ error: "red" } as never],
      }),
    );
  const r = rig({
    runs: [
      run("alpha", [task({ status: "COMPLETED" })], {
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T01:00:00.000Z",
      }),
      run("alpha", [task({ status: "COMPLETED", attempts: 2 })], {
        createdAt: "2026-10-02T00:00:00.000Z",
        updatedAt: "2026-10-02T03:00:00.000Z",
      }),
      run("alpha", failing(2), {
        createdAt: "2026-10-03T00:00:00.000Z",
        updatedAt: "2026-10-03T02:00:00.000Z",
      }),
      run("alpha", [task({ status: "RUNNING" })]),
    ],
    approvals: [
      {
        id: "1",
        action: "a",
        status: "approved",
        requestedAt: "2026-10-10T00:00:00.000Z",
        decidedAt: "2026-10-10T02:00:00.000Z",
      },
      {
        id: "2",
        action: "a",
        status: "pending",
        requestedAt: "2026-10-10T12:00:00.000Z",
      },
    ],
  });
  r.clock.set(now);
  const w = r.analytics.workflows(all);
  assert.equal(w.runs, 4);
  assert.equal(w.completed, 2);
  assert.equal(w.failed, 1);
  assert.equal(w.active, 1);
  assert.deepEqual(
    [w.completionRate.numerator, w.completionRate.denominator],
    [2, 3],
  );
  assert.equal(w.avgDurationMs, 2 * 3600_000);
  assert.equal(w.medianDurationMs, 3600_000 * 2);
  assert.equal(w.retryFrequency.numerator, 1);
  assert.deepEqual(w.failurePoints[0], {
    taskType: "TEST",
    title: "Run tests",
    failures: 2,
  });
  assert.equal(w.approvalWait.decided, 1);
  assert.equal(w.approvalWait.avgMs, 2 * 3600_000);
  assert.equal(w.approvalWait.pending, 1);
  assert.equal(w.approvalWait.oldestPendingMs, 24 * 3600_000);
});

test("workflow analytics with no history reports no data", () => {
  const w = rig().analytics.workflows(all);
  assert.equal(w.runs, 0);
  assert.equal(w.completionRate.value, null);
  assert.equal(w.avgDurationMs, null);
  assert.equal(w.quality, "NO_DATA");
});

/* -------------------------------- projects -------------------------------- */

test("project analytics: weekly completion trend, velocity, defects, deployments, security and cost", () => {
  const done = (iso: string, over: object = {}) =>
    task({ status: "COMPLETED", completedAt: iso, ...over });
  const r = rig({
    runs: [
      run("alpha", [
        done("2026-09-23T10:00:00.000Z"),
        done("2026-09-30T10:00:00.000Z"),
        done("2026-10-01T10:00:00.000Z"),
        done("2026-10-08T10:00:00.000Z"),
        done("2026-10-09T10:00:00.000Z"),
        task({ status: "FAILED" }),
        task({ status: "COMPLETED", type: "DEPLOYMENT" }),
        task({ status: "FAILED", type: "DEPLOYMENT" }),
        task({ status: "BLOCKED", blockedReason: "budget" }),
      ]),
    ],
    alerts: [
      {
        alertId: "a",
        projectId: "alpha",
        severity: "HIGH",
        status: "OPEN",
        event: "e",
        description: "d",
      },
      {
        alertId: "b",
        projectId: "alpha",
        severity: "LOW",
        status: "RESOLVED",
        event: "e",
        description: "d",
      },
    ],
    usage: [usage({ usd: 1 }), usage({ usd: null })],
  });
  const p = r.analytics.project("alpha", all);
  assert.equal(p.completionTrend.length, 8);
  assert.equal(p.completionTrend.at(-1)!.completed, 2, "this week (Oct 5–11)");
  assert.equal(
    p.completionTrend.at(-2)!.completed,
    3,
    "previous week (includes the completed deployment task)",
  );
  assert.ok(p.velocityPerWeek !== null && p.velocityPerWeek > 0);
  assert.deepEqual(
    [p.deploymentSuccess.numerator, p.deploymentSuccess.denominator],
    [1, 2],
  );
  assert.equal(p.securityIssues.open, 1);
  assert.equal(p.securityIssues.highOrCritical, 1);
  assert.deepEqual(
    p.blockers.map((b) => b.reason),
    ["budget"],
  );
  assert.equal(p.cost.usd, 1);
  assert.equal(p.cost.unpriced, 1);
  assert.ok(p.defectRate.value! > 0);
});

test("project analytics: no velocity from fewer than three finished tasks", () => {
  const p = rig({
    runs: [run("alpha", [task({ status: "COMPLETED" })])],
  }).analytics.project("alpha", all);
  assert.equal(p.velocityPerWeek, null);
  assert.equal(p.quality, "LOW_CONFIDENCE");
  assert.throws(
    () => rig().analytics.project("alpha", () => false),
    (e: unknown) => e instanceof AnalyticsError && e.code === "not_found",
  );
});

/* ----------------------------------- cost ----------------------------------- */

test("cost intelligence: by project, model, agent and workflow; unpriced calls are never estimated", () => {
  const rr = run("alpha", [
    task({ taskId: "t1", status: "COMPLETED" }),
    task({ taskId: "t2", status: "COMPLETED" }),
  ]);
  const r = rig({
    runs: [rr],
    usage: [
      usage({
        projectId: "alpha",
        model: "claude-sonnet-5",
        agentId: "dev",
        taskId: "t1",
        totalTokens: 2000,
        usd: 0.5,
        createdAt: "2026-10-06T00:00:00.000Z",
      }),
      usage({
        projectId: "alpha",
        model: "claude-haiku-4-5-20251001",
        agentId: "qa",
        taskId: "t2",
        totalTokens: 1000,
        usd: 0.05,
        createdAt: "2026-10-07T00:00:00.000Z",
      }),
      usage({
        projectId: "beta",
        model: "unpriced-model",
        totalTokens: 500,
        usd: null,
        createdAt: "2026-10-07T00:00:00.000Z",
      }),
    ],
  });
  const c = r.analytics.cost(all);
  assert.equal(c.totalTokens, 3500);
  assert.equal(c.pricedUsd, 0.55);
  assert.equal(c.unpricedCalls, 1);
  assert.equal(c.calls, 3);
  assert.deepEqual(
    c.byProject.map((x) => x.projectId),
    ["alpha", "beta"],
  );
  assert.equal(c.byProject.find((x) => x.projectId === "beta")!.usd, null);
  assert.equal(
    c.byModel.find((x) => x.model === "unpriced-model")!.unpriced,
    1,
  );
  assert.equal(c.byAgent.find((x) => x.agentId === "dev")!.tokens, 2000);
  assert.equal(c.byWorkflow[0]!.runId, rr.runId);
  assert.equal(c.perTask.average, 1500);
  assert.equal(c.weekly.length, 8);
  assert.equal(c.weekly.at(-1)!.tokens, 3500, "week of Oct 5");
  assert.match(c.note, /never estimated/);
  assert.ok(!JSON.stringify(c).toLowerCase().includes("apikey"));
  assert.deepEqual(
    r.analytics.cost(all, "beta").byProject.map((x) => x.projectId),
    ["beta"],
  );
});

/* -------------------------------- bottlenecks -------------------------------- */

test("bottleneck detection: repeated failures, old approvals, overloaded agent, unreliable tool, deployments and manual steps", () => {
  const r = rig({
    runs: [
      run("alpha", [
        task({
          status: "FAILED",
          type: "TEST",
          title: "Flaky suite",
          failures: [{ error: "x" } as never, { error: "y" } as never],
        }),
        task({ status: "FAILED", type: "DEPLOYMENT", title: "Deploy" }),
        task({ status: "FAILED", type: "DEPLOYMENT", title: "Deploy 2" }),
        ...Array.from({ length: 8 }, () =>
          task({ status: "RUNNING", agent: "busy" }),
        ),
        task({ status: "RUNNING", agent: "idle" }),
        task({ status: "RUNNING", agent: "idle2" }),
      ]),
    ],
    approvals: [
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `o${i}`,
        action: "deploy",
        status: "pending",
        requestedAt: "2026-10-09T00:00:00.000Z",
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `a${i}`,
        action: "autonomy:run_tests",
        status: "approved",
        requestedAt: "2026-10-01T00:00:00.000Z",
        decidedAt: "2026-10-01T00:01:00.000Z",
      })),
    ],
    tools: Array.from({ length: 4 }, () => ({
      capability: "repository.read",
      connectorId: "github",
      projectId: "alpha",
      outcome: "FAILED",
      at: "t",
    })),
    health: [{ connectorId: "slack", status: "ERROR" }],
  });
  const kinds = r.analytics.bottlenecks(all).map((b) => b.kind);
  for (const k of [
    "REPEATED_FAILURE",
    "APPROVAL_QUEUE",
    "OVERLOADED_AGENT",
    "UNAVAILABLE_TOOL",
    "DEPLOYMENT",
    "REPEATED_MANUAL_STEP",
  ])
    assert.ok(kinds.includes(k as never), k);
  const list = r.analytics.bottlenecks(all);
  assert.equal(list[0]!.severity, "SERIOUS", "serious findings come first");
  assert.ok(
    list.some((b) => b.kind === "UNAVAILABLE_TOOL" && b.subject === "slack"),
  );
  assert.equal(
    rig().analytics.bottlenecks(all).length,
    0,
    "nothing is invented when there is no data",
  );
});

/* -------------------------------- predictions -------------------------------- */

test("predictions are ranges with labels — LOW_CONFIDENCE on a small sample, never a certainty", () => {
  const small = rig({
    runs: [
      run("alpha", [task({ status: "FAILED" })]),
      run("alpha", [task({ status: "FAILED" })]),
    ],
  }).analytics.predictions(all);
  const p = small.find((x) => x.kind === "WORKFLOW_FAILURE")!;
  assert.equal(p.label, "LOW_CONFIDENCE");
  assert.ok(
    (p.range![0] < 0.5 && p.range![1] === 1) || p.range![1] > 0.8,
    "two failures still leave a wide range",
  );
  assert.ok(p.range![1] - p.range![0] > 0.5);
  assert.equal(p.sample, 2);
  for (const x of small)
    assert.ok(
      x.range === undefined || x.range[0] < x.range[1],
      "a range, never a point",
    );

  const many = rig({
    runs: Array.from({ length: 8 }, () =>
      run("alpha", [task({ status: "FAILED" })]),
    ),
  })
    .analytics.predictions(all)
    .find((x) => x.kind === "WORKFLOW_FAILURE")!;
  assert.equal(many.label, "HIGH_RISK");
  assert.ok(many.range![0] > 0.5);
  assert.ok(many.range![0] < 1, "even 8 of 8 leaves a margin below certainty");
  assert.match(many.statement, /may fail/);

  const good = rig({
    runs: Array.from({ length: 10 }, () =>
      run("alpha", [task({ status: "COMPLETED" })]),
    ),
  })
    .analytics.predictions(all)
    .find((x) => x.kind === "WORKFLOW_FAILURE")!;
  assert.equal(good.label, "POSSIBLE");
  assert.ok(good.range![1] < 0.4);
});

test("deployment risk and recurring-failure predictions need evidence", () => {
  const r = rig({
    runs: Array.from({ length: 6 }, (_, i) =>
      run("alpha", [
        task({
          status: i < 4 ? "FAILED" : "COMPLETED",
          type: "DEPLOYMENT",
          failures: i < 4 ? [{ error: "build failed at step 3" } as never] : [],
        }),
      ]),
    ),
  });
  const preds = r.analytics.predictions(all);
  const dep = preds.find((x) => x.kind === "DEPLOYMENT_RISK")!;
  assert.ok(["HIGH_RISK", "LIKELY"].includes(dep.label));
  const rec = preds.find((x) => x.kind === "RECURRING_FAILURE")!;
  assert.match(rec.statement, /build failed at step N/);
  assert.equal(
    rig({ runs: [run("alpha", [task({ status: "COMPLETED" })])] })
      .analytics.predictions(all)
      .some((x) => x.kind === "DEPLOYMENT_RISK"),
    false,
  );
});

test("cost trend: needs ≥3 active weeks, gives a token range and says LOW_CONFIDENCE when short", () => {
  const week = (start: string, tokens: number) =>
    usage({
      createdAt: `${start}T10:00:00.000Z`,
      totalTokens: tokens,
      usd: 0.1,
    });
  const few = rig({
    usage: [week("2026-09-21", 1000), week("2026-09-28", 1200)],
  }).analytics.predictions(all);
  assert.equal(
    few.some((x) => x.kind === "COST_TREND"),
    false,
    "two weeks is no trend",
  );
  const r = rig({
    usage: [
      week("2026-09-21", 1000),
      week("2026-09-28", 2000),
      week("2026-10-05", 3000),
    ],
  });
  const t = r.analytics.predictions(all).find((x) => x.kind === "COST_TREND")!;
  assert.equal(t.label, "LOW_CONFIDENCE");
  assert.match(t.statement, /rising/);
  assert.ok(t.range![0] <= t.range![1] && t.range![1] >= 3000);
  assert.equal(t.unit, "tokens next week");
});

/* ---------------------------- recommendations & loop ---------------------------- */

const costlyHistory = (): Partial<Data> => {
  const tasks = Array.from({ length: 6 }, (_, i) =>
    task({
      taskId: `doc-${i}`,
      type: "DOCUMENTATION",
      status: "COMPLETED",
      estimate: { inputTokens: 14000, note: "" },
    }),
  );
  return {
    runs: [run("alpha", tasks)],
    usage: tasks.map((t) =>
      usage({
        taskId: t.taskId,
        model: "claude-opus-5-5",
        inputTokens: 100_000,
        outputTokens: 20_000,
        totalTokens: 120_000,
        usd: 3,
      }),
    ),
  };
};

test("a cheaper-model recommendation shows the evidence, the saving AND the trade-off", () => {
  const r = rig(costlyHistory());
  const recs = r.analytics.refreshRecommendations(all, "owner");
  const model = recs.find((x) => x.area === "MODEL")!;
  assert.match(model.observation, /6 low-complexity tasks/);
  assert.match(model.recommendation, /claude-haiku-4-5-20251001/);
  assert.match(model.tradeoff, /may be less capable/);
  assert.match(model.tradeoff, /\$\d/);
  assert.equal(model.requiresApproval, true);
  assert.equal(model.status, "OPEN");
  assert.ok(model.evidence.length >= 2);
  assert.ok(
    recs.some(
      (x) => x.area === "COST" && /12,000 input tokens/.test(x.observation),
    ),
    "oversized context is flagged",
  );
  for (const rec of recs)
    assert.ok(rec.tradeoff.length > 0, `${rec.area} states its trade-off`);
});

test("routing, testing, prompt, tool and workflow recommendations come from the same data", () => {
  const good = Array.from({ length: 6 }, () =>
    task({ agent: "senior", type: "DEVELOPMENT", status: "COMPLETED" }),
  );
  const bad = [
    ...Array.from({ length: 4 }, () =>
      task({ agent: "junior", type: "DEVELOPMENT", status: "FAILED" }),
    ),
    ...Array.from({ length: 2 }, () =>
      task({ agent: "junior", type: "DEVELOPMENT", status: "COMPLETED" }),
    ),
  ];
  const r = rig({
    runs: [
      run("alpha", [
        ...good,
        ...bad,
        ...Array.from({ length: 2 }, () =>
          task({ type: "DEPLOYMENT", status: "FAILED" }),
        ),
        task({ corrections: 3 }),
        task({ corrections: 2 }),
      ]),
    ],
    tools: Array.from({ length: 4 }, () => ({
      capability: "repository.read",
      connectorId: "github",
      projectId: "alpha",
      outcome: "FAILED",
      at: "t",
    })),
    approvals: Array.from({ length: 6 }, (_, i) => ({
      id: `a${i}`,
      action: "autonomy:run_tests",
      status: "approved",
      requestedAt: "2026-10-01T00:00:00.000Z",
      decidedAt: "2026-10-01T00:01:00.000Z",
    })),
  });
  const areas = r.analytics
    .refreshRecommendations(all, "owner")
    .map((x) => x.area);
  for (const a of ["ROUTING", "DEPLOYMENT", "PROMPT", "TOOL", "WORKFLOW"])
    assert.ok(areas.includes(a as never), a);
  const routing = r.analytics
    .listRecommendations(all)
    .find((x) => x.area === "ROUTING")!;
  assert.match(
    routing.observation,
    /junior fails 67% of DEVELOPMENT tasks; senior fails 0%/,
  );
  assert.match(routing.tradeoff, /bottleneck/);
  const standing = r.analytics
    .listRecommendations(all)
    .find((x) => /approved \d+ times/.test(x.observation))!;
  assert.match(
    standing.tradeoff,
    /Never apply this to high-risk or destructive actions/,
  );
});

test("refreshing is idempotent and never disturbs a decision", () => {
  const r = rig(costlyHistory());
  const first = r.analytics.refreshRecommendations(all, "owner");
  const second = r.analytics.refreshRecommendations(all, "owner");
  assert.deepEqual(
    second.map((x) => x.recommendationId).sort(),
    first.map((x) => x.recommendationId).sort(),
  );
  assert.equal(
    r.analytics.listRecommendations(all).length,
    first.length,
    "no duplicates",
  );
  const id = first[0]!.recommendationId;
  r.analytics.decide(id, "REJECTED", "owner", all);
  r.analytics.refreshRecommendations(all, "owner");
  assert.equal(
    r.analytics.recommendation(id, all).status,
    "REJECTED",
    "the owner's decision stands",
  );
});

test("optimization loop: recommend → approve → applied → measured, with a real before/after", () => {
  const retried = Array.from({ length: 4 }, (_, i) =>
    task({ taskId: `r${i}`, attempts: 2 }),
  );
  const clean = Array.from({ length: 4 }, (_, i) =>
    task({ taskId: `c${i}`, attempts: 1 }),
  );
  const r = rig({
    runs: [run("alpha", [...retried, ...clean])],
    usage: [
      ...retried.map((t) =>
        usage({ taskId: t.taskId, totalTokens: 1000, usd: 0.1 }),
      ),
      ...clean.map((t) =>
        usage({ taskId: t.taskId, totalTokens: 1000, usd: 0.1 }),
      ),
    ],
  });
  const rec = r.analytics
    .refreshRecommendations(all, "owner")
    .find((x) => /retried/.test(x.observation))!;
  assert.equal(rec.metric!.name, "retry_token_share");
  assert.equal(rec.metric!.baseline, 0.5);
  assert.throws(
    () => r.analytics.markApplied(rec.recommendationId, "done", "owner", all),
    /only an approved recommendation/,
  );
  assert.throws(
    () => r.analytics.measure(rec.recommendationId, all),
    /after it has been applied/,
  );
  r.analytics.decide(rec.recommendationId, "APPROVED", "owner", all);
  assert.throws(
    () => r.analytics.decide(rec.recommendationId, "REJECTED", "owner", all),
    /already approved/,
  );
  r.analytics.markApplied(
    rec.recommendationId,
    "Improved the acceptance criteria",
    "owner",
    all,
  );
  assert.equal(
    r.analytics.recommendation(rec.recommendationId, all).status,
    "APPLIED",
  );
  // After the change, fewer tasks need a retry.
  r.data.runs = [
    run("alpha", [...retried.map((t) => ({ ...t, attempts: 1 })), ...clean]),
  ];
  const measured = r.analytics.measure(rec.recommendationId, all);
  assert.equal(measured.status, "MEASURED");
  assert.equal(measured.measurement!.verdict, "IMPROVED");
  assert.equal(measured.measurement!.value, 0);
  assert.equal(measured.measurement!.delta, -0.5);
  // And a change that left things as they were is reported as such, not as a success.
  r.data.runs = [run("alpha", [...retried, ...clean])];
  assert.equal(
    r.analytics.measure(rec.recommendationId, all).measurement!.verdict,
    "NO_CHANGE",
    "the same as at the moment it was applied",
  );
});

test("measuring with no data says NO_DATA instead of guessing", () => {
  const r = rig(costlyHistory());
  const rec = r.analytics
    .refreshRecommendations(all, "owner")
    .find((x) => x.area === "MODEL")!;
  r.analytics.decide(rec.recommendationId, "APPROVED", "owner", all);
  r.analytics.markApplied(rec.recommendationId, "switched", "owner", all);
  r.data.usage = [];
  r.data.runs = [];
  assert.equal(
    r.analytics.measure(rec.recommendationId, all).measurement!.verdict,
    "NO_DATA",
  );
});

/* ----------------------------------- what-if ----------------------------------- */

test("what-if is a simulation: it reads, explains assumptions, and changes nothing", () => {
  const r = rig({
    runs: [
      run("alpha", [
        task({ agent: "shared", status: "RUNNING" }),
        task({ agent: "shared", status: "QUEUED" }),
        task({ status: "COMPLETED", completedAt: "2026-10-08T00:00:00.000Z" }),
        task({ status: "COMPLETED", completedAt: "2026-10-09T00:00:00.000Z" }),
      ]),
      run("beta", [
        task({ agent: "shared", status: "RUNNING" }),
        task({ agent: "other", status: "READY" }),
      ]),
    ],
    usage: [usage({ projectId: "beta", totalTokens: 4000, usd: 1 })],
  });
  const snapshot = JSON.stringify([
    r.data,
    r.analytics.listRecommendations(all),
    r.security.ledger.query({ limit: 1000 }).length,
  ]);
  const p = r.analytics.whatIf(
    { kind: "PRIORITIZE", projectId: "alpha", above: "beta" },
    all,
  );
  assert.equal(p.simulated, true);
  assert.match(p.summary, /1 shared agent/);
  assert.ok(
    p.impacts.some((i) => i.area === "AGENTS" && /shared/.test(i.statement)),
  );
  assert.ok(p.impacts.some((i) => i.area === "DELAY" && i.value !== undefined));
  assert.ok(
    p.impacts.some(
      (i) => i.area === "DEPENDENCIES" && /alpha/.test(i.statement),
    ),
  );
  assert.ok(p.assumptions.length >= 2);
  const pause = r.analytics.whatIf(
    { kind: "PAUSE_PROJECT", projectId: "beta" },
    all,
  );
  assert.match(pause.summary, /hold 2 open task/);
  assert.ok(
    pause.impacts.some(
      (i) => i.area === "DEPENDENCIES" && /alpha/.test(i.statement),
    ),
  );
  const sw = r.analytics.whatIf(
    {
      kind: "SWITCH_MODEL",
      fromModel: "claude-sonnet-5",
      toModel: "claude-haiku-4-5-20251001",
    },
    all,
  );
  assert.ok(sw.impacts[0]!.value! < 0, "a cheaper model lowers cost");
  assert.equal(
    JSON.stringify([
      r.data,
      r.analytics.listRecommendations(all),
      r.security.ledger.query({ limit: 1000 }).length,
    ]),
    snapshot,
    "nothing changed",
  );
});

test("what-if refuses unknown or inaccessible projects and unpriced models", () => {
  const r = rig({
    runs: [
      run("alpha", [task({ status: "RUNNING" })]),
      run("beta", [task({ status: "RUNNING" })]),
    ],
  });
  assert.throws(
    () =>
      r.analytics.whatIf({ kind: "PAUSE_PROJECT", projectId: "ghost" }, all),
    /not found/,
  );
  assert.throws(
    () =>
      r.analytics.whatIf(
        { kind: "PRIORITIZE", projectId: "alpha", above: "beta" },
        only("alpha"),
      ),
    /not found/,
  );
  const sw = r.analytics.whatIf(
    { kind: "SWITCH_MODEL", fromModel: "x", toModel: "y" },
    all,
  );
  assert.equal(sw.confidence, "NO_DATA");
  assert.match(sw.impacts[0]!.statement, /no price|No usage/);
});

/* --------------------------------- learning --------------------------------- */

test("lessons: recurring errors, clean workflows, reliable agents and repeated security findings — captured once", () => {
  const stored: Lesson[] = [];
  const clean = Array.from({ length: 3 }, () =>
    run("alpha", [task({ status: "COMPLETED", attempts: 1 })], {
      intent: "BUG_FIX",
    }),
  );
  const r = rig(
    {
      runs: [
        ...clean,
        run(
          "alpha",
          Array.from({ length: 3 }, () =>
            task({
              status: "FAILED",
              failures: [
                { error: "Cannot find module '/tmp/x123/y.js'" } as never,
              ],
            }),
          ),
        ),
        run(
          "beta",
          Array.from({ length: 10 }, () =>
            task({ agent: "ace", type: "REVIEW", status: "COMPLETED" }),
          ),
        ),
      ],
      alerts: Array.from({ length: 3 }, () => ({
        alertId: "a",
        projectId: "alpha",
        severity: "MEDIUM" as const,
        status: "OPEN",
        event: "secret_in_output",
        description: "d",
      })),
    },
    (l) => (stored.push(l), true),
  );
  const created = r.analytics.captureLessons(all, "owner");
  const kinds = created.map((l) => l.kind);
  for (const k of [
    "COMMON_ERROR",
    "SUCCESSFUL_WORKFLOW",
    "EFFECTIVE_AGENT",
    "SECURITY",
  ])
    assert.ok(kinds.includes(k as never), k);
  assert.ok(created.every((l) => l.storedInKnowledge));
  assert.equal(
    stored.length,
    created.length,
    "handed to the Knowledge layer, not to a private store",
  );
  assert.equal(
    r.analytics.captureLessons(all, "owner").length,
    0,
    "the same lesson is never stored twice",
  );
  const err = created.find((l) => l.kind === "COMMON_ERROR")!;
  assert.match(err.content, /Cannot find module/);
  assert.equal(err.projectId, "alpha");
  assert.equal(r.analytics.listLessons(all).length, created.length);
});

test("lessons: a Knowledge layer that refuses is reported honestly", () => {
  const r = rig(
    {
      runs: [
        run(
          "alpha",
          Array.from({ length: 3 }, () =>
            task({
              status: "FAILED",
              failures: [{ error: "same error" } as never],
            }),
          ),
        ),
      ],
    },
    () => false,
  );
  const [l] = r.analytics.captureLessons(all, "owner");
  assert.equal(l!.storedInKnowledge, false);
});

/* ------------------------------ isolation & control ------------------------------ */

test("restricted analytics: another project's data never appears in a scoped view", () => {
  const r = rig({
    runs: [
      run("alpha", [task({ agent: "a1", status: "COMPLETED" })]),
      run("beta", [
        task({
          agent: "b1",
          status: "FAILED",
          failures: [{ error: "secret failure beta" } as never],
        }),
      ]),
    ],
    usage: [
      usage({ projectId: "beta", usd: 99, agentId: "b1" }),
      usage({ projectId: "alpha", usd: 1, agentId: "a1" }),
    ],
    alerts: [
      {
        alertId: "x",
        projectId: "beta",
        severity: "CRITICAL",
        status: "OPEN",
        event: "beta_incident",
        description: "d",
      },
    ],
    tools: [{ capability: "x", projectId: "beta", outcome: "FAILED", at: "t" }],
  });
  const a = only("alpha");
  const blob = JSON.stringify([
    r.analytics.overview(a),
    r.analytics.agents(a),
    r.analytics.cost(a),
    r.analytics.workflows(a),
    r.analytics.bottlenecks(a),
    r.analytics.predictions(a),
  ]);
  assert.ok(!blob.includes("beta"), "no trace of the other project");
  assert.ok(!blob.includes("b1") && !blob.includes("99"));
  assert.throws(() => r.analytics.project("beta", a), /project not found/);
  assert.equal(r.analytics.cost(a).pricedUsd, 1);
  r.analytics.refreshRecommendations(all, "owner");
  assert.ok(
    r.analytics
      .listRecommendations(a)
      .every((x) => !x.projectId || x.projectId === "alpha"),
  );
});

test("control: reads need view; refresh/measure/what-if/lessons need operator; decisions and 'applied' are the owner's", async () => {
  const r = rig(costlyHistory());
  assert.ok(r.control.overview(VIEWER).generatedAt);
  assert.equal(
    (await r.control.execute("analytics_refresh_recommendations", VIEWER, {}))
      .outcome,
    "denied",
  );
  assert.equal(
    (await r.control.execute("analytics_refresh_recommendations", OPERATOR, {}))
      .outcome,
    "executed",
  );
  const id = r.analytics
    .listRecommendations(all)
    .find((x) => x.area === "MODEL")!.recommendationId;
  assert.equal(
    (
      await r.control.execute("analytics_decide_recommendation", OPERATOR, {
        recommendationId: id,
        decision: "APPROVED",
      })
    ).outcome,
    "denied",
  );
  assert.equal(
    (
      await r.control.execute("analytics_decide_recommendation", ADMIN, {
        recommendationId: id,
        decision: "MAYBE",
      })
    ).outcome,
    "rejected",
  );
  assert.equal(
    (
      await r.control.execute("analytics_decide_recommendation", ADMIN, {
        recommendationId: id,
        decision: "APPROVED",
      })
    ).outcome,
    "executed",
  );
  assert.equal(
    (
      await r.control.execute("analytics_mark_applied", OPERATOR, {
        recommendationId: id,
        note: "x",
      })
    ).outcome,
    "denied",
  );
  assert.equal(
    (
      await r.control.execute("analytics_mark_applied", ADMIN, {
        recommendationId: id,
        note: "x",
      })
    ).outcome,
    "executed",
  );
  assert.equal(
    (
      await r.control.execute("analytics_measure_recommendation", OPERATOR, {
        recommendationId: id,
      })
    ).outcome,
    "executed",
  );
  const w = await r.control.execute("analytics_run_what_if", OPERATOR, {
    scenario: { kind: "PAUSE_PROJECT", projectId: "alpha" },
  });
  assert.equal(w.outcome, "executed");
  assert.equal(w.details["simulated"], true);
  assert.equal(
    (
      await r.control.execute("analytics_run_what_if", OPERATOR, {
        scenario: { kind: "DELETE_EVERYTHING" },
      })
    ).outcome,
    "rejected",
  );
  assert.equal(
    (await r.control.execute("analytics_capture_lessons", OPERATOR, {}))
      .outcome,
    "executed",
  );
  assert.equal(
    (await r.control.execute("analytics_rewrite_history", ADMIN, {})).outcome,
    "rejected",
  );
});

test("control: a scoped principal cannot read, simulate or decide on another project", async () => {
  const r = rig({
    runs: [
      run("alpha", [task({ status: "RUNNING" })]),
      run("beta", [task({ status: "RUNNING" })]),
    ],
  });
  assert.throws(
    () => r.control.project(ALPHA_ONLY, "beta"),
    /project not found/,
  );
  assert.throws(
    () => r.control.workflows(ALPHA_ONLY, "beta"),
    /project not found/,
  );
  assert.throws(() => r.control.cost(ALPHA_ONLY, "beta"), /project not found/);
  const res = await r.control.execute("analytics_run_what_if", ALPHA_ONLY, {
    scenario: { kind: "PAUSE_PROJECT", projectId: "beta" },
  });
  assert.equal(res.outcome, "rejected");
  assert.equal(res.errorKind, "not_found");
});

test("the analytics layer records no provider secrets and talks to no provider", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const dir = path.resolve(
    import.meta.dirname,
    "..",
    "core",
    "analytics-intelligence",
  );
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const text = readFileSync(path.join(dir, f), "utf8");
    assert.ok(
      !/await fetch|globalThis[.]fetch|node:https?|child_process|process[.]env|apiKey|api_key/i.test(
        text,
      ),
      f,
    );
  }
});
