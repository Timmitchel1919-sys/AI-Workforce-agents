import type { ReactNode } from "react";
import { ShieldAlert, type LucideIcon } from "./icons";
import { cn, cssVars } from "../../lib/utils";
import { describeRisk, describeStatus } from "../../lib/status";

export type BadgeTone =
  "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export function Badge({
  tone = "neutral",
  icon: Icon,
  children,
  className,
}: {
  tone?: BadgeTone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("ui-badge", `ui-badge--${tone}`, className)}>
      {Icon ? <Icon className="ui-badge__icon" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/* ---- StatusDot / StatusBadge / StatusIndicator ------------------------ */
function toneVar(status: string) {
  return cssVars({ "--_c": describeStatus(status).cssVar });
}

export function StatusDot({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const info = describeStatus(status);
  return (
    <span
      className={cn(
        "ui-status-dot",
        info.live && "ui-status-dot--pulse",
        className,
      )}
      style={toneVar(status)}
      aria-hidden="true"
    />
  );
}

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  const info = describeStatus(status);
  return (
    <span className={cn("ui-status-badge", className)} style={toneVar(status)}>
      <span
        className={cn("ui-status-dot", info.live && "ui-status-dot--pulse")}
        aria-hidden="true"
      />
      {label ?? info.label}
    </span>
  );
}

/** Dot + text label, inline — for tables and dense rows. */
export function StatusIndicator({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  const info = describeStatus(status);
  return (
    <span className="ui-status">
      <StatusDot status={status} />
      {label ?? info.label}
    </span>
  );
}

/* ---- RiskBadge ---------------------------------------------------- */
export function RiskBadge({ level }: { level: string }) {
  const risk = describeRisk(level);
  return (
    <span
      className={cn("ui-risk", `ui-risk--${risk.level}`)}
      style={cssVars({ "--_c": risk.cssVar })}
    >
      {risk.level === "high" ? (
        <ShieldAlert className="ui-risk__icon" aria-hidden="true" />
      ) : null}
      {risk.label}
    </span>
  );
}
