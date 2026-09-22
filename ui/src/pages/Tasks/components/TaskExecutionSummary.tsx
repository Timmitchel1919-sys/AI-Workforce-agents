import { Link } from "react-router-dom";
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

function formatDate(isoString?: string): string | null {
  if (!isoString) return null;
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? isoString : date.toLocaleString();
}

export interface TaskExecutionSummaryProps {
  executionSummary?: TaskExecutionSummaryType;
}

export function TaskExecutionSummary({ executionSummary }: TaskExecutionSummaryProps) {
  return (
    <Card className="task-execution-summary-card">
      <div className="task-card-header">
        <h2>Execution Summary</h2>
      </div>

      <div className="task-execution-summary-card__body">
        {!executionSummary ? (
          <p className="task-meta-value task-meta-value--muted">
            No execution summary data available for this task.
          </p>
        ) : (
          <div className="task-execution-details">
            <div className="task-execution-grid">
              <div className="task-meta-item">
                <span className="task-meta-label">Execution ID</span>
                <span className="task-meta-value task-meta-value--code">
                  {executionSummary.executionId}
                </span>
              </div>

              <div className="task-meta-item">
                <span className="task-meta-label">Execution Status</span>
                <StatusBadge status={mapExecutionStatusToBadge(executionSummary.status)}>
                  {executionSummary.status}
                </StatusBadge>
              </div>

              {executionSummary.agentName ? (
                <div className="task-meta-item">
                  <span className="task-meta-label">Assigned Agent</span>
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
                  <span className="task-meta-label">Duration</span>
                  <span className="task-meta-value">{executionSummary.duration}</span>
                </div>
              ) : null}

              {executionSummary.startedAt ? (
                <div className="task-meta-item">
                  <span className="task-meta-label">Started</span>
                  <span className="task-meta-value">{formatDate(executionSummary.startedAt)}</span>
                </div>
              ) : null}

              {executionSummary.completedAt ? (
                <div className="task-meta-item">
                  <span className="task-meta-label">Completed</span>
                  <span className="task-meta-value">{formatDate(executionSummary.completedAt)}</span>
                </div>
              ) : null}
            </div>

            {executionSummary.resultSummary ? (
              <div className="task-execution-result">
                <span className="task-meta-label">Result Summary</span>
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

