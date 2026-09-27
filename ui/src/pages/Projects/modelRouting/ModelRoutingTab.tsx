/**
 * EO-7 — read-only Model Router routing-decision history.
 *
 * Authoritative only: every row comes from the Control Plane. `configured:
 * false` is shown as "not configured", never as an empty history. An empty
 * `decisions` list is phrased neutrally ("nothing routed yet"), not as an
 * error. This tab has no write form: there is no backend command yet for a
 * manual model override (see docs/adr/0029-model-routing.md).
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, CircleDashed, Lock, RefreshCw, Route as RouteIcon, XCircle } from "lucide-react";
import { Button, EmptyState, ErrorState, Skeleton } from "../../../components/ui";
import { useProjectRoutingDecisions, type ModelRoutingState, type RoutingDecision } from "../../../features/modelRouting";
import { formatDateTime, useI18n } from "../../../i18n";
import { rejectionReasonLabel, shortId } from "./labels";
import "./ModelRouting.css";

function ToneText({ tone, label }: { tone: "ok" | "warn" | "bad" | "neutral"; label: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "bad" ? XCircle : tone === "warn" ? AlertTriangle : CircleDashed;
  return (
    <span className={`mr-status mr-status--${tone}`}>
      <Icon size={14} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

function Gate({ state, onRetry, children }: { state: ModelRoutingState; onRetry: () => void; children: ReactNode }) {
  const { t } = useI18n();
  if (state === "loading") {
    return (
      <div role="status" aria-label={t("modelRouting.loading")}>
        <Skeleton height={48} width="100%" />
      </div>
    );
  }
  if (state === "forbidden" || state === "unauthenticated") {
    return <ErrorState icon={<Lock size={24} />} title={t("modelRouting.errorTitle")} description={t("modelRouting.forbidden")} />;
  }
  if (state === "not_found") return <ErrorState title={t("modelRouting.errorTitle")} description={t("modelRouting.notFound")} />;
  if (state !== "ready") {
    return <ErrorState title={t("modelRouting.errorTitle")} description={t("modelRouting.errorDescription")} onRetry={onRetry} retryLabel={t("common.retry")} />;
  }
  return <>{children}</>;
}

function selectionOf(decision: RoutingDecision): { made: boolean; text: string } {
  if (decision.selectedProvider || decision.selectedModel) {
    return { made: true, text: `${decision.selectedProvider ?? "—"} / ${decision.selectedModel ?? "—"}` };
  }
  return { made: false, text: "—" };
}

export function ModelRoutingTab({ projectId }: { projectId: string }) {
  const { t, language } = useI18n();
  const decisions = useProjectRoutingDecisions(projectId);
  const base = `/projects/${encodeURIComponent(projectId)}/model-routing`;

  return (
    <div className="mr">
      <div className="mr-toolbar">
        <p className="plan-muted">{t("modelRouting.description")}</p>
        <Button variant="secondary" onClick={decisions.refetch}>
          <RefreshCw size={16} aria-hidden /> {t("modelRouting.refresh")}
        </Button>
      </div>

      <section className="plan-section" aria-labelledby="mr-list">
        <h3 id="mr-list">
          <RouteIcon size={18} aria-hidden /> {t("modelRouting.listTitle")}
        </h3>
        <Gate state={decisions.state} onRetry={decisions.refetch}>
          {!decisions.data?.configured ? (
            <p className="plan-muted">{t("modelRouting.notConfigured")}</p>
          ) : decisions.data.decisions.length === 0 ? (
            <EmptyState title={t("modelRouting.listEmpty")} />
          ) : (
            <div className="mr-table-wrap">
              <table className="mr-table">
                <thead>
                  <tr>
                    <th scope="col">{t("modelRouting.colDecision")}</th>
                    <th scope="col">{t("modelRouting.colAgent")}</th>
                    <th scope="col">{t("modelRouting.colSelection")}</th>
                    <th scope="col">{t("modelRouting.colWhyNot")}</th>
                    <th scope="col">{t("modelRouting.colCreated")}</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.data.decisions.map((d) => {
                    const selection = selectionOf(d);
                    return (
                      <tr key={d.routingDecisionId}>
                        <td>
                          <Link to={`${base}/${encodeURIComponent(d.routingDecisionId)}`}>
                            <code>{shortId(d.routingDecisionId, 14)}</code>
                          </Link>
                        </td>
                        <td>
                          <code>{d.agentId}</code>
                        </td>
                        <td>
                          <ToneText
                            tone={selection.made ? "ok" : "bad"}
                            label={selection.made ? t("modelRouting.selectionSelected") : t("modelRouting.noModelSelected")}
                          />
                          {selection.made ? (
                            <div>
                              <code>{selection.text}</code>
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {selection.made || d.reasonCodes.length === 0 ? (
                            <span className="plan-muted">—</span>
                          ) : (
                            <div className="mr-reason-chips">
                              {d.reasonCodes.map((code, i) => (
                                <span className="mr-chip" key={`${code}-${i}`}>
                                  {rejectionReasonLabel(t, code)}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>{formatDateTime(d.createdAt, language)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Gate>
      </section>
    </div>
  );
}
