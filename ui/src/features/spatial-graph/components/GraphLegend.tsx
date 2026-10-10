import { useMemo } from "react";
import { useI18n } from "../../../i18n";
import type { WorkforceGraphEdge } from "../../../../../contracts/graph";
import { edgeStatusLabel, edgeTypeLabel } from "../lib/labels";
import { ALL_STATES } from "../lib/stateStyle";
import { StateBadge } from "./StateBadge";

export function GraphLegend({ edges }: { edges: readonly WorkforceGraphEdge[] }) {
  const { t } = useI18n();
  const edgeTypes = useMemo(() => Array.from(new Set(edges.map((e) => e.type))).sort(), [edges]);
  const edgeStatuses = useMemo(
    () => Array.from(new Set(edges.map((e) => e.status).filter((x): x is string => !!x))).sort(),
    [edges],
  );
  return (
    <section className="sg-panel sg-legend" aria-label={t("spatial.legend.title")}>
      <h2 className="sg-panel__title">{t("spatial.legend.title")}</h2>
      <h3 className="sg-subtitle">{t("spatial.legend.states")}</h3>
      <ul className="sg-legend__list">
        {ALL_STATES.map((s) => (
          <li key={s}>
            <StateBadge state={s} />
          </li>
        ))}
      </ul>
      <h3 className="sg-subtitle">{t("spatial.legend.edges")}</h3>
      {edgeTypes.length === 0 ? (
        <p className="sg-muted">{t("spatial.legend.noEdges")}</p>
      ) : (
        <ul className="sg-legend__list">
          {edgeTypes.map((type) => (
            <li key={type}>{edgeTypeLabel(t, type)}</li>
          ))}
        </ul>
      )}
      {edgeStatuses.length > 0 && (
        <ul className="sg-legend__list">
          {edgeStatuses.map((st) => (
            <li key={st}>
              <span className={`sg-edge-status sg-edge-status--${st}`}>[{edgeStatusLabel(t, st)}]</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
