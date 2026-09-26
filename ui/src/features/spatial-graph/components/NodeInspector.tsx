import { useMemo } from "react";
import { useI18n, type MessageKey } from "../../../i18n";
import type { WorkforceGraphNode } from "../../../../../contracts/graph";
import type { GraphData } from "../lib/graphModel";
import { buildInspectorModel, type FieldValue, type InspectorRelation, type NodeRef } from "../lib/inspectorModel";
import { edgeStatusLabel, edgeTypeLabel, nodeTypeLabel } from "../lib/labels";
import { StateBadge } from "./StateBadge";

interface Props {
  node: WorkforceGraphNode | null;
  /** The full projection, so relations are not hidden by the active filter. */
  graph: GraphData;
  onSelectNode: (id: string) => void;
  onClose: () => void;
}

export function NodeInspector({ node, graph, onSelectNode, onClose }: Props) {
  const { t } = useI18n();
  const model = useMemo(() => (node ? buildInspectorModel(node, graph) : null), [node, graph]);

  if (!node || !model) {
    return (
      <section className="sg-panel sg-inspector" aria-label={t("spatial.inspector.title")}>
        <h2 className="sg-panel__title">{t("spatial.inspector.title")}</h2>
        <p className="sg-muted">{t("spatial.inspector.empty")}</p>
      </section>
    );
  }

  const unavailable = <span className="sg-muted">{t("spatial.inspector.unavailable")}</span>;

  const nodeButton = (ref: NodeRef) => (
    <button
      type="button"
      className="sg-link"
      aria-label={t("spatial.inspector.selectRelated", { label: ref.label })}
      onClick={() => onSelectNode(ref.id)}
    >
      {ref.label}
    </button>
  );

  const renderValue = (value: FieldValue) => {
    switch (value.kind) {
      case "type":
        return nodeTypeLabel(t, value.type);
      case "state":
        return <StateBadge state={value.state} />;
      case "text":
        return value.text === null ? unavailable : value.text;
      case "nodes":
        if (value.nodes.length === 0) {
          return value.empty === "unavailable" ? unavailable : <span className="sg-muted">{t("spatial.inspector.none")}</span>;
        }
        return (
          <ul className="sg-inline-list">
            {value.nodes.map((n) => (
              <li key={n.id}>{nodeButton(n)}</li>
            ))}
          </ul>
        );
    }
  };

  const relationGroup = (direction: InspectorRelation["direction"]) => {
    const items = model.relations.filter((r) => r.direction === direction);
    if (items.length === 0) return null;
    return (
      <div>
        <h4 className="sg-subtitle">{t(`spatial.inspector.${direction}` as MessageKey)}</h4>
        <ul className="sg-relations">
          {items.map((r) => (
            <li key={`${r.edgeId}:${direction}`}>
              <span className="sg-relation__type">{edgeTypeLabel(t, r.edgeType)}</span>{" "}
              {r.status && (
                <span className={`sg-edge-status sg-edge-status--${r.status}`}>[{edgeStatusLabel(t, r.status)}]</span>
              )}{" "}
              {nodeButton(r.other)}{" "}
              <span className="sg-muted">({nodeTypeLabel(t, r.other.type)})</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <section className="sg-panel sg-inspector" aria-label={t("spatial.inspector.title")}>
      <div className="sg-panel__head">
        <h2 className="sg-panel__title">{node.label}</h2>
        <button type="button" className="sg-btn sg-btn--icon" aria-label={t("spatial.inspector.close")} onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <dl className="sg-fields">
        {model.fields.map((f) => (
          <div key={f.id} className="sg-field">
            <dt>{t(`spatial.inspector.${f.id}` as MessageKey)}</dt>
            <dd>{renderValue(f.value)}</dd>
          </div>
        ))}
      </dl>
      {model.extras.length > 0 && (
        <>
          <h3 className="sg-subtitle">{t("spatial.inspector.details")}</h3>
          <dl className="sg-fields">
            {model.extras.map((x) => (
              <div key={x.key} className="sg-field">
                <dt>{x.label}</dt>
                <dd>{x.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <h3 className="sg-subtitle">{t("spatial.inspector.relations")}</h3>
      {model.relations.length === 0 ? (
        <p className="sg-muted">{t("spatial.inspector.noRelations")}</p>
      ) : (
        <>
          {relationGroup("outgoing")}
          {relationGroup("incoming")}
        </>
      )}
    </section>
  );
}
