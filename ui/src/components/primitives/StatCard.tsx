import * as React from "react";
import { GlassCard } from "./GlassCard";

export interface StatCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: React.ReactNode;
  trend?: "up" | "down" | "flat";
  icon?: React.ReactNode;
  footnote?: React.ReactNode;
  className?: string;
}

/**
 * Operational metric card — label (mono micro label), big value, optional
 * delta/trend and footnote. One tile; no extra chrome.
 */
export function StatCard({
  label,
  value,
  delta,
  trend = "flat",
  icon,
  footnote,
  className,
}: StatCardProps) {
  return (
    <GlassCard pad="md" className={["aw-stat", className].filter(Boolean).join(" ")}>
      <div className="aw-stat-head">
        <span className="aw-stat-label">{label}</span>
        {icon && <span className="aw-stat-icon" aria-hidden>{icon}</span>}
      </div>
      <div className="aw-stat-value">{value}</div>
      {(delta || footnote) && (
        <div className="aw-stat-foot">
          {delta && <span className={`aw-stat-delta aw-stat-delta--${trend}`}>{delta}</span>}
          {footnote && <span className="aw-stat-note">{footnote}</span>}
        </div>
      )}
    </GlassCard>
  );
}
export default StatCard;
