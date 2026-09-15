import { Metric, MetricGroup } from "../../../components/ui";
import type { WorkflowSummaryData } from "../workflowsView";

export function WorkflowSummary({ summary }: { summary: WorkflowSummaryData }) {
  return (
    <MetricGroup>
      <Metric label="Total workflows" value={summary.total} />
      <Metric label="Running" value={summary.running} />
      <Metric label="Awaiting approval" value={summary.awaitingApproval} />
      <Metric label="Failed" value={summary.failed} />
      <Metric label="Completed" value={summary.completed} />
    </MetricGroup>
  );
}
