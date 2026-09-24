import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ErrorState, Skeleton, StatusBadge } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useWorkflow } from "../../features/workflows";
import { WorkflowOverviewCard } from "./components/WorkflowOverviewCard";
import { WorkflowStages } from "./components/WorkflowStages";
import { mapWorkflowStatusToBadge, workflowDisplayStatus } from "./components/workflowStatus";
import { translateStatus, useI18n } from "../../i18n";
import "../Tasks/TasksPage.css";
import "./WorkflowsPage.css";

function DetailHeader() {
  const { t } = useI18n();
  return (
    <PageHeader
      eyebrow={t("common.brand")}
      title={t("workflows.detailTitle")}
      description={t("workflows.detailDescription")}
    />
  );
}

export default function WorkflowDetailPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const { t } = useI18n();
  const { data: workflow, status, refetch } = useWorkflow(workflowId);

  if (status === "loading") {
    return (
      <PageContainer>
        <DetailHeader />
        <div className="tasks-loading" role="status" aria-live="polite" aria-label={t("common.loading")}>
          <Skeleton height={28} width="40%" />
          <div className="task-detail-grid">
            <Skeleton height={240} width="100%" />
            <Skeleton height={240} width="100%" />
          </div>
        </div>
      </PageContainer>
    );
  }

  if (status === "not_found" || (status === "ready" && !workflow)) {
    return (
      <PageContainer>
        <DetailHeader />
        <div className="task-not-found">
          <h2>{t("workflows.notFoundTitle")}</h2>
          <p>{t("workflows.notFoundDescription", { id: workflowId ?? "" })}</p>
          <Link to="/workflows" className="ui-button primary">
            <ArrowLeft size={16} style={{ marginRight: 8 }} aria-hidden />
            {t("workflows.backToWorkflows")}
          </Link>
        </div>
      </PageContainer>
    );
  }

  if (!workflow) {
    return (
      <PageContainer>
        <DetailHeader />
        <ErrorState
          title={status === "unauthorized" ? t("workflows.unauthorizedTitle") : t("workflows.detailErrorTitle")}
          description={
            status === "unauthorized"
              ? t("workflows.detailUnauthorizedDescription")
              : t("workflows.detailErrorDescription")
          }
          onRetry={refetch}
          retryLabel={t("common.retry")}
        />
      </PageContainer>
    );
  }

  const displayStatus = workflowDisplayStatus(workflow);

  return (
    <PageContainer>
      <DetailHeader />

      <div className="task-detail-page">
        <div className="task-detail-header">
          <div className="task-detail-header__main">
            <div className="task-detail-header__titles">
              <div className="task-detail-header__id-row">
                <span className="task-detail-header__id">{t("common.idLabel", { id: workflow.workflowId })}</span>
              </div>
              <h1 className="task-detail-header__title">{workflow.name}</h1>
            </div>

            <div className="task-detail-header__badges workflow-detail-header__badges">
              <StatusBadge status={mapWorkflowStatusToBadge(displayStatus)}>
                {translateStatus(t, displayStatus)}
              </StatusBadge>
            </div>
          </div>
        </div>

        {workflow.paused ? (
          <div className="workflow-notice workflow-notice--warning" role="status">
            <strong>{t("workflows.pausedNotice")}</strong> {workflow.pauseReason ?? t("workflows.pausedDefault")}
          </div>
        ) : null}

        {workflow.pendingApprovals > 0 ? (
          <div className="workflow-notice workflow-notice--warning" role="status">
            <strong>
              {workflow.pendingApprovals === 1
                ? t("workflows.pendingNoticeOne")
                : t("workflows.pendingNoticeMany", { count: workflow.pendingApprovals })}
            </strong>{" "}
            {t("workflows.pendingNoticeDetail")}
          </div>
        ) : null}

        {workflow.error ? (
          <div className="workflow-notice workflow-notice--danger" role="alert">
            {workflow.error}
          </div>
        ) : null}

        <div className="task-detail-grid">
          <div className="task-detail-column">
            <WorkflowOverviewCard workflow={workflow} />
          </div>
          <div className="task-detail-column">
            <WorkflowStages stages={workflow.stages} currentSpecId={workflow.currentSpecId} />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
