import { Link } from "react-router-dom";
import { Flag } from "lucide-react";
import { useOverview, useSessions } from "../hooks/useRuntime";
import { useT } from "../lib/useT";
import { ErrorPanel, Skeleton, StatusTag, Tag } from "./common";

export function OverviewStrip() {
  const { tt } = useT();
  const { overview, isLoading, error, refetch } = useOverview();
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (isLoading || !overview) return <Skeleton label={tt("overview.loading")} />;
  const items: [string, number][] = [
    ["active", overview.active],
    ["queued", overview.queued],
    ["waitingApproval", overview.waitingApproval],
    ["failed", overview.failed],
    ["completedToday", overview.completedToday],
  ];
  return (
    <ul className="lw-overview" aria-label={tt("overview.label")}>
      {items.map(([key, value]) => (
        <li key={key} className="lw-overview__item" data-overview={key}>
          <span className="lw-overview__label">{tt(`overview.${key}`)}</span>
          <strong className="lw-overview__value">{value}</strong>
        </li>
      ))}
    </ul>
  );
}

export function SessionPicker({ selectedId }: { selectedId?: string }) {
  const { tt, formatTime } = useT();
  const { sessions, isLoading, error, refetch } = useSessions();
  return (
    <section className="lw-panel" aria-labelledby="lw-sessions-heading">
      <h2 id="lw-sessions-heading" className="lw-panel__title">{tt("sessions.title")}</h2>
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} /> : null}
      {isLoading ? <Skeleton label={tt("sessions.loading")} /> : null}
      {!isLoading && !error && sessions.length === 0 ? (
        <div className="lw-empty">
          <strong>{tt("sessions.emptyTitle")}</strong>
          <p>{tt("sessions.emptyBody")}</p>
          <p className="lw-muted">{tt("sessions.emptyNoWorkspace")}</p>
        </div>
      ) : null}
      {sessions.length > 0 ? (
        <ul className="lw-sessions">
          {sessions.map((s) => (
            <li key={s.executionId}>
              <Link
                to={`/workspace/${encodeURIComponent(s.executionId)}`}
                className={`lw-session${s.executionId === selectedId ? " is-selected" : ""}`}
                aria-current={s.executionId === selectedId ? "page" : undefined}
              >
                <span className="lw-session__task">{s.taskId}</span>
                <span className="lw-session__meta">
                  <StatusTag status={s.status} />
                  <Tag tone="neutral" icon={<span aria-hidden>@</span>}>{s.agentId}</Tag>
                  <Tag tone="neutral" icon={<span aria-hidden>#</span>}>{tt("sessions.changedFiles", { count: s.changedFiles })}</Tag>
                  {s.flagged ? <Tag tone="warning" icon={<Flag size={14} aria-hidden />}>{tt("sessions.flagged")}</Tag> : null}
                </span>
                <span className="lw-muted">{formatTime(s.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
