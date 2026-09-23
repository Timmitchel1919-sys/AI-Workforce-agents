import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ErrorState, Skeleton, StatusBadge } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useWorkflow } from "../../features/workflows";
import { WorkflowOverviewCard } from "./components/WorkflowOverviewCard";
import { WorkflowStages } from "./components/WorkflowStages";
import {
  formatStatusLabel,
  mapWorkflowStatusToBadge,
  workflowDisplayStatus,
} from "./components/workflowStatus";
import "../Tasks/TasksPage.css";
import "./WorkflowsPage.css";

function DetailHeader() {
  return (
    <PageHeader
      eyebrow="AI Workforce"
      title="Workflow Detail"
      description="Inspect workflow progress, stages, and participating agents."
    />
  );
}

export default function WorkflowDetailPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const { data: workflow, status, refetch } = useWorkflow(workflowId);

  if (status === "loading") {
    return (
      <PageContainer>
        <DetailHeader />
        <div className="tasks-loading" role="status" aria-live="polite" aria-label="Loading workflow">
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
          <h2>Workflow Not Found</h2>
          <p>
            The workflow with ID <code>{workflowId}</code> could not be found in the Control Plane
            or may have been removed.
          </p>
          <Link to="/workflows" className="ui-button primary">
            <ArrowLeft size={16} style={{ marginRight: 8 }} aria-hidden />
            Back to Workflows
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
          title={status === "unauthorized" ? "Unauthorized" : "Unable to load workflow"}
          description={
            status === "unauthorized"
              ? "You do not have permission to view this workflow."
              : "Failed to retrieve workflow information from the Control Plane."
          }
          onRetry={refetch}
          retryLabel="Retry"
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
          <div className="task-detail-header__nav">
            <Link to="/workflows" className="task-detail-header__back-link">
              <ArrowLeft size={16} aria-hidden />
              <span>Back to Workflows</span>
            </Link>
          </div>

          <div className="task-detail-header__main">
            <div className="task-detail-header__titles">
              <div className="task-detail-header__id-row">
                <span className="task-detail-header__id">ID: {workflow.workflowId}</span>
              </div>
              <h1 className="task-detail-header__title">{workflow.name}</h1>
            </div>

            <div className="task-detail-header__badges workflow-detail-header__badges">
              <StatusBadge status={mapWorkflowStatusToBadge(displayStatus)}>
                {formatStatusLabel(displayStatus)}
              </StatusBadge>
            </div>
          </div>
        </div>

        {workflow.paused ? (
          <div className="workflow-notice workflow-notice--warning" role="status">
            <strong>Paused.</strong> {workflow.pauseReason ?? "This workflow was paused by an operator."}
          </div>
        ) : null}

        {workflow.pendingApprovals > 0 ? (
          <div className="workflow-notice workflow-notice--warning" role="status">
            <strong>
              {workflow.pendingApprovals} pending approval
              {workflow.pendingApprovals === 1 ? "" : "s"}.
            </strong>{" "}
            This workflow is waiting on an operator decision before it can continue.
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
