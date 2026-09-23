import { Link } from "react-router-dom";
import { Card } from "../../../components/ui";
import type { WorkflowView } from "../../../features/workflows";
import { WorkflowProgressBar } from "./WorkflowProgressBar";
import { formatDateTime, useI18n, type MessageKey } from "../../../i18n";

export function WorkflowOverviewCard({ workflow }: { workflow: WorkflowView }) {
  const { t, language } = useI18n();
  const { progress } = workflow;
  const timestamps: Array<[MessageKey, string | undefined]> = [
    ["common.started", workflow.startedAt],
    ["workflows.lastUpdated", workflow.updatedAt],
    ["common.completed", workflow.completedAt],
  ];

  return (
    <Card className="workflow-overview-card">
      <div className="task-card-header">
        <h2>{t("workflows.overview")}</h2>
      </div>

      <div className="task-overview-card__description">
        <span className="task-meta-label">{t("workflows.workflowDescription")}</span>
        <p className="task-meta-value">{workflow.description}</p>
      </div>

      <div className="task-overview-card__description">
        <span className="task-meta-label">{t("workflows.progress")}</span>
        <WorkflowProgressBar progress={progress} />
        <span className="task-row__muted">
          {t("workflows.progressBreakdown", { completed: progress.completed, failed: progress.failed, blocked: progress.blocked })}
        </span>
      </div>

      <div className="task-overview-card__grid">
        <div className="task-meta-item">
          <span className="task-meta-label">{t("common.project")}</span>
          <span className="task-meta-value task-meta-value--code">{workflow.projectId}</span>
        </div>

        <div className="task-meta-item">
          <span className="task-meta-label">{t("workflows.pendingApprovals")}</span>
          <span className="task-meta-value">{workflow.pendingApprovals}</span>
        </div>

        {timestamps.map(([label, value]) =>
          value ? (
            <div key={label} className="task-meta-item">
              <span className="task-meta-label">{t(label)}</span>
              <span className="task-meta-value">{formatDateTime(value, language)}</span>
            </div>
          ) : null,
        )}

        <div className="task-meta-item">
          <span className="task-meta-label">{t("workflows.participatingAgents")}</span>
          <span className="task-meta-value workflow-agent-list">
            {workflow.participatingAgents.length === 0
              ? "—"
              : workflow.participatingAgents.map((agentId) => (
                  <Link key={agentId} to={`/agents/${agentId}`} className="task-row__agent-link">
                    {agentId}
                  </Link>
                ))}
          </span>
        </div>
      </div>
    </Card>
  );
}

export default WorkflowOverviewCard;
