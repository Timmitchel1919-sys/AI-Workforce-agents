import { useProjectGovernancePolicy } from "../../features/costCenter";
import { formatDateTime, useI18n } from "../../i18n";
import { formatUsd } from "../Projects/costCenter/labels";
import { GovernanceGate } from "./GovernanceGate";

/**
 * The governance policy the Control Plane actually evaluates for one project.
 *
 * Read-only: setting a policy is a separate, explicit admin command this page
 * does not expose. `configured: false` means the capability is not composed on
 * this deployment — distinct from a configured deployment with no policy set,
 * which the Control Plane reports as a null policy.
 */
export function GovernancePolicyPanel({ projectId }: { projectId: string }) {
  const { t, language } = useI18n();
  const governance = useProjectGovernancePolicy(projectId);

  return (
    <GovernanceGate state={governance.state} onRetry={governance.refetch}>
      {!governance.data?.configured ? (
        <p className="plan-muted">{t("costCenter.governanceNotConfigured")}</p>
      ) : !governance.data.policy ? (
        <p className="plan-muted">{t("costCenter.governancePolicyNotSet")}</p>
      ) : (
        <>
          <dl className="plan-metrics">
            <div className="plan-metric">
              <dt>{t("costCenter.allowedProviders")}</dt>
              <dd>
                {governance.data.policy.allowedProviders?.length
                  ? governance.data.policy.allowedProviders.join(", ")
                  : t("costCenter.anyAllowed")}
              </dd>
            </div>
            <div className="plan-metric">
              <dt>{t("costCenter.allowedModels")}</dt>
              <dd>
                {governance.data.policy.allowedModels?.length
                  ? governance.data.policy.allowedModels.join(", ")
                  : t("costCenter.anyAllowed")}
              </dd>
            </div>
            <div className="plan-metric">
              <dt>{t("costCenter.approvalThreshold")}</dt>
              <dd>
                {governance.data.policy.requireApprovalAboveUsd !== undefined
                  ? formatUsd(governance.data.policy.requireApprovalAboveUsd)
                  : t("costCenter.noThreshold")}
              </dd>
            </div>
            <div className="plan-metric">
              <dt>{t("costCenter.allowUnknownCost")}</dt>
              <dd>{governance.data.policy.allowUnknownCost ? t("costCenter.yes") : t("costCenter.no")}</dd>
            </div>
          </dl>
          <p className="plan-muted">
            {t("governance.policyUpdated", {
              date: formatDateTime(governance.data.policy.updatedAt, language) ?? "",
              actor: governance.data.policy.updatedBy,
            })}
          </p>
        </>
      )}
    </GovernanceGate>
  );
}
