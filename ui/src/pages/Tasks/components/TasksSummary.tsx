import { Metric, MetricGroup } from "../../../components/ui";
import type { TasksSummaryData } from "../tasksView";

export function TasksSummary({ summary }: { summary: TasksSummaryData }) {
  return (
    <MetricGroup>
      <Metric label="Total tasks" value={summary.total} />
      <Metric label="Running" value={summary.running} />
      <Metric label="Queued" value={summary.queued} />
      <Metric label="Awaiting approval" value={summary.awaitingApproval} />
      <Metric label="Needs attention" value={summary.attention} />
      <Metric label="Completed" value={summary.completed} />
    </MetricGroup>
  );
}
