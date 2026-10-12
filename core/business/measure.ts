/**
 * Measures the KPI metrics the platform can compute from its own data. A metric with nothing to
 * measure returns `value: null` (never a made-up number).
 */
import type { UsageRecord } from "../../contracts/cost-center.js";
import type {
  ExecutionRun,
  RunStatus,
} from "../../contracts/execution-orchestration.js";
import type {
  MeasuredMetric,
  Measurement,
} from "../../contracts/business-layer.js";

export interface MeasureInputs {
  runs: ExecutionRun[];
  deriveRunStatus: (run: ExecutionRun) => RunStatus;
  usage: UsageRecord[];
  alerts: { projectId?: string; status: string }[];
}

const OPEN = new Set(["OPEN", "ACKNOWLEDGED", "INVESTIGATING", "NEW", ""]);

export function measureMetric(
  metric: MeasuredMetric,
  projectId: string | undefined,
  i: MeasureInputs,
): Measurement {
  const runs = i.runs.filter((r) => !projectId || r.projectId === projectId);
  const tasks = runs.flatMap((r) => r.tasks);
  const where = projectId ? `project ${projectId}` : "all projects";
  const pct = (n: number, d: number, note: string): Measurement => ({
    value: d > 0 ? Math.round((n / d) * 1000) / 10 : null,
    sample: d,
    unit: "%",
    note:
      d > 0
        ? `${note} (${n} of ${d}, ${where})`
        : `no ${note.toLowerCase()} data for ${where}`,
  });
  switch (metric) {
    case "PROJECT_COMPLETION":
      return pct(
        tasks.filter((t) => t.status === "COMPLETED").length,
        tasks.filter((t) => t.status !== "CANCELLED").length,
        "Completed tasks",
      );
    case "TASK_SUCCESS_RATE": {
      const done = tasks.filter(
        (t) => t.status === "COMPLETED" || t.status === "FAILED",
      );
      return pct(
        done.filter((t) => t.status === "COMPLETED").length,
        done.length,
        "Successful tasks",
      );
    }
    case "RUN_FAILURE_RATE": {
      const done = runs
        .map((r) => i.deriveRunStatus(r))
        .filter((s) => s === "COMPLETED" || s === "FAILED");
      return pct(
        done.filter((s) => s === "FAILED").length,
        done.length,
        "Failed runs",
      );
    }
    case "DEPLOYMENT_SUCCESS_RATE": {
      const dep = tasks.filter(
        (t) =>
          t.type === "DEPLOYMENT" &&
          (t.status === "COMPLETED" || t.status === "FAILED"),
      );
      return pct(
        dep.filter((t) => t.status === "COMPLETED").length,
        dep.length,
        "Successful deployments",
      );
    }
    case "AI_COST_USD": {
      const u = i.usage.filter((x) => !projectId || x.projectId === projectId);
      const priced = u.filter((x) => x.cost.priced);
      const total = priced.reduce(
        (n, x) => n + (x.cost.priced ? x.cost.amountUsd : 0),
        0,
      );
      return priced.length > 0
        ? {
            value: Math.round(total * 10000) / 10000,
            sample: u.length,
            unit: "USD",
            note: `priced AI cost for ${where}${u.length > priced.length ? `; ${u.length - priced.length} unpriced call(s) are not included` : ""}`,
          }
        : {
            value: null,
            sample: u.length,
            unit: "USD",
            note: u.length
              ? `${u.length} call(s) could not be priced`
              : `no AI usage recorded for ${where}`,
          };
    }
    case "OPEN_SECURITY_ALERTS": {
      const a = i.alerts.filter(
        (x) => (!projectId || x.projectId === projectId) && OPEN.has(x.status),
      );
      return {
        value: a.length,
        sample: a.length,
        unit: "alerts",
        note: `open security alerts for ${where}`,
      };
    }
  }
}
