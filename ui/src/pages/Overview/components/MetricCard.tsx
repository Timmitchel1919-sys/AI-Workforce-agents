import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "../../../components/ui";
import type { MetricStatus, TrendDirection } from "../overviewData";

export interface MetricCardProps {
  id?: string;
  label: string;
  value: number | string;
  context: string;
  status?: MetricStatus;
  trend?: number;
  trendDirection?: TrendDirection;
  icon?: ReactNode;
  linkTo?: string;
  className?: string;
  loading?: boolean;
}

function formatTrend(trend: number, trendDirection?: TrendDirection) {
  const direction = trendDirection ?? (trend > 0 ? "up" : trend < 0 ? "down" : "neutral");
  const absValue = Math.abs(trend);

  if (direction === "down") {
    return {
      symbol: "↓",
      text: `Decrease of ${absValue}`,
      value: `-${absValue}`,
    };
  }

  if (direction === "neutral") {
    return {
      symbol: "→",
      text: "No change",
      value: `${absValue}`,
    };
  }

  return {
    symbol: "↑",
    text: `Increase of ${absValue}`,
    value: `+${absValue}`,
  };
}

export function MetricCard({
  id,
  label,
  value,
  context,
  status = "neutral",
  trend,
  trendDirection,
  icon,
  linkTo,
  className,
  loading = false,
}: MetricCardProps) {
  const trendMeta = typeof trend === "number" ? formatTrend(trend, trendDirection) : null;
  const metricContent = (
    <Card className={["overview-metric", `overview-metric--${status}`, className].filter(Boolean).join(" ")}>
      <div className="overview-metric__label-row">
        <div className="overview-metric__label-wrap">
          {icon ? (
            <span className="overview-metric__icon" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <span className="overview-metric__label">{label}</span>
        </div>
        <span className="overview-metric__dot" aria-hidden="true" />
      </div>

      <div className="overview-metric__value" aria-label={String(value)}>{value}</div>
      <div className="overview-metric__context">{context}</div>

      {trendMeta ? (
        <div className="overview-metric__trend" aria-label={trendMeta.text}>
          <span aria-hidden="true">
            {trendMeta.symbol} {trendMeta.value}
          </span>
          <span className="sr-only">{trendMeta.text}</span>
        </div>
      ) : null}
      {loading ? <span className="sr-only">Loading metric data</span> : null}
    </Card>
  );

  if (linkTo) {
    return (
      <Link
        key={id}
        to={linkTo}
        className="overview-metric__link"
        aria-label={`${label}: ${value}. ${context}. ${trendMeta?.text ?? "No trend"}`}
      >
        {metricContent}
      </Link>
    );
  }

  return <div key={id}>{metricContent}</div>;
}

export default MetricCard;
