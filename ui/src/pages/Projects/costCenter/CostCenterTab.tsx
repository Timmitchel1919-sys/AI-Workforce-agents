/**
 * EO-6.2/6.3 — read-only AI Cost Center + rule-based Auditor Findings.
 *
 * Authoritative only: every figure, status and finding comes from the
 * Control Plane. `configured: false` is shown as "not configured", never as
 * zero usage or an unlimited budget. Unpriced usage is shown as "cost
 * unknown", never as $0.00. This tab has no write form: budget and
 * governance policy are set through a separate, explicit admin command this
 * page does not expose.
 */
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Lock, RefreshCw, ShieldCheck, Wallet, XCircle } from "lucide-react";
import { Button, EmptyState, ErrorState, Skeleton } from "../../../components/ui";
import {
  useProjectAuditFindings,
  useProjectCostReport,
  useProjectGovernancePolicy,
  type CostCenterState,
} from "../../../features/costCenter";
import { formatDateTime, useI18n } from "../../../i18n";
import { shortId } from "../operations/labels";
import { auditSeverityLabel, auditSeverityTone, budgetStatusLabel, budgetStatusTone, formatUsd, ruleLabel, scopeLabel } from "./labels";
import "./CostCenter.css";

function ToneText({ tone, label }: { tone: "ok" | "warn" | "bad" | "neutral"; label: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "bad" ? XCircle : tone === "warn" ? AlertTriangle : CircleDashed;
  return (
    <span className={`cc-status cc-status--${tone}`}>
      <Icon size={14} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

/** Same loading/error copy across every panel in this tab (mirrors OperationsTab's StateGate). */
function Gate({ state, onRetry, children }: { state: CostCenterState; onRetry: () => void; children: ReactNode }) {
  const { t } = useI18n();
  if (state === "loading") {
    return (
      <div role="status" aria-label={t("costCenter.loading")}>
        <Skeleton height={48} width="100%" />
      </div>
    );
  }
  if (state === "forbidden" || state === "unauthenticated") {
    return <ErrorState icon={<Lock size={24} />} title={t("costCenter.errorTitle")} description={t("costCenter.forbidden")} />;
  }
  if (state === "not_found") return <ErrorState title={t("costCenter.errorTitle")} description={t("costCenter.notFound")} />;
  if (state !== "ready") {
    return <ErrorState title={t("costCenter.errorTitle")} description={t("costCenter.errorDescription")} onRetry={onRetry} retryLabel={t("common.retry")} />;
  }
  return <>{children}</>;
}

export function CostCenterTab({ projectId }: { projectId: string }) {
  const { t, language } = useI18n();
  const cost = useProjectCostReport(projectId);
  const findings = useProjectAuditFindings(projectId);
  const governance = useProjectGovernancePolicy(projectId);

  const refreshAll = () => {
    cost.refetch();
    findings.refetch();
    governance.refetch();
  };

  return (
    <div className="cc">
      <div className="cc-toolbar">
        <p className="plan-muted">{t("costCenter.description")}</p>
        <Button variant="secondary" onClick={refreshAll}>
          <RefreshCw size={16} aria-hidden /> {t("costCenter.refresh")}
        </Button>
      </div>

      <section className="plan-section" aria-labelledby="cc-budget">
        <h3 id="cc-budget">
          <Wallet size={18} aria-hidden /> {t("costCenter.budgetTitle")}
        </h3>
        <Gate state={cost.state} onRetry={cost.refetch}>
          {!cost.data?.configured ? (
            <p className="plan-muted">{t("costCenter.notConfigured")}</p>
          ) : (
            <>
              <p>
                <ToneText tone={budgetStatusTone(cost.data.evaluation.status)} label={budgetStatusLabel(t, cost.data.evaluation.status)} />
              </p>
              <p className="plan-muted">{cost.data.evaluation.detail}</p>
              {cost.data.evaluation.scope || cost.data.evaluation.usedUsd !== undefined || cost.data.evaluation.limitUsd !== undefined ? (
                <dl className="plan-metrics">
                  {cost.data.evaluation.scope ? (
                    <div className="plan-metric">
                      <dt>{t("costCenter.scope")}</dt>
                      <dd>{scopeLabel(t, cost.data.evaluation.scope)}</dd>
                    </div>
                  ) : null}
                  {cost.data.evaluation.usedUsd !== undefined ? (
                    <div className="plan-metric">
                      <dt>{t("costCenter.used")}</dt>
                      <dd>{formatUsd(cost.data.evaluation.usedUsd)}</dd>
                    </div>
                  ) : null}
                  {cost.data.evaluation.limitUsd !== undefined ? (
                    <div className="plan-metric">
                      <dt>{t("costCenter.limit")}</dt>
                      <dd>{formatUsd(cost.data.evaluation.limitUsd)}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}

              {!cost.data.capabilities.enforcement ? (
                <p className="cc-notice" role="status">
                  <AlertTriangle size={14} aria-hidden /> {t("costCenter.enforcementInert")}
                </p>
              ) : (
                <p className="plan-muted">
                  <ShieldCheck size={14} aria-hidden /> {t("costCenter.enforcementActive", { count: cost.data.capabilities.providerIds.length })}
                </p>
              )}

              <h4>{t("costCenter.policyTitle")}</h4>
              {!cost.data.budgetPolicy ? (
                <p className="plan-muted">{t("costCenter.policyNotConfigured")}</p>
              ) : (
                <dl className="plan-metrics">
                  <div className="plan-metric">
                    <dt>{t("costCenter.dailyLimit")}</dt>
                    <dd>{cost.data.budgetPolicy.dailyLimitUsd !== undefined ? formatUsd(cost.data.budgetPolicy.dailyLimitUsd) : t("costCenter.noLimit")}</dd>
                  </div>
                  <div className="plan-metric">
                    <dt>{t("costCenter.monthlyLimit")}</dt>
                    <dd>{cost.data.budgetPolicy.monthlyLimitUsd !== undefined ? formatUsd(cost.data.budgetPolicy.monthlyLimitUsd) : t("costCenter.noLimit")}</dd>
                  </div>
                  <div className="plan-metric">
                    <dt>{t("costCenter.taskLimit")}</dt>
                    <dd>{cost.data.budgetPolicy.taskLimitUsd !== undefined ? formatUsd(cost.data.budgetPolicy.taskLimitUsd) : t("costCenter.noLimit")}</dd>
                  </div>
                  <div className="plan-metric">
                    <dt>{t("costCenter.warningThreshold")}</dt>
                    <dd>{t("costCenter.percentValue", { percent: cost.data.budgetPolicy.warningThresholdPercent })}</dd>
                  </div>
                  <div className="plan-metric">
                    <dt>{t("costCenter.hardStop")}</dt>
                    <dd>{cost.data.budgetPolicy.hardStop ? t("costCenter.yes") : t("costCenter.no")}</dd>
                  </div>
                </dl>
              )}

              <h4>{t("costCenter.usageTitle")}</h4>
              {cost.data.usage.length === 0 ? (
                <EmptyState title={t("costCenter.usageEmpty")} />
              ) : (
                <div className="cc-table-wrap">
                  <table className="cc-table">
                    <thead>
                      <tr>
                        <th scope="col">{t("costCenter.colProvider")}</th>
                        <th scope="col">{t("costCenter.colModel")}</th>
                        <th scope="col">{t("costCenter.colCost")}</th>
                        <th scope="col">{t("costCenter.colRecorded")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cost.data.usage.map((u) => (
                        <tr key={u.usageId}>
                          <td>{u.provider}</td>
                          <td><code>{u.model}</code></td>
                          <td>
                            {u.cost.priced ? (
                              formatUsd(u.cost.amountUsd)
                            ) : (
                              <span className="cc-unknown-cost" title={u.cost.reason}>
                                {t("costCenter.costUnknown")}
                              </span>
                            )}
                          </td>
                          <td>{formatDateTime(u.createdAt, language)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Gate>
      </section>

      <section className="plan-section" aria-labelledby="cc-governance">
        <h3 id="cc-governance">{t("costCenter.governanceTitle")}</h3>
        <Gate state={governance.state} onRetry={governance.refetch}>
          {!governance.data?.configured ? (
            <p className="plan-muted">{t("costCenter.governanceNotConfigured")}</p>
          ) : !governance.data.policy ? (
            <p className="plan-muted">{t("costCenter.governancePolicyNotSet")}</p>
          ) : (
            <dl className="plan-metrics">
              <div className="plan-metric">
                <dt>{t("costCenter.allowedProviders")}</dt>
                <dd>{governance.data.policy.allowedProviders?.length ? governance.data.policy.allowedProviders.join(", ") : t("costCenter.anyAllowed")}</dd>
              </div>
              <div className="plan-metric">
                <dt>{t("costCenter.allowedModels")}</dt>
                <dd>{governance.data.policy.allowedModels?.length ? governance.data.policy.allowedModels.join(", ") : t("costCenter.anyAllowed")}</dd>
              </div>
              <div className="plan-metric">
                <dt>{t("costCenter.approvalThreshold")}</dt>
                <dd>{governance.data.policy.requireApprovalAboveUsd !== undefined ? formatUsd(governance.data.policy.requireApprovalAboveUsd) : t("costCenter.noThreshold")}</dd>
              </div>
              <div className="plan-metric">
                <dt>{t("costCenter.allowUnknownCost")}</dt>
                <dd>{governance.data.policy.allowUnknownCost ? t("costCenter.yes") : t("costCenter.no")}</dd>
              </div>
            </dl>
          )}
        </Gate>
      </section>

      <section className="plan-section" aria-labelledby="cc-findings">
        <h3 id="cc-findings">{t("auditFindings.title")}</h3>
        <p className="plan-muted">{t("auditFindings.description")}</p>
        <Gate state={findings.state} onRetry={findings.refetch}>
          {!findings.data?.configured ? (
            <p className="plan-muted">{t("auditFindings.notConfigured")}</p>
          ) : (
            <>
              <p className="plan-muted">{t("auditFindings.generatedAt", { time: formatDateTime(findings.data.generatedAt, language) ?? "" })}</p>
              {findings.data.findings.length === 0 ? (
                <EmptyState
                  icon={<ShieldCheck size={28} />}
                  title={t("auditFindings.empty", { count: findings.data.rulesRun.length })}
                />
              ) : (
                <ul className="plan-rows">
                  {findings.data.findings.map((f) => (
                    <li key={f.findingId} className="plan-row plan-row--stacked">
                      <span>
                        <ToneText tone={auditSeverityTone(f.severity)} label={auditSeverityLabel(t, f.severity)} /> ·{" "}
                        {ruleLabel(t, f.ruleId)} (<code>{f.ruleId}</code>) · {f.subjectType} <code>{shortId(f.subjectId, 14)}</code>
                      </span>
                      <p className="plan-muted">{f.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Gate>
      </section>
    </div>
  );
}
