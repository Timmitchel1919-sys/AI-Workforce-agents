/**
 * EO-7 — full inspector for one routing decision.
 *
 * Shows every candidate considered (available and rejected), the policy
 * decision, the cost estimate (honestly — unpriced never renders as
 * "$0.00"), and whether this decision was itself a fallback of an earlier
 * one (linked when practical). Read-only: there is no manual override
 * control here (see docs/adr/0029-model-routing.md).
 */
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { EmptyState, ErrorState, Skeleton } from "../../../components/ui";
import { useRoutingDecision, type RoutingDecision } from "../../../features/modelRouting";
import { formatDateTime, useI18n } from "../../../i18n";
import {
  capabilityListLabel,
  formatUsd,
  modelStatusLabel,
  modelStatusTone,
  rejectionReasonLabel,
  routingProfileLabel,
  shortId,
} from "./labels";
import "./ModelRouting.css";

export function RoutingDecisionDetail({ projectId, routingDecisionId }: { projectId: string; routingDecisionId: string }) {
  const { t } = useI18n();
  const detail = useRoutingDecision(projectId, routingDecisionId);
  const base = `/projects/${encodeURIComponent(projectId)}/model-routing`;

  let body;
  if (detail.state === "loading") {
    body = (
      <div role="status" aria-label={t("modelRouting.loading")}>
        <Skeleton height={96} width="100%" />
      </div>
    );
  } else if (detail.state === "not_found") {
    body = <ErrorState title={t("modelRouting.errorTitle")} description={t("modelRouting.decisionNotFound")} />;
  } else if (detail.state === "forbidden" || detail.state === "unauthenticated") {
    body = <ErrorState title={t("modelRouting.errorTitle")} description={t("modelRouting.forbidden")} />;
  } else if (detail.state !== "ready" || !detail.data) {
    body = <ErrorState title={t("modelRouting.errorTitle")} description={t("modelRouting.errorDescription")} onRetry={detail.refetch} retryLabel={t("common.retry")} />;
  } else {
    body = <DetailBody decision={detail.data.decision} base={base} />;
  }

  return (
    <div className="mr">
      <p>
        <Link className="mr-back" to={base}>
          <ArrowLeft size={16} aria-hidden /> {t("modelRouting.backToList")}
        </Link>
      </p>
      {body}
    </div>
  );
}

