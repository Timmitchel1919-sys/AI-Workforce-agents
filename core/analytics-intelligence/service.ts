/**
 * Analytics, prediction and optimization service. Reads real data through injected ports; stores
 * only recommendations (with their decision/measurement trail) and captured lessons. It never
 * changes prompts, routing, models or workflows itself: applying a recommendation passes the owner,
 * and "applied" is the owner's record that they did it.
 */
import { createHash } from "node:crypto";
import type { WorkflowInstance } from "../../contracts/autonomy.js";
import type {
  AgentAnalytics,
  AnalyticsOverview,
  Bottleneck,
  CostIntelligence,
  Lesson,
  Prediction,
  ProjectAnalytics,
  Recommendation,
  RecommendationArea,
  WhatIfResult,
  WhatIfScenario,
  WorkflowAnalytics,
} from "../../contracts/analytics-intelligence.js";
import { MODEL_PRICES, type UsageRecord } from "../../contracts/cost-center.js";
import type {
  ExecutionRun,
  OrchTask,
  RunStatus,
} from "../../contracts/execution-orchestration.js";
import type { Repository } from "../../contracts/persistence.js";
import { SyncCache } from "../knowledge-memory/memory-service.js";
import type { GovernanceLedger } from "../security-governance/ledger.js";
import type { AlertFact } from "../portfolio-intelligence/health.js";
import {
  lastWeeks,
  linearTrend,
  mean,
  median,
  ms,
  quality,
  rate,
  weekStart,
  wilson,
} from "./stats.js";

export class AnalyticsError extends Error {
  constructor(
    public readonly code: "invalid_request" | "not_found" | "invalid_state",
    message: string,
  ) {
    super(message);
    this.name = "AnalyticsError";
  }
}

export interface ApprovalFact {
  id: string;
  action: string;
  status: string;
  requestedAt: string;
  decidedAt?: string;
}
export interface ToolFact {
  agentId?: string;
  capability: string;
  connectorId?: string;
  projectId: string;
  outcome: string;
  at: string;
}

export interface AnalyticsPorts {
  runs(): ExecutionRun[];
  deriveRunStatus(run: ExecutionRun): RunStatus;
  usage(): UsageRecord[];
  alerts(): AlertFact[];
  approvals(): ApprovalFact[];
  toolActivity(): ToolFact[];
  connectorHealth?(): { connectorId: string; status: string }[];
  autonomy(): WorkflowInstance[];
  dependentsOf?(projectId: string): string[];
  /** Store a lesson in the Knowledge layer; returns whether it was accepted. */
  remember?(lesson: Lesson): boolean;
  ledger: GovernanceLedger;
  clock: () => string;
  now: () => number;
}

export interface AnalyticsRepos {
  recommendations: Repository<Recommendation>;
  lessons: Repository<Lesson>;
}

type Access = (projectId: string) => boolean;
const TERMINAL_TASK = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const LOW_COMPLEXITY = new Set(["DOCUMENTATION", "ANALYSIS", "RESEARCH"]);
const hash = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 10);
const usd = (list: UsageRecord[]): number | null => {
  let total = 0;
  let any = false;
  for (const u of list)
    if (u.cost.priced) {
      total += u.cost.amountUsd;
      any = true;
    }
  return any ? total : null;
};
const tokensOf = (u: UsageRecord) =>
  u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
