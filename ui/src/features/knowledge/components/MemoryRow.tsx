import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { isHit } from "../lib/logic";
import { useT } from "../lib/useT";
import type { MemorySummary, SearchHit } from "../types";
import { FreshnessTag, StatusTag, Tag } from "./common";

/** One memory in a list. All memory text is rendered as plain text. */
export function MemoryRow({ memory, search, actions }: { memory: MemorySummary | SearchHit; search: string; actions?: ReactNode }) {
  const { tt, label, formatTime } = useT();
  const [open, setOpen] = useState(false);
  const hit = isHit(memory) ? memory : null;
  return (
    <li className="kn-row" data-memory-id={memory.memoryId}>
      <div className="kn-row__head">
        <Link to={`/knowledge/memories/${encodeURIComponent(memory.memoryId)}${search}`} className="kn-link kn-row__title">
          {memory.title}
        </Link>
        {hit ? <Tag tone="info" icon={<span aria-hidden>#</span>}>{tt("search.score", { score: hit.score.toFixed(2) })}</Tag> : null}
      </div>
      <p className="kn-row__summary">{memory.summary}</p>
      <div className="kn-row__meta">
        <Tag>{label("type", memory.type)}</Tag>
        <Tag icon={<span aria-hidden>@</span>}>{label("source", memory.source)}</Tag>
        <Tag icon={<span aria-hidden>%</span>}>{label("confidence", memory.confidence)}</Tag>
        <Tag icon={<span aria-hidden>!</span>}>{label("importance", memory.importance)}</Tag>
        <StatusTag status={memory.status} />
        <FreshnessTag freshness={memory.freshness} />
        {hit && hit.conflictWith.length > 0 ? <Tag tone="danger">{tt("search.conflictWith", { count: hit.conflictWith.length })}</Tag> : null}
      </div>
      <p className="kn-muted">{tt("memory.lastUpdated", { when: formatTime(memory.updatedAt) })}</p>
      {hit ? (
        <div className="kn-why">
          <button type="button" className="kn-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            {tt("search.why")}
          </button>
          {open ? (
            <ul className="kn-list" aria-label={tt("search.why")}>
              {hit.reasons.length === 0 ? <li className="kn-muted">{tt("search.noReasons")}</li> : null}
              {hit.reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
      {actions ? <div className="kn-actions">{actions}</div> : null}
    </li>
  );
}
