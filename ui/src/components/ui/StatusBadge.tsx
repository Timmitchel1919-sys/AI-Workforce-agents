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

const statusMap: Record<Status, { color: string; label: string }> = {
  online: { color: "#16a34a", label: "Online" },
  offline: { color: "#6b7280", label: "Offline" },
  idle: { color: "#f59e0b", label: "Idle" },
  active: { color: "#16a34a", label: "Active" },
  running: { color: "#0ea5e9", label: "Running" },
  pending: { color: "#f97316", label: "Pending" },
  completed: { color: "#10b981", label: "Completed" },
  failed: { color: "#ef4444", label: "Failed" },
  paused: { color: "#a78bfa", label: "Paused" },
  blocked: { color: "#ef4444", label: "Blocked" },
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
