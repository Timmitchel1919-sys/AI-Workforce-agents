import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { PromptRequestSummary } from "../types";
import { UNRESOLVED_PROJECT } from "../types";
import { useT } from "../lib/useT";
import { ErrorPanel, Skeleton, StatusTag, Tag } from "./common";

/** Recent prepared requests, newest first. Each entry is a real link (keyboard + resumable). */
export function HistoryList({ requests, isLoading, error, onRetry, selectedId }: {
  requests: readonly PromptRequestSummary[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  selectedId: string | undefined;
}) {
  const { tt, label, formatTime } = useT();
  const sorted = [...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section className="pi-panel" aria-labelledby="pi-history-heading">
      <h2 id="pi-history-heading" className="pi-panel__title">{tt("history.title")}</h2>
      {isLoading ? <Skeleton label={tt("history.loading")} /> : null}
      {!isLoading && error ? <ErrorPanel error={error} onRetry={onRetry} /> : null}
      {!isLoading && !error && sorted.length === 0 ? (
        <div className="pi-empty">
          <p className="pi-strong">{tt("history.emptyTitle")}</p>
          <p className="pi-muted">{tt("history.emptyBody")}</p>
        </div>
      ) : null}
      {!isLoading && !error && sorted.length > 0 ? (
        <ul className="pi-history">
          {sorted.map((item) => (
            <li key={item.requestId}>
              <Link
                to={`/prompt-intelligence/${encodeURIComponent(item.requestId)}`}
                className={`pi-history__item${item.requestId === selectedId ? " is-selected" : ""}`}
                aria-current={item.requestId === selectedId ? "true" : undefined}
              >
                <span className="pi-history__text">{item.request}</span>
                <span className="pi-history__meta">
                  <StatusTag status={item.validation} />
                  <Tag>{label("intentCategory", item.intent)}</Tag>
                  {item.executionReady ? <Tag tone="success">{tt("history.ready")}</Tag> : null}
                </span>
                <span className="pi-muted">
                  {formatTime(item.createdAt)} · {item.requestedBy} ·{" "}
                  {item.projectId === UNRESOLVED_PROJECT ? tt("common.notIdentified") : item.projectId}
                </span>
                <ChevronRight size={16} aria-hidden className="pi-history__chevron" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
