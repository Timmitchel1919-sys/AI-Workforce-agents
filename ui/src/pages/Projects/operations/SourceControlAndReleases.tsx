/**
 * Governed source control + deployments. CHANGED ≠ COMMITTED ≠ PUSHED ≠
 * DEPLOYED ≠ HEALTHY: each is its own row type with its own label, and a
 * release is only "Healthy" when the backend verified it.
 */
import { AlertTriangle, GitBranch, Rocket, ShieldAlert } from "lucide-react";
import type { ProjectReleases } from "../../../features/operations";
import { useI18n } from "../../../i18n";
import { StatusText } from "./OperationsTab";
import { releaseStatusLabel, shortId, targetClassLabel } from "./labels";

export function SourceControlAndReleases({ data }: { data: ProjectReleases }) {
  const { t } = useI18n();
  const sc = data.sourceControl;
  const dep = data.deployments;
  return (
    <>
      <section className="plan-section" aria-labelledby="ops-git">
        <h3 id="ops-git">
          <GitBranch size={18} aria-hidden /> {t("operations.gitTitle")}
        </h3>
        {!sc.configured ? (
          <p className="plan-muted">{t("operations.gitNotConfigured")}</p>
        ) : (
          <div className="ops-columns">
            <div>
              <h4>{t("operations.reviews")}</h4>
              {sc.reviews.length === 0 ? (
                <p className="plan-muted">{t("operations.none")}</p>
              ) : (
                <ul className="plan-rows">
                  {sc.reviews.map((r) => (
                    <li key={r.reviewId} className="plan-row">
                      <code>{shortId(r.changeSetId, 14)}</code> {r.status} · {r.reviewerKind}: {r.reviewerId}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h4>{t("operations.commits")}</h4>
              {sc.commits.length === 0 ? (
                <p className="plan-muted">{t("operations.none")}</p>
              ) : (
                <ul className="plan-rows">
                  {sc.commits.map((c) => (
                    <li key={c.receiptId} className="plan-row plan-row--stacked">
                      <span>
                        <code>{c.commitSha.slice(0, 12)}</code> · {c.branch}
                      </span>
                      <p className="plan-muted">{c.message.split("\n")[0]}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h4>{t("operations.pushes")}</h4>
              {sc.pushes.length === 0 ? (
                <p className="plan-muted">{t("operations.none")}</p>
              ) : (
                <ul className="plan-rows">
                  {sc.pushes.map((p) => (
                    <li key={p.receiptId} className="plan-row plan-row--stacked">
                      <span>
                        <code>{p.commitSha.slice(0, 12)}</code> → {p.branch}
                      </span>
                      {p.pullRequestRequired ? <p className="plan-muted">{t("operations.prRequired")}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h4>{t("operations.pullRequests")}</h4>
              {sc.pullRequests.length === 0 ? (
                <p className="plan-muted">{t("operations.none")}</p>
              ) : (
                <ul className="plan-rows">
                  {sc.pullRequests.map((pr) => (
                    <li key={pr.pullRequestId} className="plan-row plan-row--stacked">
                      <span>
                        #{pr.number ?? "?"} {pr.sourceBranch} → {pr.targetBranch} · {pr.status}
                      </span>
                      <p className="plan-muted">{t("operations.checks", { state: pr.checks })}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="plan-section" aria-labelledby="ops-deploy">
        <h3 id="ops-deploy">
          <Rocket size={18} aria-hidden /> {t("operations.deployTitle")}
        </h3>
        {!dep.configured ? (
          <p className="plan-muted">{t("operations.deployNotConfigured")}</p>
        ) : dep.releases.length === 0 ? (
          <p className="plan-muted">{t("operations.deployNone")}</p>
        ) : (
          <ul className="plan-rows">
            {dep.releases.map((r) => (
              <li key={r.releaseId} className="plan-row plan-row--stacked">
                <span className="ops-release-head">
                  {r.targetClass === "production" ? (
                    <strong className="ops-production">
                      <ShieldAlert size={14} aria-hidden /> {t("operations.productionMarker")}
                    </strong>
                  ) : (
                    <span className="ops-target-class">{targetClassLabel(t, r.targetClass)}</span>
                  )}
                  <span>
                    {t("operations.target")}: <code>{r.targetId}</code>
                  </span>
                  <code>{r.commitSha.slice(0, 12)}</code>
                  <StatusText value={r.status} label={releaseStatusLabel(t, r.status)} />
                  {r.simulated ? <span className="plan-muted">{t("operations.simulated")}</span> : null}
                </span>
                {r.postDeploy && !r.postDeploy.versionMatches ? (
                  <p className="ops-warning">
                    <AlertTriangle size={14} aria-hidden /> {t("operations.versionMismatch")}
                  </p>
                ) : null}
                {r.rollback ? <p className="plan-muted">{t("operations.rolledBackTo", { id: r.rollback.toReleaseId })}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
