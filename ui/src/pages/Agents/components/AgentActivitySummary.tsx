import { Metric, MetricGroup } from "../../../components/ui";
import { formatDurationMs } from "../../../lib/duration";
import type { ExecutionsSummary } from "../executions";

/**
 * Activity summary for the currently loaded window of executions. These are
 * windowed counts (bounded by the audit page size), not lifetime totals —
 * `AgentView.stats` (shown in the Workload card) remains the authoritative
 * lifetime source. Every number here is derived from real paired executions;
 * nothing is hardcoded or estimated.
 */
export function AgentActivitySummary({
  summary,
}: {
  summary: ExecutionsSummary;
}) {
  return (
    <MetricGroup>
      <Metric label="Active" value={summary.active} hint="Running now" />
      <Metric label="Completed" value={summary.completed} hint="Recent" />
      <Metric label="Failed" value={summary.failed} hint="Recent" />
      <Metric
        label="Avg. duration"
        value={formatDurationMs(summary.averageDurationMs)}
        hint="Recent"
      />
    </MetricGroup>
  );
}
