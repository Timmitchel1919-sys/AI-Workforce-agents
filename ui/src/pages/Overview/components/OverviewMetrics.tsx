import type { OverviewMetric } from "../overviewData";
import { MetricCard } from "./MetricCard";

interface OverviewMetricsProps {
  metrics: OverviewMetric[];
}

export function OverviewMetrics({ metrics }: OverviewMetricsProps) {
  return (
    <div className="overview-metrics" aria-label="Workforce metrics">
      {metrics.map((metric) => (
        <MetricCard key={metric.id} {...metric} />
      ))}
    </div>
  );
}
