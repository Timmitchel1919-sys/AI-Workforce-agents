import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { StatCard } from "../../../components/primitives/StatCard";
import { useI18n, type I18nContextValue } from "../../../i18n";
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

function formatTrend(t: I18nContextValue["t"], trend: number, trendDirection?: TrendDirection) {
  const direction = trendDirection ?? (trend > 0 ? "up" : trend < 0 ? "down" : "neutral");
  const absValue = Math.abs(trend);
  if (direction === "down") {
    return { symbol: "↓", text: t("overview.trendDown", { value: absValue }), value: `-${absValue}`, trend: "down" as const };
  }
  if (direction === "neutral") {
    return { symbol: "→", text: t("overview.trendNone"), value: `${absValue}`, trend: "flat" as const };
  }
  return { symbol: "↑", text: t("overview.trendUp", { value: absValue }), value: `+${absValue}`, trend: "up" as const };
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
  const { t } = useI18n();
  const trendMeta = typeof trend === "number" ? formatTrend(t, trend, trendDirection) : null;

  const card = (
    <StatCard
      className={["overview-metric", `overview-metric--${status}`, className].filter(Boolean).join(" ")}
      label={label}
      value={<span aria-label={String(value)}>{value}</span>}
      icon={icon}
      delta={
        trendMeta ? (
          <>
            <span aria-hidden="true">{trendMeta.symbol} {trendMeta.value}</span>
            <span className="sr-only">{trendMeta.text}</span>
          </>
        ) : undefined
      }
      trend={trendMeta?.trend}
      footnote={<span>{context}{loading ? <span className="sr-only"> · {t("overview.loadingMetric")}</span> : null}</span>}
    />
  );

  if (linkTo) {
    return (
      <Link
        key={id}
        to={linkTo}
        className="overview-metric__link"
      >
        {card}
      </Link>
    );
  }

  return <div key={id}>{card}</div>;
}

export default MetricCard;
