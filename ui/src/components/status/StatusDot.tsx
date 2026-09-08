import type { HealthStatus } from "../../api/contracts";

type Kind = HealthStatus | "ok" | "unknown";

export function StatusDot({ status }: { status: Kind }) {
  return (
    <span
      className={`status-dot status-dot--${status}`}
      title={status}
      aria-label={`status: ${status}`}
    />
  );
}
