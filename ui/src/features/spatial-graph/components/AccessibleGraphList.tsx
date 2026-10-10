import { useI18n } from "../../../i18n";
import type { WorkforceGraphNode } from "../../../../../contracts/graph";
import { nodeTypeLabel, stateLabel } from "../lib/labels";
import { StateBadge } from "./StateBadge";

interface Props {
  nodes: readonly WorkforceGraphNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

/**
 * The accessible (and visible) equivalent of the 3D view: every node is a real button
 * whose label carries type, label and state. Selection here drives the canvas and inspector.
 */
export function AccessibleGraphList({ nodes, selectedId, onSelect, onHover }: Props) {
  const { t } = useI18n();
  return (
    <section className="sg-panel sg-list" aria-labelledby="sg-list-title">
      <h2 id="sg-list-title" className="sg-panel__title">
        {t("spatial.list.title")}
      </h2>
      <p className="sg-muted" id="sg-list-help">
        {t("spatial.list.instructions")}
      </p>
      {nodes.length === 0 ? (
        <p className="sg-muted">{t("spatial.list.empty")}</p>
      ) : (
        <ul className="sg-list__items" aria-describedby="sg-list-help">
          {nodes.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="sg-list__item"
                aria-pressed={n.id === selectedId}
                aria-label={t("spatial.list.itemLabel", {
                  type: nodeTypeLabel(t, n.type),
                  label: n.label,
                  state: stateLabel(t, n.state),
                })}
                onClick={() => onSelect(n.id)}
                onFocus={() => onHover(n.id)}
                onBlur={() => onHover(null)}
                onMouseEnter={() => onHover(n.id)}
                onMouseLeave={() => onHover(null)}
              >
                <span className="sg-list__type">{nodeTypeLabel(t, n.type)}</span>
                <span className="sg-list__label">{n.label}</span>
                <StateBadge state={n.state} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
