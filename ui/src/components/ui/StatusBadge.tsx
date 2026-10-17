import React from "react";
import "./ui.css";

export type Status =
  | "online"
  | "offline"
  | "idle"
  | "active"
  | "running"
  | "pending"
  | "completed"
  | "failed"
  | "paused"
  | "blocked";

/** Resolve dot colour via CSS tokens so the status palette tracks the design
 *  system (cyan = running, violet = queued/paused, success for completed, etc.). */
const statusMap: Record<Status, { color: string; label: string }> = {
  online:    { color: "var(--success, #34d399)",         label: "Online" },
  offline:   { color: "var(--foreground-dim, #6b7280)",  label: "Offline" },
  idle:      { color: "var(--foreground-dim, #94a3b8)",  label: "Idle" },
  active:    { color: "var(--primary, #38bdf8)",         label: "Active" },
  running:   { color: "var(--primary, #38bdf8)",         label: "Running" },
  pending:   { color: "var(--secondary, #a78bfa)",       label: "Pending" },
  completed: { color: "var(--success, #34d399)",         label: "Completed" },
  failed:    { color: "var(--danger, #f87171)",          label: "Failed" },
  paused:    { color: "var(--secondary, #a78bfa)",       label: "Paused" },
  blocked:   { color: "var(--danger, #f87171)",          label: "Blocked" },
};

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: Status;
}

export function StatusBadge({ status, children, ...rest }: StatusBadgeProps) {
  const meta = statusMap[status];
  return (
    <span className="ui-status" {...rest}>
      <span className="status-dot" style={{ background: meta.color }} aria-hidden />
      <span className="status-text">{children ?? meta.label}</span>
    </span>
  );
}

export default StatusBadge;
