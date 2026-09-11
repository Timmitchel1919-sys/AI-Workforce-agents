import { Metric, MetricGroup } from "../../../components/ui";
import type { AgentsSummary as AgentsSummaryData } from "../agentsView";

/**
 * High-level workforce summary. Every number is derived from the loaded
 * `AgentView[]` (see `summarize`) — no hard-coded or fabricated metrics, and
 * no health/uptime figures the backend does not provide. "Disabled" is used
 * rather than "Offline": the contract has no offline state.
 */
export function AgentsSummary({ summary }: { summary: AgentsSummaryData }) {
  return (
    <MetricGroup>
      <Metric label="Total agents" value={summary.total} />
      <Metric
        label="Available"
        value={summary.available}
        hint="Ready for work"
      />
      <Metric label="Busy" value={summary.busy} hint="Running a task" />
      <Metric label="Idle" value={summary.idle} />
      <Metric
        label="Needs attention"
        value={summary.attention}
        hint="Blocked or failed"
      />
      <Metric label="Disabled" value={summary.disabled} />
    </MetricGroup>
  );
}
