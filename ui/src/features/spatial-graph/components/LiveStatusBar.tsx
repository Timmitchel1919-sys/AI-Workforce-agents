import { useI18n, type MessageKey } from "../../../i18n";
import type { LiveStatus } from "../lib/liveStatus";
import type { GraphTransition } from "../lib/graphDiff";
import { describeTransition, nodeTypeLabel } from "../lib/labels";

/** Glyph + text always accompany the colour, so status is never colour-only. */
const GLYPH: Readonly<Record<LiveStatus, string>> = {
  live: "●",
  refreshing: "↻",
  reconnecting: "⟲",
  degraded: "▲",
  paused: "❚❚",
  offline: "○",
};

const RECENT_SHOWN = 10;

interface Props {
  status: LiveStatus;
  lastConfirmedAt: string | null;
  /** Bounded, newest-last (owned by the hook). Only real, server-confirmed transitions. */
  transitions: readonly GraphTransition[];
  onRefresh?: () => void;
}

/**
 * Transport truth for the graph: what the connection is actually doing, when the shown state was
 * last confirmed by the server, and the most recent real changes. It is deliberately NOT a live
 * region itself — the workspace announces only meaningful changes, so routine polls stay silent.
 */
export function LiveStatusBar({ status, lastConfirmedAt, transitions, onRefresh }: Props) {
  const { t } = useI18n();
  const recent = transitions.slice(-RECENT_SHOWN).reverse();
  const time = lastConfirmedAt ? new Date(lastConfirmedAt).toLocaleTimeString() : null;
  return (
    <div className="sg-live" data-testid="sg-live" data-status={status}>
      <span className={`sg-live__badge sg-live__badge--${status}`} data-testid="sg-live-badge">
        <span aria-hidden="true">{GLYPH[status]}</span> {t(`spatial.live.${status}` as MessageKey)}
      </span>
      {time && <span className="sg-live__time">{t("spatial.live.lastSynced", { time })}</span>}
      {onRefresh && (
        <button type="button" className="sg-chip" onClick={onRefresh}>
          {t("spatial.live.refreshNow")}
        </button>
      )}
      {recent.length > 0 && (
        <details className="sg-live__recent">
          <summary>{t("spatial.live.recent", { count: transitions.length })}</summary>
          <ol data-testid="sg-live-recent">
            {recent.map((tr, i) => (
              <li key={`${tr.at}|${tr.nodeId}|${tr.kind}|${i}`}>
                {describeTransition(t, tr)} <span className="sg-live__type">({nodeTypeLabel(t, tr.nodeType)})</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
