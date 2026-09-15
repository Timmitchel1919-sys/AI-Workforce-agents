import { Metric, MetricGroup } from "../../../components/ui";
import type { ProjectSummaryData } from "../projectsView";
export function ProjectSummary({ summary }: { summary: ProjectSummaryData }) {
  return (
    <MetricGroup>
      <Metric label="Total projects" value={summary.total} />
      <Metric label="Available" value={summary.available} />
      <Metric label="Degraded" value={summary.degraded} />
      <Metric label="Unavailable" value={summary.unavailable} />
    </MetricGroup>
  );
}
