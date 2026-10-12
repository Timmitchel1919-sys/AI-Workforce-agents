import { Link } from "react-router-dom";
import { useDecisions, useMemory } from "../hooks/useKnowledge";
import { useT } from "../lib/useT";
import type { MemorySummary } from "../types";
import { Empty, ErrorPanel, FreshnessTag, Skeleton, StatusTag, Tag } from "./common";

/** For a superseded decision, name the decision that replaced it (read from the memory's own detail). */
function ChainNote({ memory, search }: { memory: MemorySummary; search: string }) {
  const { tt } = useT();
  const detail = useMemory(memory.status === "SUPERSEDED" ? memory.memoryId : undefined);
  const next = detail.data?.supersededBy;
  if (memory.status !== "SUPERSEDED") return null;
  return (
    <p className="kn-muted" data-testid="chain-note">
      {next ? (
        <>{tt("decisions.replacedBy")} <Link className="kn-link" to={`/knowledge/memories/${encodeURIComponent(next.memoryId)}${search}`}>{next.title}</Link></>
      ) : tt("decisions.replacedUnknown")}
    </p>
  );
}

export function DecisionsTab({ projectId, search }: { projectId: string | undefined; search: string }) {
  const { tt, label, formatTime } = useT();
  const query = useDecisions(projectId);
  if (query.error) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading || !query.data) return <Skeleton label={tt("common.loading")} />;
  if (query.data.length === 0) return <Empty title={tt("decisions.emptyTitle")} body={tt("decisions.emptyBody")} />;
  const ordered = [...query.data].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (
    <section className="kn-panel" aria-labelledby="kn-dec-heading">
      <h2 id="kn-dec-heading" className="kn-panel__title">{tt("decisions.title")}</h2>
      <p className="kn-muted">{tt("decisions.help")}</p>
      <ol className="kn-timeline" aria-label={tt("decisions.title")}>
        {ordered.map((memory) => (
          <li key={memory.memoryId} className="kn-timeline__item" data-status={memory.status}>
            <time className="kn-muted" dateTime={memory.createdAt}>{formatTime(memory.createdAt)}</time>
            <Link className="kn-link kn-row__title" to={`/knowledge/memories/${encodeURIComponent(memory.memoryId)}${search}`}>{memory.title}</Link>
            <p className="kn-row__summary">{memory.summary}</p>
            <div className="kn-row__meta">
              <StatusTag status={memory.status} />
              <Tag>{label("importance", memory.importance)}</Tag>
              <FreshnessTag freshness={memory.freshness} />
              <Tag>{tt("decisions.version", { version: memory.version })}</Tag>
            </div>
            <ChainNote memory={memory} search={search} />
          </li>
        ))}
      </ol>
    </section>
  );
}
