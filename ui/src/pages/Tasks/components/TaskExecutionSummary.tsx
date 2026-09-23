import { Link } from "react-router-dom";
import { formatDateTime, translateStatus, useI18n } from "../../../i18n";
import { Card } from "../../../components/ui";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import type { Status } from "../../../components/ui/StatusBadge";
import type { TaskExecutionSummary as TaskExecutionSummaryType } from "../../../features/tasks";

function mapExecutionStatusToBadge(status: TaskExecutionSummaryType["status"]): Status {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "pending":
      return "pending";
    case "cancelled":
      return "offline";
    default:
      return "idle";
  }
}

export interface TaskExecutionSummaryProps {
  executionSummary?: TaskExecutionSummaryType;
}

export function TaskExecutionSummary({ executionSummary }: TaskExecutionSummaryProps) {
  const { t, language } = useI18n();
  const formatDate = (value: string) => formatDateTime(value, language) ?? value;
  return (
    <Card className="task-execution-summary-card">
      <div className="task-card-header">
        <h2>{t("tasks.execution")}</h2>
      </div>

      <div className="task-execution-summary-card__body">
        {!executionSummary ? (
          <p className="task-meta-value task-meta-value--muted">
            {t("tasks.noExecution")}
          </p>
        ) : (
          <div className="task-execution-details">
            <div className="task-execution-grid">
              <div className="task-meta-item">
                <span className="task-meta-label">{t("tasks.executionId")}</span>
                <span className="task-meta-value task-meta-value--code">
                  {executionSummary.executionId}
                </span>
              </div>

              <div className="task-meta-item">
                <span className="task-meta-label">{t("tasks.executionStatus")}</span>
                <StatusBadge status={mapExecutionStatusToBadge(executionSummary.status)}>
                  {translateStatus(t, executionSummary.status)}
                </StatusBadge>
              </div>

              {executionSummary.agentName ? (
                <div className="task-meta-item">
                  <span className="task-meta-label">{t("tasks.assignedAgent")}</span>
                  {executionSummary.agentId ? (
                    <Link to={`/agents/${executionSummary.agentId}`} className="task-context-link">
                      {executionSummary.agentName}
                    </Link>
                  ) : (
                    <span className="task-meta-value">{executionSummary.agentName}</span>
                  )}
                </div>
              ) : null}

              {executionSummary.duration ? (
                <div className="task-meta-item">
                  <span className="task-meta-label">{t("tasks.duration")}</span>
                  <span className="task-meta-value">{executionSummary.duration}</span>
                </div>
              ) : null}

              {executionSummary.startedAt ? (
                <div className="task-meta-item">
                  <span className="task-meta-label">{t("common.started")}</span>
                  <span className="task-meta-value">{formatDate(executionSummary.startedAt)}</span>
                </div>
              ) : null}

              {executionSummary.completedAt ? (
                <div className="task-meta-item">
                  <span className="task-meta-label">{t("common.completed")}</span>
                  <span className="task-meta-value">{formatDate(executionSummary.completedAt)}</span>
                </div>
              ) : null}
            </div>

            {executionSummary.resultSummary ? (
              <div className="task-execution-result">
                <span className="task-meta-label">{t("tasks.resultSummary")}</span>
                <div className="task-execution-result-box">
                  <p>{executionSummary.resultSummary}</p>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Card>
  );
}

export default TaskExecutionSummary;

