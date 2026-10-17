import * as React from "react";

export type StatusTone =
  | "idle"
  | "running"
  | "queued"
  | "blocked"
  | "success"
  | "warning"
  | "info"
  | "cyan"
  | "violet"
  | "neutral";

export interface StatusChipProps {
  tone?: StatusTone;
  pulse?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Operational status chip. Mono micro label, dot indicator, optional pulse.
 * Shared across projects, tasks, agents, deployments, approvals.
 */
export function StatusChip({ tone = "neutral", pulse = false, children, className }: StatusChipProps) {
  return (
    <span
      className={["aw-status-chip", `aw-status-chip--${tone}`, className].filter(Boolean).join(" ")}
    >
      <span className={["aw-status-dot", pulse ? "aw-status-dot--pulse" : ""].join(" ")} aria-hidden />
      {children}
    </span>
  );
}
export default StatusChip;
