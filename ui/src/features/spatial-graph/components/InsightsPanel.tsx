import { useI18n, type MessageKey } from "../../../i18n";
import type { SpatialInsight, SpatialInsightsReport } from "../../../../../contracts/graph";
import { nodeTypeLabel, stateLabel } from "../lib/labels";
import { capabilityNames, humanize, sourceNames } from "../lib/sources";

interface Props {
  report: SpatialInsightsReport | null;
  loading: boolean;
  failed: boolean;
  /** Nodes present in the current view; an evidence node outside it is shown as text, not a button. */
  isInView: (nodeId: string) => boolean;
  onSelectNode: (nodeId: string) => void;
}

/** Glyph + text always accompany the colour. */
const GLYPH = { info: "ⓘ", warning: "▲", critical: "✖" } as const;

/** Some templates depend on which facts exist (a waiting approval may have no known subject). */
function explanationKey(f: SpatialInsight): string {
  const base = `spatial.insights.explain.${f.kind}.${f.variant}`;
  return f.kind === "WAITING_APPROVAL" && f.params.subject === undefined ? `${base}NoSubject` : base;
}

/** Raw enums in a template read as words: node types are translated, statuses de-underscored. */
function readableParams(t: ReturnType<typeof useI18n>["t"], params: Record<string, string | number>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v !== "string") out[k] = v;
    else if (k === "subjectType") out[k] = nodeTypeLabel(t, v);
    else if (k === "status" || k.endsWith("Status")) out[k] = humanize(v);
    else out[k] = v;
  }
  return out;
}

/**
 * Grounded observations about the recorded state, each with its evidence and limits. Everything
 * here is text and navigation: a suggestion is labelled "not an action", and the only way to act
 * is the separate, confirmed inspector action (which the Control Plane authorises).
 */
export function InsightsPanel({ report, loading, failed, isInView, onSelectNode }: Props) {
  const { t } = useI18n();
  const findings = report?.findings ?? [];
  const unreadable = report?.unavailableSources ?? [];
  const notConnected = report?.notConfiguredSources ?? [];
  // Anything that could not be read OR does not exist here makes "no findings" incomplete, not clear.
  const partial = unreadable.length > 0 || notConnected.length > 0;
  return (
    <section className="sg-panel sg-insights" aria-labelledby="sg-insights-title" data-testid="sg-insights">
      <div className="sg-panel__head">
        <h2 id="sg-insights-title" className="sg-panel__title">
          {t("spatial.insights.title")}
          {report && findings.length > 0 ? <span className="sg-muted"> · {t("spatial.insights.count", { count: findings.length })}</span> : null}
        </h2>
      </div>
      <p className="sg-muted">{t("spatial.insights.note")}</p>

      {failed && (
        <p className="sg-notice" role="status" data-testid="sg-insights-failed">
          {t("spatial.insights.failed")}
        </p>
      )}
      {loading && !report && <p className="sg-muted">{t("spatial.insights.loading")}</p>}
      {unreadable.length > 0 && (
        <p className="sg-notice" role="status" data-testid="sg-insights-partial">
          {t("spatial.insights.sourcesUnavailable", { sources: sourceNames(t, unreadable) })}
        </p>
      )}
      {(report?.inertCapabilities?.length ?? 0) > 0 && (
        <p className="sg-notice sg-notice--info" role="status" data-testid="sg-insights-inert">
          {t("spatial.insights.inertCapabilities", { capabilities: capabilityNames(t, report!.inertCapabilities!) })}
        </p>
      )}
      {notConnected.length > 0 && (
        <p className="sg-notice sg-notice--info" role="status" data-testid="sg-insights-not-configured">
          {t("spatial.insights.sourcesNotConfigured", { sources: sourceNames(t, notConnected) })}
        </p>
      )}
      {report && findings.length === 0 && !failed && (
        <p className="sg-muted" data-testid="sg-insights-none">
          {t(partial ? "spatial.insights.noneUnknown" : "spatial.insights.none")}
        </p>
      )}

      <ul className="sg-insights__list">
        {findings.map((f) => (
          <li key={f.id} className={`sg-insight sg-insight--${f.severity}`} data-testid="sg-insight" data-kind={f.kind}>
            <p className="sg-insight__head">
              <span className={`sg-insight__sev sg-insight__sev--${f.severity}`}>
                <span aria-hidden="true">{GLYPH[f.severity]}</span> {t(`spatial.insights.severity.${f.severity}` as MessageKey)}
              </span>{" "}
              <strong>{t(`spatial.insights.kind.${f.kind}` as MessageKey)}</strong>
            </p>
            <p>{t(explanationKey(f) as MessageKey, readableParams(t, f.params))}</p>
            <p className="sg-muted">{t("spatial.insights.evidence")}:</p>
            <ul className="sg-insight__evidence">
              {f.evidence.map((ev) => (
                <li key={ev.nodeId}>
                  {isInView(ev.nodeId) ? (
                    <button type="button" className="sg-link" onClick={() => onSelectNode(ev.nodeId)}>
                      {ev.label} · {stateLabel(t, ev.state)}
                    </button>
                  ) : (
                    <span className="sg-muted">{t("spatial.insights.notInView", { label: `${ev.label} · ${stateLabel(t, ev.state)}` })}</span>
                  )}
                </li>
              ))}
            </ul>
            {f.recommendations.length > 0 && (
              <div className="sg-insight__suggest">
                <p className="sg-muted">{t("spatial.insights.suggestion")}</p>
                <ul>
                  {f.recommendations.map((r) => (
                    <li key={`${r.kind}:${r.targetNodeId}`}>
                      {t(`spatial.insights.rec.${r.kind}` as MessageKey)}
                      {r.relatedCommand && (
                        <span className="sg-muted">
                          {" "}
                          {t("spatial.insights.related", { command: t(`spatial.command.action.${r.relatedCommand}` as MessageKey) })}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {f.limitations.length > 0 && (
              <ul className="sg-insight__limits sg-muted">
                {f.limitations.map((l) => (
                  <li key={l}>{t(`spatial.insights.limitation.${l}` as MessageKey)}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {report && (
        <p className="sg-muted">
          {t("spatial.insights.asOf", { revision: report.graphRevision })}
          {report.truncated ? ` ${t("spatial.insights.truncated")}` : ""}
        </p>
      )}
    </section>
  );
}