const normalizeError = (e: string) =>
  e
    .toLowerCase()
    .replace(/[a-z]:\\[^\s"']+|\/[^\s"']+/g, "<path>")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .slice(0, 120);

export class AnalyticsIntelligence {
  private readonly recs: Repository<Recommendation>;
  private readonly lessonRepo: Repository<Lesson>;

  constructor(
    repos: AnalyticsRepos,
    private readonly ports: AnalyticsPorts,
  ) {
    this.recs = new SyncCache(repos.recommendations);
    this.lessonRepo = new SyncCache(repos.lessons);
  }

  private led(
    op: string,
    actor: string,
    detail: Record<string, string | number | boolean>,
  ): void {
    this.ports.ledger.record(`analytics.${op}`, {
      actor,
      result: "OK",
      detail,
    });
  }

  /* ------------------------------- data access ------------------------------- */

  private runs(access: Access, projectId?: string): ExecutionRun[] {
    return this.ports
      .runs()
      .filter(
        (r) => access(r.projectId) && (!projectId || r.projectId === projectId),
      );
  }
  private tasks(
    access: Access,
    projectId?: string,
  ): { task: OrchTask; run: ExecutionRun }[] {
    return this.runs(access, projectId).flatMap((run) =>
      run.tasks.map((task) => ({ task, run })),
    );
  }
  private usage(access: Access, projectId?: string): UsageRecord[] {
    return this.ports
      .usage()
      .filter(
        (u) => access(u.projectId) && (!projectId || u.projectId === projectId),
      );
  }

  /* --------------------------------- agents --------------------------------- */

  agents(access: Access): AgentAnalytics[] {
    const tasks = this.tasks(access);
    const usage = this.usage(access);
    const tools = this.ports.toolActivity().filter((t) => access(t.projectId));
    const ids = new Set<string>();
    for (const { task } of tasks)
      if (task.assignedAgent) ids.add(task.assignedAgent.agentId);
    for (const u of usage) if (u.agentId) ids.add(u.agentId);
    return [...ids]
      .map((agentId): AgentAnalytics => {
        const mine = tasks
          .filter(({ task }) => task.assignedAgent?.agentId === agentId)
          .map((x) => x.task);
        const completed = mine.filter((t) => t.status === "COMPLETED");
        const failed = mine.filter((t) => t.status === "FAILED");
        const u = usage.filter((x) => x.agentId === agentId);
        const durations = completed
          .map((t) => ms(t.startedAt, t.completedAt))
          .filter((x): x is number => x !== null);
        const models = new Map<string, number>();
        for (const x of u) models.set(x.model, (models.get(x.model) ?? 0) + 1);
        const toolCalls = new Map<string, number>();
        for (const t of tools)
          if (t.agentId === agentId)
            toolCalls.set(t.capability, (toolCalls.get(t.capability) ?? 0) + 1);
        const finished = completed.length + failed.length;
        return {
          agentId,
          assigned: mine.length,
          completed: completed.length,
          failed: failed.length,
          inProgress: mine.filter((t) => !TERMINAL_TASK.has(t.status)).length,
          successRate: rate(completed.length, finished),
          avgExecutionMs: mean(durations),
          retried: mine.filter((t) => t.attempts > 1).length,
          correctionsRequested: mine.reduce((n, t) => n + t.corrections, 0),
          tokens: u.reduce((n, x) => n + tokensOf(x), 0),
          costUsd: usd(u),
          unpricedCalls: u.filter((x) => !x.cost.priced).length,
          models: [...models]
            .map(([model, calls]) => ({ model, calls }))
            .sort((a, b) => b.calls - a.calls),
          tools: [...toolCalls]
            .map(([tool, calls]) => ({ tool, calls }))
            .sort((a, b) => b.calls - a.calls)
            .slice(0, 8),
          quality: quality(finished),
        };
      })
      .sort((a, b) => b.assigned - a.assigned);
  }

  /* -------------------------------- workflows -------------------------------- */

  workflows(access: Access, projectId?: string): WorkflowAnalytics {
    const runs = this.runs(access, projectId);
    const states = runs.map((r) => ({ r, s: this.ports.deriveRunStatus(r) }));
    const done = states.filter((x) => x.s === "COMPLETED" || x.s === "FAILED");
    const durations = done
      .map((x) => ms(x.r.createdAt, x.r.updatedAt))
      .filter((x): x is number => x !== null);
    const allTasks = runs.flatMap((r) => r.tasks);
    const failures = new Map<
      string,
      { taskType: string; title: string; failures: number }
    >();
    for (const t of allTasks) {
      const n = t.failures.length;
      if (n === 0) continue;
      const k = `${t.type}:${t.title}`;
      const cur = failures.get(k) ?? {
        taskType: t.type,
        title: t.title,
        failures: 0,
      };
      cur.failures += n;
      failures.set(k, cur);
    }
    const now = this.ports.now();
    const approvals = this.ports.approvals();
    const decided = approvals
      .filter((a) => a.decidedAt)
      .map((a) => ms(a.requestedAt, a.decidedAt))
      .filter((x): x is number => x !== null);
    const pending = approvals
      .filter((a) => a.status === "pending")
      .map((a) => now - Date.parse(a.requestedAt))
      .filter((x) => x >= 0);
    return {
      runs: runs.length,
      completed: states.filter((x) => x.s === "COMPLETED").length,
      failed: states.filter((x) => x.s === "FAILED").length,
      cancelled: states.filter((x) => x.s === "CANCELLED").length,
      active: states.filter((x) =>
        ["EXECUTING", "WAITING_APPROVAL", "REVIEW", "BLOCKED"].includes(x.s),
      ).length,
      completionRate: rate(
        states.filter((x) => x.s === "COMPLETED").length,
        done.length,
      ),
      failureRate: rate(
        states.filter((x) => x.s === "FAILED").length,
        done.length,
      ),
      avgDurationMs: mean(durations),
      medianDurationMs: median(durations),
      retryFrequency: rate(
        allTasks.filter((t) => t.attempts > 1).length,
        allTasks.filter((t) => t.attempts > 0).length,
      ),
      failurePoints: [...failures.values()]
        .sort((a, b) => b.failures - a.failures)
        .slice(0, 8),
      approvalWait: {
        decided: decided.length,
        avgMs: mean(decided),
        pending: pending.length,
        oldestPendingMs: pending.length ? Math.max(...pending) : null,
      },
      quality: quality(done.length),
    };
  }

  /* -------------------------------- projects -------------------------------- */

  project(projectId: string, access: Access): ProjectAnalytics {
    if (!access(projectId))
      throw new AnalyticsError("not_found", "project not found");
    const pairs = this.tasks(access, projectId);
    const tasks = pairs.map((p) => p.task);
    const weeks = lastWeeks(this.ports.clock(), 8);
    const trend = weeks.map((w) => ({
      weekStart: w,
      completed: tasks.filter(
        (t) =>
          t.completedAt &&
          t.status === "COMPLETED" &&
          weekStart(t.completedAt) === w,
      ).length,
    }));
    const recent = trend.slice(-4);
    const finished = tasks.filter(
      (t) => t.status === "COMPLETED" || t.status === "FAILED",
    );
    const dep = tasks.filter(
      (t) =>
        t.type === "DEPLOYMENT" &&
        (t.status === "COMPLETED" || t.status === "FAILED"),
    );
    const alerts = this.ports
      .alerts()
      .filter(
        (a) =>
          a.projectId === projectId &&
          (a.status === "OPEN" ||
            a.status === "ACKNOWLEDGED" ||
            a.status === ""),
      );
    const u = this.usage(access, projectId);
    const completedRecently = recent.reduce((n, w) => n + w.completed, 0);
    return {
      projectId,
      completionTrend: trend,
      velocityPerWeek:
        finished.length >= 3 ? completedRecently / recent.length : null,
      blockers: tasks
        .filter((t) => t.status === "BLOCKED")
        .slice(0, 10)
        .map((t) => ({
          taskId: t.taskId,
          title: t.title,
          reason: t.blockedReason ?? t.blockKind ?? "blocked",
        })),
      defectRate: rate(
        tasks.filter((t) => t.status === "FAILED" || t.corrections > 0).length,
        finished.length,
      ),
      deploymentSuccess: rate(
        dep.filter((t) => t.status === "COMPLETED").length,
        dep.length,
      ),
      securityIssues: {
        open: alerts.length,
        highOrCritical: alerts.filter(
          (a) => a.severity === "HIGH" || a.severity === "CRITICAL",
        ).length,
      },
      cost: {
        usd: usd(u),
        tokens: u.reduce((n, x) => n + tokensOf(x), 0),
        unpriced: u.filter((x) => !x.cost.priced).length,
      },
      quality: quality(finished.length),
    };
  }

  /* ----------------------------------- cost ----------------------------------- */

  cost(access: Access, projectId?: string): CostIntelligence {
    const u = this.usage(access, projectId);
    const taskRun = new Map<string, string>();
    for (const r of this.ports.runs())
      for (const t of r.tasks) taskRun.set(t.taskId, r.runId);
    const group = <K extends string>(
      key: (x: UsageRecord) => K | undefined,
    ) => {
      const m = new Map<K, UsageRecord[]>();
      for (const x of u) {
        const k = key(x);
        if (k !== undefined) m.set(k, [...(m.get(k) ?? []), x]);
      }
      return m;
    };
    const sumTokens = (l: UsageRecord[]) =>
      l.reduce((n, x) => n + tokensOf(x), 0);
    const perTaskTokens = [...group((x) => x.taskId).values()].map(sumTokens);
    const weeks = lastWeeks(this.ports.clock(), 8);
    return {
      totalTokens: sumTokens(u),
      pricedUsd: usd(u),
      unpricedCalls: u.filter((x) => !x.cost.priced).length,
      calls: u.length,
      byProject: [...group((x) => x.projectId)]
        .map(([p, l]) => ({
          projectId: p,
          tokens: sumTokens(l),
          usd: usd(l),
          unpriced: l.filter((x) => !x.cost.priced).length,
        }))
        .sort((a, b) => b.tokens - a.tokens),
      byModel: [...group((x) => x.model)]
        .map(([model, l]) => ({
          model,
          provider: l[0]!.provider,
          calls: l.length,
          tokens: sumTokens(l),
          usd: usd(l),
          unpriced: l.filter((x) => !x.cost.priced).length,
        }))
        .sort((a, b) => b.tokens - a.tokens),
      byAgent: [...group((x) => x.agentId)]
        .map(([agentId, l]) => ({ agentId, tokens: sumTokens(l), usd: usd(l) }))
        .sort((a, b) => b.tokens - a.tokens),
      byWorkflow: [
        ...group((x) => (x.taskId ? taskRun.get(x.taskId) : undefined)),
      ]
        .map(([runId, l]) => ({
          runId,
          projectId: l[0]!.projectId,
          tokens: sumTokens(l),
          usd: usd(l),
        }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 20),
      perTask: {
        average: mean(perTaskTokens),
        sampled: perTaskTokens.length,
        unit: "tokens",
      },
      weekly: weeks.map((w) => {
        const l = u.filter((x) => weekStart(x.createdAt) === w);
        return { weekStart: w, tokens: sumTokens(l), usd: usd(l) };
      }),
      note: "Cost is shown only where the ledger could price the call; unpriced calls are counted separately and never estimated. Provider keys are never part of this data.",
    };
  }

  /* ------------------------------- bottlenecks ------------------------------- */

  bottlenecks(access: Access): Bottleneck[] {
    const out: Bottleneck[] = [];
    const pairs = this.tasks(access);
    const byKey = new Map<string, { n: number; projects: Set<string> }>();
    for (const { task, run } of pairs)
      if (task.failures.length > 0) {
        const k = `${task.type}: ${task.title}`;
        const c = byKey.get(k) ?? { n: 0, projects: new Set() };
        c.n += task.failures.length;
        c.projects.add(run.projectId);
        byKey.set(k, c);
      }
    for (const [k, c] of byKey)
      if (c.n >= 2)
        out.push({
          kind: "REPEATED_FAILURE",
          subject: k,
          severity: c.n >= 4 ? "SERIOUS" : "WARNING",
          evidence: `${c.n} failures across ${c.projects.size} project(s)`,
          ...(c.projects.size === 1 ? { projectId: [...c.projects][0]! } : {}),
        });
    const now = this.ports.now();
    const pending = this.ports
      .approvals()
      .filter((a) => a.status === "pending");
    const old = pending.filter(
      (a) => now - Date.parse(a.requestedAt) > 24 * 3600_000,
    );
    if (old.length > 0)
      out.push({
        kind: "APPROVAL_QUEUE",
        subject: "approvals",
        severity: old.length >= 3 ? "SERIOUS" : "WARNING",
        evidence: `${old.length} approval(s) have waited more than 24 hours (${pending.length} pending in total)`,
      });
    const load = new Map<string, number>();
    for (const { task } of pairs)
      if (task.assignedAgent && !TERMINAL_TASK.has(task.status))
        load.set(
          task.assignedAgent.agentId,
          (load.get(task.assignedAgent.agentId) ?? 0) + 1,
        );
    const loads = [...load.values()];
    const avg = mean(loads);
    for (const [agent, n] of load)
      if (loads.length >= 2 && avg && n >= 4 && n >= avg * 2)
        out.push({
          kind: "OVERLOADED_AGENT",
          subject: agent,
          severity: "WARNING",
          evidence: `${n} open tasks versus an average of ${avg.toFixed(1)} per agent`,
        });
    const wf = this.workflows(access);
    if (wf.medianDurationMs) {
      for (const run of this.runs(access)) {
        const d = ms(run.createdAt, run.updatedAt);
        const s = this.ports.deriveRunStatus(run);
        if (
          d &&
          (s === "COMPLETED" || s === "FAILED") &&
          d > wf.medianDurationMs * 3 &&
          wf.runs >= 5
        )
          out.push({
            kind: "SLOW_WORKFLOW",
            subject: run.objective.slice(0, 80),
            projectId: run.projectId,
            severity: "INFO",
            evidence: `took ${Math.round(d / 60000)} min versus a median of ${Math.round(wf.medianDurationMs / 60000)} min`,
          });
      }
    }
    const tool = this.ports.toolActivity().filter((t) => access(t.projectId));
    const byConn = new Map<string, { fail: number; total: number }>();
    for (const t of tool) {
      const k = t.connectorId ?? t.capability;
      const c = byConn.get(k) ?? { fail: 0, total: 0 };
      c.total++;
      if (t.outcome === "FAILED" || t.outcome === "BLOCKED") c.fail++;
      byConn.set(k, c);
    }
    for (const [k, c] of byConn)
      if (c.fail >= 3 && c.fail / c.total >= 0.3)
        out.push({
          kind: "UNAVAILABLE_TOOL",
          subject: k,
          severity: "WARNING",
          evidence: `${c.fail} of ${c.total} calls failed or were blocked`,
        });
    for (const h of this.ports.connectorHealth?.() ?? [])
      if (h.status === "ERROR")
        out.push({
          kind: "UNAVAILABLE_TOOL",
          subject: h.connectorId,
          severity: "SERIOUS",
          evidence: "the connector is in ERROR",
        });
    for (const [p, list] of groupBy(
      pairs.filter((x) => x.task.type === "DEPLOYMENT"),
      (x) => x.run.projectId,
    )) {
      const failed = list.filter((x) => x.task.status === "FAILED").length;
      if (failed >= 2)
        out.push({
          kind: "DEPLOYMENT",
          subject: p,
          projectId: p,
          severity: "SERIOUS",
          evidence: `${failed} of ${list.length} deployment tasks failed`,
        });
    }
    const actions = new Map<string, number>();
    for (const a of this.ports.approvals())
      if (a.status === "approved")
        actions.set(a.action, (actions.get(a.action) ?? 0) + 1);
    for (const [a, n] of actions)
      if (n >= 5)
        out.push({
          kind: "REPEATED_MANUAL_STEP",
          subject: a,
          severity: "INFO",
          evidence: `approved ${n} times by hand`,
        });
    return out.sort(
      (a, b) =>
        ({ SERIOUS: 0, WARNING: 1, INFO: 2 })[a.severity] -
        { SERIOUS: 0, WARNING: 1, INFO: 2 }[b.severity],
    );
  }

  /* -------------------------------- predictions -------------------------------- */

  predictions(access: Access): Prediction[] {
    const out: Prediction[] = [];
    const label = (rate: number, n: number): Prediction["label"] =>
      n < 5
        ? "LOW_CONFIDENCE"
        : rate >= 0.5
          ? "HIGH_RISK"
          : rate >= 0.25
            ? "LIKELY"
            : "POSSIBLE";
    for (const [projectId, runs] of groupBy(
      this.runs(access),
      (r) => r.projectId,
    )) {
      const done = runs.filter((r) =>
        ["COMPLETED", "FAILED"].includes(this.ports.deriveRunStatus(r)),
      );
      const failed = done.filter(
        (r) => this.ports.deriveRunStatus(r) === "FAILED",
      ).length;
      if (done.length === 0) continue;
      const [lo, hi] = wilson(failed, done.length);
      out.push({
        kind: "WORKFLOW_FAILURE",
        subject: projectId,
        label: label(failed / done.length, done.length),
        range: [round(lo), round(hi)],
        unit: "probability",
        statement: `The next workflow in ${projectId} may fail with a probability between ${pct(lo)} and ${pct(hi)}.`,
        basis: `${failed} of the last ${done.length} finished workflows failed`,
        sample: done.length,
      });
      const dep = runs
        .flatMap((r) => r.tasks)
        .filter(
          (t) =>
            t.type === "DEPLOYMENT" &&
            (t.status === "COMPLETED" || t.status === "FAILED"),
        );
      if (dep.length > 0) {
        const df = dep.filter((t) => t.status === "FAILED").length;
        const [dl, dh] = wilson(df, dep.length);
        out.push({
          kind: "DEPLOYMENT_RISK",
          subject: projectId,
          label: label(df / dep.length, dep.length),
          range: [round(dl), round(dh)],
          unit: "probability",
          statement: `A deployment of ${projectId} may fail with a probability between ${pct(dl)} and ${pct(dh)}.`,
          basis: `${df} of ${dep.length} deployment tasks failed`,
          sample: dep.length,
        });
      }
      // recurring failure
      const sig = new Map<string, number>();
      for (const t of runs.flatMap((r) => r.tasks))
        for (const f of t.failures)
          sig.set(
            normalizeError(f.error),
            (sig.get(normalizeError(f.error)) ?? 0) + 1,
          );
      for (const [s, n] of sig)
        if (n >= 3)
          out.push({
            kind: "RECURRING_FAILURE",
            subject: projectId,
            label: n >= 5 ? "LIKELY" : "POSSIBLE",
            statement: `The failure "${s}" has occurred ${n} times in ${projectId} and may occur again.`,
            basis: `${n} occurrences of the same normalised error`,
            sample: n,
          });
    }
    // cost trend (portfolio of accessible projects)
    const weekly = this.cost(access).weekly;
    const series = weekly.map((w) => w.tokens);
    const active = series.filter((x) => x > 0).length;
    const trend = linearTrend(series);
    if (trend && active >= 3) {
      const next = Math.max(0, trend.intercept + trend.slope * series.length);
      const spread = trend.residual * 1.96;
      out.push({
        kind: "COST_TREND",
        subject: "AI usage",
        label:
          active < 5
            ? "LOW_CONFIDENCE"
            : trend.slope > 0
              ? "LIKELY"
              : "POSSIBLE",
        range: [
          Math.max(0, Math.round(next - spread)),
          Math.round(next + spread),
        ],
        unit: "tokens next week",
        statement: `AI usage is ${trend.slope > 0 ? "rising" : trend.slope < 0 ? "falling" : "flat"}; next week may land between ${Math.max(0, Math.round(next - spread)).toLocaleString("en-US")} and ${Math.round(next + spread).toLocaleString("en-US")} tokens.`,
        basis: `linear trend over ${series.length} weeks (${active} with usage)`,
        sample: active,
      });
    }
    // resource bottleneck
    const load = new Map<string, number>();
    for (const { task } of this.tasks(access))
      if (task.assignedAgent && !TERMINAL_TASK.has(task.status))
        load.set(
          task.assignedAgent.agentId,
          (load.get(task.assignedAgent.agentId) ?? 0) + 1,
        );
    const top = [...load].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 4)
      out.push({
        kind: "RESOURCE_BOTTLENECK",
        subject: top[0],
        label: top[1] >= 8 ? "LIKELY" : "POSSIBLE",
        statement: `Agent ${top[0]} has ${top[1]} open tasks and may become a bottleneck.`,
        basis: "current open task count",
        sample: top[1],
      });
    return out;
  }

  /* ---------------------------------- overview ---------------------------------- */

  overview(access: Access): AnalyticsOverview {
    const wf = this.workflows(access);
    const aut = this.ports.autonomy().filter((i) => access(i.projectId));
    return {
      generatedAt: this.ports.clock(),
      scope: {
        projects: new Set(
          this.ports
            .runs()
            .filter((r) => access(r.projectId))
            .map((r) => r.projectId),
        ).size,
      },
      workflows: wf,
      cost: this.cost(access),
      topAgents: this.agents(access).slice(0, 5),
      bottlenecks: this.bottlenecks(access).slice(0, 10),
      predictions: this.predictions(access),
      openRecommendations: this.recs
        .list()
        .filter(
          (r) => r.status === "OPEN" && (!r.projectId || access(r.projectId)),
        ).length,
      autonomy: {
        workflows: aut.length,
        completed: aut.filter((i) => i.state === "COMPLETED").length,
        escalated: aut.filter((i) => i.state === "ESCALATED").length,
        failed: aut.filter((i) => i.state === "FAILED").length,
      },
      quality: wf.quality,
    };
  }

  /* ------------------------------- recommendations ------------------------------- */

  listRecommendations(
    access: Access,
    status?: Recommendation["status"],
  ): Recommendation[] {
    return this.recs
      .list()
      .filter(
        (r) =>
          (!r.projectId || access(r.projectId)) &&
          (!status || r.status === status),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  recommendation(id: string, access: Access): Recommendation {
    const r = this.recs.findById(id);
    if (!r || (r.projectId && !access(r.projectId)))
      throw new AnalyticsError("not_found", "recommendation not found");
    return r;
  }

  /** Candidate recommendations derived from the data right now. */
  private candidates(
    access: Access,
  ): Omit<
    Recommendation,
    | "id"
    | "recommendationId"
    | "status"
    | "requiresApproval"
    | "createdAt"
    | "updatedAt"
  >[] {
    const out: ReturnType<AnalyticsIntelligence["candidates"]> = [];
    const pairs = this.tasks(access);
    const usage = this.usage(access);
    const taskById = new Map(pairs.map((p) => [p.task.taskId, p.task]));

    // 1. cheaper model for low-complexity work
    const priced = Object.entries(MODEL_PRICES);
    const byModel = new Map<string, UsageRecord[]>();
    for (const u of usage)
      if (
        u.cost.priced &&
        u.taskId &&
        LOW_COMPLEXITY.has(taskById.get(u.taskId)?.type ?? "")
      )
        byModel.set(u.model, [...(byModel.get(u.model) ?? []), u]);
    for (const [model, list] of byModel) {
      const cur = MODEL_PRICES[model.toLowerCase()];
      if (!cur || list.length < 5) continue;
      const cheaper = priced
        .filter(([, p]) => p.inputPerMillionUsd < cur.inputPerMillionUsd)
        .sort((a, b) => a[1].inputPerMillionUsd - b[1].inputPerMillionUsd)[0];
      if (!cheaper) continue;
      const inTok = list.reduce((n, u) => n + (u.inputTokens ?? 0), 0);
      const outTok = list.reduce((n, u) => n + (u.outputTokens ?? 0), 0);
      const saving =
        (inTok / 1e6) *
          (cur.inputPerMillionUsd - cheaper[1].inputPerMillionUsd) +
        (outTok / 1e6) *
          (cur.outputPerMillionUsd - cheaper[1].outputPerMillionUsd);
      if (saving <= 0) continue;
      out.push({
        area: "MODEL",
        observation: `${list.length} low-complexity tasks (documentation, analysis, research) ran on ${model}.`,
        evidence: [
          `${inTok.toLocaleString("en-US")} input and ${outTok.toLocaleString("en-US")} output tokens`,
          `${model} costs $${cur.inputPerMillionUsd}/$${cur.outputPerMillionUsd} per million in/out; ${cheaper[0]} costs $${cheaper[1].inputPerMillionUsd}/$${cheaper[1].outputPerMillionUsd}`,
        ],
        recommendation: `Let the Model Router consider ${cheaper[0]} for these task types.`,
        tradeoff: `Estimated saving of about $${saving.toFixed(2)} on this history. The cheaper model may be less capable; verify output quality on a sample before adopting, and keep ${model} for complex or security-sensitive tasks.`,
        expectedBenefit: `~$${saving.toFixed(2)} less spend for the same volume`,
        confidence: quality(list.length, 20),
        metric: {
          name: "tokens_per_task",
          baseline: this.tokensPerTask(access),
          unit: "tokens",
          lowerIsBetter: true,
        },
      });
    }
    // 2. oversized context
    const big = pairs.filter(
      (p) => (p.task.estimate?.inputTokens ?? 0) > 12000,
    );
    if (big.length >= 3)
      out.push({
        area: "COST",
        observation: `${big.length} tasks started with more than 12,000 input tokens of context.`,
        evidence: big
          .slice(0, 3)
          .map(
            (p) =>
              `${p.task.title}: ~${p.task.estimate!.inputTokens.toLocaleString("en-US")} tokens`,
          ),
        recommendation:
          "Narrow the relevant-files list and context for these task types so only what the task needs is loaded.",
        tradeoff:
          "Less context lowers cost but can make an agent miss a constraint. Keep security and project constraints mandatory.",
        confidence: quality(big.length, 8),
        metric: {
          name: "tokens_per_task",
          baseline: this.tokensPerTask(access),
          unit: "tokens",
          lowerIsBetter: true,
        },
      });
    // 3. retry waste
    const retryTasks = new Set(
      pairs.filter((p) => p.task.attempts > 1).map((p) => p.task.taskId),
    );
    const retryTokens = usage
      .filter((u) => u.taskId && retryTasks.has(u.taskId))
      .reduce((n, u) => n + tokensOf(u), 0);
    const allTokens = usage.reduce((n, u) => n + tokensOf(u), 0);
    if (
      allTokens > 0 &&
      retryTokens / allTokens >= 0.15 &&
      retryTasks.size >= 3
    )
      out.push({
        area: "WORKFLOW",
        observation: `${Math.round((retryTokens / allTokens) * 100)}% of AI tokens went to tasks that had to be retried.`,
        evidence: [
          `${retryTasks.size} retried tasks`,
          `${retryTokens.toLocaleString("en-US")} of ${allTokens.toLocaleString("en-US")} tokens`,
        ],
        recommendation:
          "Find why these tasks fail first time (unclear acceptance criteria, missing context) and fix the prompt or workflow rather than relying on retries.",
        tradeoff:
          "Takes owner time to investigate; reducing the retry limit instead would lower cost but also lower the success rate.",
        confidence: quality(retryTasks.size, 8),
        metric: {
          name: "retry_token_share",
          baseline: retryTokens / allTokens,
          unit: "share",
          lowerIsBetter: true,
        },
      });
    // 4. routing: better agent for a task type
    const stats = new Map<string, Map<string, { ok: number; bad: number }>>();
    for (const { task } of pairs) {
      if (
        !task.assignedAgent ||
        (task.status !== "COMPLETED" && task.status !== "FAILED")
      )
        continue;
      const m = stats.get(task.type) ?? new Map();
      const s = m.get(task.assignedAgent.agentId) ?? { ok: 0, bad: 0 };
      if (task.status === "COMPLETED") s.ok++;
      else s.bad++;
      m.set(task.assignedAgent.agentId, s);
      stats.set(task.type, m);
    }
    for (const [type, m] of stats) {
      const rows = [...m]
        .map(([agentId, s]) => ({
          agentId,
          n: s.ok + s.bad,
          fail: s.bad / (s.ok + s.bad),
        }))
        .filter((r) => r.n >= 5);
      const worst = rows.sort((a, b) => b.fail - a.fail)[0];
      const best = [...rows].sort((a, b) => a.fail - b.fail)[0];
      if (
        worst &&
        best &&
        worst.agentId !== best.agentId &&
        worst.fail >= 0.4 &&
        worst.fail - best.fail >= 0.3
      )
        out.push({
          area: "ROUTING",
          observation: `Agent ${worst.agentId} fails ${Math.round(worst.fail * 100)}% of ${type} tasks; ${best.agentId} fails ${Math.round(best.fail * 100)}%.`,
          evidence: [
            `${worst.agentId}: ${worst.n} finished ${type} tasks`,
            `${best.agentId}: ${best.n} finished ${type} tasks`,
          ],
          recommendation: `Route ${type} tasks to ${best.agentId} and add extra validation before deployment for ${worst.agentId}.`,
          tradeoff: `${best.agentId} would carry more load, which could make it a bottleneck. Small samples can mislead; the Agent Router still applies capability and trust checks.`,
          confidence: quality(Math.min(worst.n, best.n), 10),
          metric: {
            name: `agent_failure_rate:${worst.agentId}:${type}`,
            baseline: worst.fail,
            unit: "rate",
            lowerIsBetter: true,
          },
        });
    }
    // 5. testing before deployment
    for (const [p, list] of groupBy(pairs, (x) => x.run.projectId)) {
      const testsFailed = list.filter(
        (x) => x.task.type === "TEST" && x.task.status === "FAILED",
      ).length;
      const depFailed = list.filter(
        (x) => x.task.type === "DEPLOYMENT" && x.task.status === "FAILED",
      ).length;
      if (
        depFailed >= 2 ||
        (testsFailed >= 2 && list.some((x) => x.task.type === "DEPLOYMENT"))
      )
        out.push({
          area: "DEPLOYMENT",
          projectId: p,
          observation: `${p} has ${depFailed} failed deployment and ${testsFailed} failed test task(s).`,
          evidence: [
            `${depFailed} failed deployment tasks`,
            `${testsFailed} failed test tasks`,
          ],
          recommendation:
            "Require a verified passing test task and a staging deployment before any production deployment, and review the deployment checklist.",
          tradeoff: "Slows each release by one validation stage.",
          confidence: quality(depFailed + testsFailed, 4),
          metric: {
            name: `project_failed_task_rate:${p}`,
            baseline: this.failedRate(access, p),
            unit: "rate",
            lowerIsBetter: true,
          },
        });
      const corrected = list.filter((x) => x.task.corrections >= 2);
      if (corrected.length >= 2)
        out.push({
          area: "PROMPT",
          projectId: p,
          observation: `${corrected.length} tasks in ${p} were sent back for correction at least twice.`,
          evidence: corrected
            .slice(0, 3)
            .map((x) => `${x.task.title}: ${x.task.corrections} corrections`),
          recommendation:
            "Tighten the acceptance criteria and constraints in the generated prompt for these task types.",
          tradeoff:
            "Longer prompts cost more tokens; the saving comes from fewer correction rounds.",
          confidence: quality(corrected.length, 5),
          metric: {
            name: `project_failed_task_rate:${p}`,
            baseline: this.failedRate(access, p),
            unit: "rate",
            lowerIsBetter: true,
          },
        });
    }
    // 6. repeated manual approvals
    const approved = new Map<string, number>();
    const rejected = new Set<string>();
    for (const a of this.ports.approvals()) {
      if (a.status === "approved")
        approved.set(a.action, (approved.get(a.action) ?? 0) + 1);
      if (a.status === "rejected") rejected.add(a.action);
    }
    for (const [action, n] of approved)
      if (n >= 5 && !rejected.has(action))
        out.push({
          area: "WORKFLOW",
          observation: `"${action}" was approved ${n} times and never rejected.`,
          evidence: [`${n} approvals`],
          recommendation:
            "Review whether a narrower standing policy fits this action, instead of approving it by hand each time.",
          tradeoff:
            "Reduces owner effort but also reduces oversight. Never apply this to high-risk or destructive actions.",
          confidence: quality(n, 10),
        });
    // 7. unreliable tool
    for (const [k, list] of groupBy(
      this.ports.toolActivity().filter((t) => access(t.projectId)),
      (t) => t.connectorId ?? t.capability,
    )) {
      const fail = list.filter((t) => t.outcome === "FAILED").length;
      if (fail >= 3 && fail / list.length >= 0.3)
        out.push({
          area: "TOOL",
          observation: `${k} failed ${fail} of ${list.length} calls.`,
          evidence: [`${fail} failed calls`],
          recommendation:
            "Check the connector's credentials, scopes and health; agents lose time on the failing calls.",
          tradeoff: "None beyond the time to fix the connection.",
          confidence: quality(list.length, 8),
        });
    }
    return out;
  }

  private tokensPerTask(access: Access): number | null {
    const perTask = new Map<string, number>();
    for (const u of this.usage(access))
      if (u.taskId)
        perTask.set(u.taskId, (perTask.get(u.taskId) ?? 0) + tokensOf(u));
    return mean([...perTask.values()]);
  }
  private failedRate(access: Access, projectId: string): number | null {
    const t = this.tasks(access, projectId)
      .map((p) => p.task)
      .filter((x) => x.status === "COMPLETED" || x.status === "FAILED");
    return t.length
      ? t.filter((x) => x.status === "FAILED").length / t.length
      : null;
  }
  private retryShare(access: Access): number | null {
    const retry = new Set(
      this.tasks(access)
        .filter((p) => p.task.attempts > 1)
        .map((p) => p.task.taskId),
    );
    const all = this.usage(access);
    const total = all.reduce((n, u) => n + tokensOf(u), 0);
    return total > 0
      ? all
          .filter((u) => u.taskId && retry.has(u.taskId))
          .reduce((n, u) => n + tokensOf(u), 0) / total
      : null;
  }
  private metricValue(name: string, access: Access): number | null {
    if (name === "tokens_per_task") return this.tokensPerTask(access);
    if (name === "retry_token_share") return this.retryShare(access);
    if (name.startsWith("project_failed_task_rate:"))
      return this.failedRate(access, name.split(":")[1]!);
    if (name.startsWith("agent_failure_rate:")) {
      const [, agent, type] = name.split(":");
      const t = this.tasks(access)
        .map((p) => p.task)
        .filter(
          (x) =>
            x.assignedAgent?.agentId === agent &&
            x.type === type &&
            (x.status === "COMPLETED" || x.status === "FAILED"),
        );
      return t.length
        ? t.filter((x) => x.status === "FAILED").length / t.length
        : null;
    }
    return null;
  }

  /** OBSERVE → ANALYZE → IDENTIFY → PREDICT → RECOMMEND. Idempotent: the same finding keeps one record. */
  refreshRecommendations(access: Access, by: string): Recommendation[] {
    const now = this.ports.clock();
    const out: Recommendation[] = [];
    for (const c of this.candidates(access)) {
      const recommendationId = `rec-${hash(`${c.area}|${c.projectId ?? ""}|${c.observation.replace(/\d+/g, "N")}`)}`;
      const existing = this.recs.findById(recommendationId);
      if (existing && existing.status !== "OPEN") {
        out.push(existing);
        continue;
      }
      const rec: Recommendation = {
        ...c,
        id: recommendationId,
        recommendationId,
        status: "OPEN",
        requiresApproval: true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      this.recs.upsert(rec);
      out.push(rec);
    }
    this.led("recommendations_refreshed", by, { count: out.length });
    return out;
  }

  decide(
    id: string,
    decision: "APPROVED" | "REJECTED",
    by: string,
    access: Access,
  ): Recommendation {
    const r = this.recommendation(id, access);
    if (r.status !== "OPEN")
      throw new AnalyticsError(
        "invalid_state",
        `the recommendation is already ${r.status.toLowerCase()}`,
      );
    const next: Recommendation = {
      ...r,
      status: decision,
      decidedBy: by,
      decidedAt: this.ports.clock(),
      updatedAt: this.ports.clock(),
    };
    this.recs.upsert(next);
    this.led("recommendation_decided", by, { id, decision });
    return next;
  }

  /** The owner records that they applied it through the normal governed channel; a fresh baseline is captured. */
  markApplied(
    id: string,
    note: string,
    by: string,
    access: Access,
  ): Recommendation {
    const r = this.recommendation(id, access);
    if (r.status !== "APPROVED")
      throw new AnalyticsError(
        "invalid_state",
        "only an approved recommendation can be marked applied",
      );
    const baseline = r.metric ? this.metricValue(r.metric.name, access) : null;
    const next: Recommendation = {
      ...r,
      status: "APPLIED",
      appliedBy: by,
      appliedAt: this.ports.clock(),
      appliedNote: note.slice(0, 300),
      ...(r.metric ? { metric: { ...r.metric, baseline } } : {}),
      updatedAt: this.ports.clock(),
    };
    this.recs.upsert(next);
    this.led("recommendation_applied", by, { id });
    return next;
  }

  /** MEASURE: compare the metric now with the baseline taken when it was applied. */
  measure(id: string, access: Access): Recommendation {
    const r = this.recommendation(id, access);
    if (r.status !== "APPLIED" && r.status !== "MEASURED")
      throw new AnalyticsError(
        "invalid_state",
        "measure a recommendation after it has been applied",
      );
    if (!r.metric)
      throw new AnalyticsError(
        "invalid_state",
        "this recommendation has no measurable metric",
      );
    const value = this.metricValue(r.metric.name, access);
    const base = r.metric.baseline;
    let verdict: NonNullable<Recommendation["measurement"]>["verdict"] =
      "NO_DATA";
    let delta: number | null = null;
    if (value !== null && base !== null) {
      delta = value - base;
      const rel =
        base === 0 ? Math.abs(delta) : Math.abs(delta) / Math.abs(base);
      verdict =
        rel < 0.05
          ? "NO_CHANGE"
          : delta < 0 === r.metric.lowerIsBetter
            ? "IMPROVED"
            : "WORSE";
    }
    const next: Recommendation = {
      ...r,
      status: "MEASURED",
      measurement: { measuredAt: this.ports.clock(), value, verdict, delta },
      updatedAt: this.ports.clock(),
    };
    this.recs.upsert(next);
    this.led("recommendation_measured", "analytics", { id, verdict });
    return next;
  }

  /* ---------------------------------- what-if ---------------------------------- */

  /** Reads state, writes nothing. */
  whatIf(scenario: WhatIfScenario, access: Access): WhatIfResult {
    const base = { scenario, simulated: true as const };
    const pairs = this.tasks(access);
    const open = (p: string) =>
      pairs.filter(
        (x) => x.run.projectId === p && !TERMINAL_TASK.has(x.task.status),
      );
    const agentsOf = (p: string) =>
      new Set(
        pairs
          .filter((x) => x.run.projectId === p && x.task.assignedAgent)
          .map((x) => x.task.assignedAgent!.agentId),
      );
    const ensure = (p: string) => {
      if (
        !access(p) ||
        (!pairs.concat().some((x) => x.run.projectId === p) &&
          !this.ports.runs().some((r) => r.projectId === p))
      )
        throw new AnalyticsError(
          "not_found",
          `project "${p}" not found or has no recorded activity`,
        );
    };
    if (scenario.kind === "SWITCH_MODEL") {
      const from = MODEL_PRICES[scenario.fromModel.toLowerCase()];
      const to = MODEL_PRICES[scenario.toModel.toLowerCase()];
      const list = this.usage(access).filter(
        (u) => u.model === scenario.fromModel,
      );
      const inTok = list.reduce((n, u) => n + (u.inputTokens ?? 0), 0);
      const outTok = list.reduce((n, u) => n + (u.outputTokens ?? 0), 0);
      if (!from || !to || list.length === 0)
        return {
          ...base,
          summary: "Not enough priced data to estimate the change.",
          impacts: [
            {
              area: "COST",
              statement:
                !from || !to
                  ? "One of the models has no price entry, so the cost impact cannot be computed."
                  : `No usage of ${scenario.fromModel} is recorded.`,
            },
          ],
          assumptions: ["Only priced models can be compared."],
          confidence: "NO_DATA",
        };
      const delta =
        (inTok / 1e6) * (to.inputPerMillionUsd - from.inputPerMillionUsd) +
        (outTok / 1e6) * (to.outputPerMillionUsd - from.outputPerMillionUsd);
      return {
        ...base,
        summary: `Re-running the recorded ${scenario.fromModel} usage on ${scenario.toModel} would change cost by about ${delta >= 0 ? "+" : "−"}$${Math.abs(delta).toFixed(2)}.`,
        impacts: [
          {
            area: "COST",
            statement: "Estimated change in spend for the same token volume.",
            value: Number(delta.toFixed(4)),
            unit: "USD",
          },
        ],
        assumptions: [
          "Same token counts on both models.",
          "Output quality, latency and the Model Router's capability checks are not modelled.",
        ],
        confidence: quality(list.length, 20),
      };
    }
    if (scenario.kind === "PAUSE_PROJECT") {
      ensure(scenario.projectId);
      const o = open(scenario.projectId);
      const weeks = lastWeeks(this.ports.clock(), 4);
      const u = this.usage(access, scenario.projectId).filter((x) =>
        weeks.includes(weekStart(x.createdAt)),
      );
      const weekly = u.reduce((n, x) => n + tokensOf(x), 0) / 4;
      const dependents = this.ports.dependentsOf?.(scenario.projectId) ?? [];
      return {
        ...base,
        summary: `Pausing ${scenario.projectId} would hold ${o.length} open task(s) and free ${agentsOf(scenario.projectId).size} agent(s).`,
        impacts: [
          {
            area: "RESOURCES",
            statement: `${o.length} open task(s) stop progressing.`,
            value: o.length,
            unit: "tasks",
          },
          {
            area: "AGENTS",
            statement: `Agents involved: ${[...agentsOf(scenario.projectId)].join(", ") || "none"}.`,
          },
          {
            area: "COST",
            statement: "Recent weekly AI usage that would stop (tokens).",
            value: Math.round(weekly),
            unit: "tokens/week",
          },
          {
            area: "DEPENDENCIES",
            statement: dependents.length
              ? `Projects depending on it: ${dependents.join(", ")}.`
              : "No project depends on it.",
          },
        ],
        assumptions: ["Weekly usage is the average of the last 4 weeks."],
        confidence: quality(u.length, 10),
      };
    }
    ensure(scenario.projectId);
    ensure(scenario.above);
    const shared = [...agentsOf(scenario.projectId)].filter((a) =>
      agentsOf(scenario.above).has(a),
    );
    const aOpen = open(scenario.projectId).length;
    const bOpen = open(scenario.above).length;
    const weekly = (p: string) => {
      const done = pairs.filter(
        (x) =>
          x.run.projectId === p &&
          x.task.status === "COMPLETED" &&
          x.task.completedAt &&
          lastWeeks(this.ports.clock(), 4).includes(
            weekStart(x.task.completedAt),
          ),
      ).length;
      return done / 4;
    };
    const v = weekly(scenario.projectId);
    const delayWeeks = shared.length > 0 && v > 0 ? aOpen / v : null;
    return {
      ...base,
      summary:
        shared.length === 0
          ? `${scenario.projectId} and ${scenario.above} use different agents, so prioritising one barely affects the other.`
          : `${shared.length} shared agent(s) would serve ${scenario.projectId} first.`,
      impacts: [
        {
          area: "AGENTS",
          statement: shared.length
            ? `Shared agents: ${shared.join(", ")}.`
            : "No agent is shared.",
        },
        {
          area: "RESOURCES",
          statement: `${scenario.projectId} has ${aOpen} open task(s); ${scenario.above} has ${bOpen}.`,
        },
        {
          area: "DELAY",
          statement:
            delayWeeks === null
              ? "A delay cannot be estimated: no shared agent or no recent throughput."
              : `Work for ${scenario.above} on shared agents could wait about ${delayWeeks.toFixed(1)} week(s) at ${scenario.projectId}'s recent pace of ${v.toFixed(1)} tasks/week.`,
          ...(delayWeeks !== null
            ? { value: Number(delayWeeks.toFixed(1)), unit: "weeks" }
            : {}),
        },
        {
          area: "DEPENDENCIES",
          statement: (this.ports.dependentsOf?.(scenario.above) ?? []).length
            ? `Projects depending on ${scenario.above}: ${(this.ports.dependentsOf?.(scenario.above) ?? []).join(", ")}.`
            : `No project depends on ${scenario.above}.`,
        },
      ],
      assumptions: [
        "Throughput is the average of the last 4 weeks.",
        "All open tasks on shared agents are served in order; real routing also weighs capability and trust.",
      ],
      confidence: quality(Math.round(v * 4), 8),
    };
  }

  /* --------------------------------- learning --------------------------------- */

  listLessons(access: Access): Lesson[] {
    return this.lessonRepo
      .list()
      .filter((l) => !l.projectId || access(l.projectId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** LEARN: record durable lessons once; storage in Knowledge goes through its own write policy. */
  captureLessons(access: Access, by: string): Lesson[] {
    const created: Lesson[] = [];
    const add = (
      l: Omit<Lesson, "id" | "lessonId" | "createdAt" | "storedInKnowledge">,
    ) => {
      const lessonId = `les-${hash(l.key)}`;
      if (this.lessonRepo.findById(lessonId)) return;
      const lesson: Lesson = {
        ...l,
        id: lessonId,
        lessonId,
        storedInKnowledge: false,
        createdAt: this.ports.clock(),
      };
      try {
        lesson.storedInKnowledge = this.ports.remember?.(lesson) === true;
      } catch {
        lesson.storedInKnowledge = false;
      }
      this.lessonRepo.upsert(lesson);
      created.push(lesson);
    };
    const pairs = this.tasks(access);
    const errors = new Map<
      string,
      { n: number; project: Set<string>; sample: string }
    >();
    for (const { task, run } of pairs)
      for (const f of task.failures) {
        const k = normalizeError(f.error);
        const c = errors.get(k) ?? {
          n: 0,
          project: new Set(),
          sample: f.error.slice(0, 160),
        };
        c.n++;
        c.project.add(run.projectId);
        errors.set(k, c);
      }
    for (const [k, c] of errors)
      if (c.n >= 3) {
        const only = c.project.size === 1 ? [...c.project][0] : undefined;
        add({
          kind: "COMMON_ERROR",
          ...(only ? { projectId: only } : {}),
          title: `Recurring error (${c.n}×)`,
          content: `The error "${c.sample}" has occurred ${c.n} times. Check for this cause before retrying.`,
          evidence: [`${c.n} occurrences`, `${c.project.size} project(s)`],
          key: `error:${k}`,
        });
      }
    for (const [p, runs] of groupBy(this.runs(access), (r) => r.projectId)) {
      const clean = runs.filter(
        (r) =>
          this.ports.deriveRunStatus(r) === "COMPLETED" &&
          r.tasks.every(
            (t) =>
              t.attempts <= 1 && t.corrections === 0 && t.failures.length === 0,
          ),
      );
      const byIntent = groupBy(clean, (r) => r.intent);
      for (const [intent, list] of byIntent)
        if (list.length >= 3)
          add({
            kind: "SUCCESSFUL_WORKFLOW",
            projectId: p,
            title: `${intent} workflows run cleanly in ${p}`,
            content: `${list.length} ${intent} workflows in ${p} completed without retries, corrections or failures. Their plan shape is a good template.`,
            evidence: [`${list.length} clean runs`],
            key: `clean:${p}:${intent}`,
          });
    }
    const perAgentType = new Map<string, { ok: number; n: number }>();
    for (const { task } of pairs) {
      if (
        !task.assignedAgent ||
        (task.status !== "COMPLETED" && task.status !== "FAILED")
      )
        continue;
      const k = `${task.assignedAgent.agentId}|${task.type}`;
      const c = perAgentType.get(k) ?? { ok: 0, n: 0 };
      c.n++;
      if (task.status === "COMPLETED") c.ok++;
      perAgentType.set(k, c);
    }
    for (const [k, c] of perAgentType)
      if (c.n >= 10 && c.ok / c.n >= 0.9) {
        const [agent, type] = k.split("|");
        add({
          kind: "EFFECTIVE_AGENT",
          title: `${agent} is reliable for ${type} tasks`,
          content: `${agent} completed ${c.ok} of ${c.n} ${type} tasks.`,
          evidence: [`${c.ok}/${c.n}`],
          key: `agent:${k}`,
        });
      }
    const alertEvents = new Map<string, number>();
    for (const a of this.ports.alerts())
      if (!a.projectId || access(a.projectId))
        alertEvents.set(a.event, (alertEvents.get(a.event) ?? 0) + 1);
    for (const [e, n] of alertEvents)
      if (n >= 3)
        add({
          kind: "SECURITY",
          title: `Repeated security finding: ${e}`,
          content: `The security finding "${e}" has been raised ${n} times; address its root cause.`,
          evidence: [`${n} alerts`],
          key: `sec:${e}`,
        });
    this.led("lessons_captured", by, { count: created.length });
    return created;
  }
}

function groupBy<T, K>(list: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of list) {
    const k = key(x);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}
const round = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export type { RecommendationArea };
