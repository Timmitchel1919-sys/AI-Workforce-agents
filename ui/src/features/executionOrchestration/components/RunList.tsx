import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { RunSummary } from "../types";
import { useT } from "../lib/useT";
import { ErrorPanel, ProgressBar, RunStatusTag, Skeleton } from "./common";

/** Runs, newest first. Each entry is a real link (keyboard accessible and resumable). */
export function RunList({ runs, isLoading, error, onRetry, selectedId }: {
  runs: readonly RunSummary[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  selectedId?: string | undefined;
}) {
  const { tt, formatTime } = useT();
  const sorted = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section className="eo-panel" aria-labelledby="eo-runs-heading">
      <h2 id="eo-runs-heading" className="eo-panel__title">{tt("list.title")}</h2>
      {isLoading ? <Skeleton label={tt("list.loading")} /> : null}
      {!isLoading && error ? <ErrorPanel error={error} onRetry={onRetry} /> : null}
      {!isLoading && !error && sorted.length === 0 ? (
        <div className="eo-empty">
          <p className="eo-strong">{tt("list.emptyTitle")}</p>
          <p className="eo-muted">{tt("list.emptyBody")}</p>
        </div>
      ) : null}
      {!isLoading && !error && sorted.length > 0 ? (
        <ul className="eo-runs">
          {sorted.map((run) => (
            <li key={run.runId}>
              <Link
                to={`/execution-center/${encodeURIComponent(run.runId)}`}
                className={`eo-run${run.runId === selectedId ? " is-selected" : ""}`}
                aria-current={run.runId === selectedId ? "true" : undefined}
              >
                <span className="eo-run__objective">{run.objective}</span>
                <span className="eo-run__meta"><RunStatusTag status={run.status} /></span>
                <ProgressBar completed={run.progress.completed} total={run.progress.total} percent={run.progress.percent} />
                <span className="eo-muted">
                  {tt("list.project", { project: run.projectId })} · {tt("list.createdAt", { time: formatTime(run.createdAt) })}
                </span>
                <ChevronRight size={16} aria-hidden className="eo-run__chevron" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
