import PageSection from "../../components/layout/PageSection";
import { useI18n } from "../../i18n";
import { GovernanceApprovalsPanel } from "./GovernanceApprovalsPanel";
import { GovernanceAuditPanel } from "./GovernanceAuditPanel";
import { GovernancePolicyPanel } from "./GovernancePolicyPanel";

/**
 * The governance posture of one project: the policy the Control Plane
 * evaluates, what is currently waiting for a human decision, and what has been
 * recorded. Every panel reads from the Control Plane — nothing is derived here.
 */
export function GovernancePosture({ projectId }: { projectId: string }) {
  const { t } = useI18n();

  return (
    <>
      <PageSection
        title={t("costCenter.governanceTitle")}
        description={t("governance.policyPanelDescription")}
      >
        <GovernancePolicyPanel projectId={projectId} />
      </PageSection>

      <PageSection
        title={t("governance.approvalsTitle")}
        description={t("governance.approvalsDescription")}
      >
        <GovernanceApprovalsPanel projectId={projectId} />
      </PageSection>

      <PageSection title={t("governance.auditTitle")} description={t("governance.auditDescription")}>
        <GovernanceAuditPanel projectId={projectId} />
      </PageSection>
    </>
  );
}
