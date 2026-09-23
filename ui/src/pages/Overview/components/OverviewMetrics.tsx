import type { OverviewMetric } from "../overviewData";
import { useI18n } from "../../../i18n";
import { MetricCard } from "./MetricCard";

interface OverviewMetricsProps {
  metrics: OverviewMetric[];
}

export function OverviewMetrics({ metrics }: OverviewMetricsProps) {
  const { t } = useI18n();
  return (
    <div className="overview-metrics" aria-label={t("overview.metrics")}>
      {metrics.map((metric) => (
        <MetricCard key={metric.id} {...metric} />
      ))}
    </div>
  );
}