function DetailBody({ decision: d, base }: { decision: RoutingDecision; base: string }) {
  const { t, language } = useI18n();
  const when = (v?: string) => formatDateTime(v, language) ?? "—";
  const selected = Boolean(d.selectedProvider || d.selectedModel);

  return (
    <>
      <section className="plan-section" aria-labelledby="mr-detail-title">
        <h3 id="mr-detail-title">{t("modelRouting.detailTitle", { id: shortId(d.routingDecisionId, 18) })}</h3>
        <dl className="plan-metrics">
          <Metric label={t("modelRouting.metaAgent")} value={<code>{d.agentId}</code>} />
          <Metric label={t("modelRouting.metaCreated")} value={when(d.createdAt)} />
          {d.taskId ? <Metric label={t("modelRouting.metaTask")} value={<code>{d.taskId}</code>} /> : null}
          {d.executionSessionId ? <Metric label={t("modelRouting.metaExecutionSession")} value={<code>{d.executionSessionId}</code>} /> : null}
          {d.correlationId ? <Metric label={t("modelRouting.metaCorrelationId")} value={<code>{d.correlationId}</code>} /> : null}
        </dl>
      </section>

      <section className="plan-section" aria-labelledby="mr-requirements">
        <h3 id="mr-requirements">{t("modelRouting.requirementsTitle")}</h3>
        <dl className="plan-metrics">
          <Metric label={t("modelRouting.requiredCapabilities")} value={capabilityListLabel(t, d.requirements.requiredCapabilities)} />
          <Metric
            label={t("modelRouting.preferredCapabilities")}
            value={d.requirements.preferredCapabilities ? capabilityListLabel(t, d.requirements.preferredCapabilities) : t("modelRouting.notSpecified")}
          />
          <Metric label={t("modelRouting.routingProfileLabel")} value={d.requirements.routingProfile ? routingProfileLabel(t, d.requirements.routingProfile) : t("modelRouting.notSpecified")} />
          <Metric label={t("modelRouting.toolRequirements")} value={d.requirements.toolRequirements ? t("modelRouting.yes") : t("modelRouting.no")} />
          <Metric label={t("modelRouting.structuredOutput")} value={d.requirements.structuredOutput ? t("modelRouting.yes") : t("modelRouting.no")} />
          <Metric label={t("modelRouting.vision")} value={d.requirements.vision ? t("modelRouting.yes") : t("modelRouting.no")} />
          <Metric
            label={t("modelRouting.providerRestrictions")}
            value={d.requirements.providerRestrictions?.length ? d.requirements.providerRestrictions.join(", ") : t("modelRouting.notRestricted")}
          />
          <Metric
            label={t("modelRouting.modelRestrictions")}
            value={d.requirements.modelRestrictions?.length ? d.requirements.modelRestrictions.join(", ") : t("modelRouting.notRestricted")}
          />
        </dl>
      </section>

      <section className="plan-section" aria-labelledby="mr-outcome">
        <h3 id="mr-outcome">{t("modelRouting.outcomeTitle")}</h3>
        {selected ? (
          <p>
            <code>{`${d.selectedProvider ?? "—"} / ${d.selectedModel ?? "—"}`}</code>
          </p>
        ) : (
          <>
            <p className="plan-muted">{t("modelRouting.noModelSelected")}</p>
            <h4>{t("modelRouting.reasonCodesTitle")}</h4>
            {d.reasonCodes.length === 0 ? (
              <p className="plan-muted">{t("modelRouting.noReasonCodes")}</p>
            ) : (
              <div className="mr-reason-chips">
                {d.reasonCodes.map((code, i) => (
                  <span className="mr-chip" key={`${code}-${i}`}>
                    {rejectionReasonLabel(t, code)}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="plan-section" aria-labelledby="mr-candidates">
        <h3 id="mr-candidates">{t("modelRouting.candidatesTitle")}</h3>
        {d.candidateModels.length === 0 ? (
          <EmptyState title={t("modelRouting.candidatesEmpty")} />
        ) : (
          <div className="mr-table-wrap">
            <table className="mr-table">
              <thead>
                <tr>
                  <th scope="col">{t("modelRouting.colProvider")}</th>
                  <th scope="col">{t("modelRouting.colModel")}</th>
                  <th scope="col">{t("modelRouting.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {d.candidateModels.map((c, i) => (
                  <tr key={`${c.profileId}-${i}`}>
                    <td>{c.providerId}</td>
                    <td>{c.model ? <code>{c.model}</code> : <span className="plan-muted">—</span>}</td>
                    <td>
                      <ToneCell tone={modelStatusTone(c.status)} label={modelStatusLabel(t, c.status)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="plan-section" aria-labelledby="mr-rejected">
        <h3 id="mr-rejected">{t("modelRouting.rejectedTitle")}</h3>
        {d.rejectedCandidates.length === 0 ? (
          <EmptyState title={t("modelRouting.rejectedEmpty")} />
        ) : (
          <div className="mr-table-wrap">
            <table className="mr-table">
              <thead>
                <tr>
                  <th scope="col">{t("modelRouting.colProvider")}</th>
                  <th scope="col">{t("modelRouting.colModel")}</th>
                  <th scope="col">{t("modelRouting.colReasonCode")}</th>
                  <th scope="col">{t("modelRouting.colDetail")}</th>
                </tr>
              </thead>
              <tbody>
                {d.rejectedCandidates.map((c, i) => (
                  <tr key={`${c.profileId}-${i}`}>
                    <td>{c.providerId}</td>
                    <td>{c.model ? <code>{c.model}</code> : <span className="plan-muted">—</span>}</td>
                    <td>
                      {rejectionReasonLabel(t, c.reasonCode)} (<code>{c.reasonCode}</code>)
                    </td>
                    <td className="plan-muted">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="plan-section" aria-labelledby="mr-policy">
        <h3 id="mr-policy">{t("modelRouting.policyTitle")}</h3>
        {!d.policyDecision ? (
          <p className="plan-muted">{t("modelRouting.policyNone")}</p>
        ) : (
          <dl className="plan-metrics">
            <Metric label={t("modelRouting.policyDecisionLabel")} value={d.policyDecision.decision} />
            {d.policyDecision.reasonCode ? <Metric label={t("modelRouting.policyReasonCode")} value={<code>{d.policyDecision.reasonCode}</code>} /> : null}
            <Metric label={t("modelRouting.policyDetail")} value={d.policyDecision.detail} />
          </dl>
        )}
      </section>

      <section className="plan-section" aria-labelledby="mr-cost">
        <h3 id="mr-cost">{t("modelRouting.costTitle")}</h3>
        {!d.costEstimate ? (
          <p className="plan-muted">{t("modelRouting.costNone")}</p>
        ) : d.costEstimate.priced ? (
          <p>{formatUsd(d.costEstimate.amountUsd)}</p>
        ) : (
          <p className="mr-unknown-cost" title={d.costEstimate.reason}>
            {t("modelRouting.costUnknown")}
          </p>
        )}
      </section>

      <section className="plan-section" aria-labelledby="mr-fallback">
        <h3 id="mr-fallback">{t("modelRouting.fallbackTitle")}</h3>
        <dl className="plan-metrics">
          <Metric label={t("modelRouting.fallbackPolicyLabel")} value={d.fallbackPolicy === "governed" ? t("modelRouting.fallbackPolicyGoverned") : t("modelRouting.fallbackPolicyNone")} />
          <Metric label={t("modelRouting.fallbackTitle")} value={d.fallbackUsed ? t("modelRouting.fallbackUsedYes") : t("modelRouting.fallbackUsedNo")} />
        </dl>
        {d.fallbackOf ? (
          <p>
            <span className="plan-muted">{t("modelRouting.fallbackOfLabel")}: </span>
            <Link to={`${base}/${encodeURIComponent(d.fallbackOf)}`}>{t("modelRouting.fallbackOfLink")}</Link>
          </p>
        ) : null}
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="plan-metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ToneCell({ tone, label }: { tone: "ok" | "warn" | "bad" | "neutral"; label: string }) {
  return <span className={`mr-status mr-status--${tone}`}>{label}</span>;
}
