import { Wallet } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { EmptyState, ErrorState, Spinner } from "../../components/ui";
import { ProjectPicker } from "../../features/projectScope/ProjectPicker";
import { projectScopeFailureKey, useActiveProject } from "../../features/projectScope/useActiveProject";
import { useI18n } from "../../i18n";
import { CostCenterTab } from "../Projects/costCenter/CostCenterTab";
import "../Projects/ExecutionPlan.css";

/**
 * The Cost Center as a page of its own: the same authoritative, read-only view
 * the project page shows in its Cost Center tab, scoped to one project and
 * selectable from the URL.
 *
 * Every figure comes from the Control Plane. `configured: false` is shown as
 * "not configured" — never as zero spend or an unlimited budget — and unpriced
 * usage is shown as "cost unknown", never as $0.00. Nothing here is estimated
 * in the browser.
 */
export default function CostCenterPage() {
  const { t } = useI18n();
  const { projectId, projects, status, failed, loading, refetch, select } = useActiveProject();

  const picker = projectId ? (
    <ProjectPicker projects={projects} value={projectId} onChange={select} />
  ) : undefined;

  const header = (
    <PageHeader
      eyebrow={t("common.brand")}
      title={t("nav.costCenter")}
      description={t("costCenter.pageDescription")}
      actions={picker}
    />
  );

  if (loading) {
    return (
      <PageContainer variant="wide">
        {header}
        <Spinner />
      </PageContainer>
    );
  }

  if (failed) {
    return (
      <PageContainer variant="wide">
        {header}
        <ErrorState
          title={t("costCenter.errorTitle")}
          description={t(projectScopeFailureKey(status))}
          onRetry={refetch}
          retryLabel={t("common.retry")}
        />
      </PageContainer>
    );
  }

  if (!projectId) {
    return (
      <PageContainer variant="wide">
        {header}
        <EmptyState
          icon={<Wallet size={28} />}
          title={t("projectScope.noProjects")}
          description={t("projectScope.noProjectsDesc")}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer variant="wide">
      {header}
      <CostCenterTab projectId={projectId} />
    </PageContainer>
  );
}
