import { useState, type ReactNode } from "react";
import { Copy, Check } from "./icons";
import { cn, cssVars } from "../../lib/utils";
import { formatDateTime, formatRelative } from "../../lib/dates";

/* ---- Metric / MetricGroup ------------------------------------------- */
export function MetricGroup({ children }: { children: ReactNode }) {
  return <div className="ui-metric-group">{children}</div>;
}

export function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="ui-metric">
      <div className="ui-metric__label">{label}</div>
      <div className="ui-metric__value">{value}</div>
      {hint ? <div className="ui-metric__hint">{hint}</div> : null}
    </div>
  );
}

/* ---- KeyValue -------------------------------------------------- */
export interface KeyValueRow {
  key: string;
  value: ReactNode;
}
export function KeyValue({ rows }: { rows: readonly KeyValueRow[] }) {
  return (
    <dl className="ui-kv">
      {rows.map((row) => (
        <div key={row.key} style={{ display: "contents" }}>
          <dt className="ui-kv__key">{row.key}</dt>
          <dd className="ui-kv__value">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---- Identifier (technical id, truncate + copy) ----------------- */
export function Identifier({
  value,
  truncate = false,
  copyable = true,
}: {
  value: string;
  truncate?: boolean;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <span className="ui-identifier" title={value}>
      <span className={cn("ui-identifier__text", truncate && "u-truncate")}>
        {value}
      </span>
      {copyable ? (
        <button
          type="button"
          className="ui-identifier__copy"
          onClick={onCopy}
          aria-label={copied ? "Copied" : `Copy ${value}`}
        >
          {copied ? (
            <Check width={13} height={13} aria-hidden="true" />
          ) : (
            <Copy width={13} height={13} aria-hidden="true" />
          )}
        </button>
      ) : null}
    </span>
  );
}

/* ---- Timestamp -------------------------------------------------- */
export function Timestamp({
  value,
  relative = false,
}: {
  value: string | null | undefined;
  relative?: boolean;
}) {
  if (!value) return <span className="ui-timestamp">—</span>;
  return (
    <time
      className="ui-timestamp"
      dateTime={value}
      title={formatDateTime(value)}
    >
      {relative ? formatRelative(value) : formatDateTime(value)}
    </time>
  );
}

/* ---- Progress -------------------------------------------------- */
export function Progress({
  value,
  max = 1,
  tone = "accent",
  showLabel = true,
}: {
  value: number;
  max?: number;
  tone?: "accent" | "success" | "danger";
  showLabel?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className="ui-progress"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="ui-progress__track">
        <span
          className={cn(
            "ui-progress__bar",
            tone !== "accent" && `ui-progress__bar--${tone}`,
          )}
          style={cssVars({ "--_w": `${pct}%` })}
        />
      </span>
      {showLabel ? <span>{Math.round(pct)}%</span> : null}
    </div>
  );
}

/* ---- ActivityItem -------------------------------------------- */
export function ActivityItem({
  time,
  children,
}: {
  time: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <div className="ui-activity">
      <span className="ui-activity__time">
        {time ? formatRelative(time) : "—"}
      </span>
      <span>{children}</span>
    </div>
  );
}
