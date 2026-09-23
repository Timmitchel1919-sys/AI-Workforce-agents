import { Link } from "react-router-dom";
import { Card } from "../../../components/ui";
import type { WorkflowView } from "../../../features/workflows";
import { WorkflowProgressBar } from "./WorkflowProgressBar";
import { formatDate } from "./workflowStatus";

export function WorkflowOverviewCard({ workflow }: { workflow: WorkflowView }) {
  const { progress } = workflow;
  const timestamps: Array<[string, string | undefined]> = [
    ["Started", workflow.startedAt],
    ["Last Updated", workflow.updatedAt],
    ["Completed", workflow.completedAt],
  ];

  return (
    <Card className="workflow-overview-card">
      <div className="task-card-header">
        <h2>Overview</h2>
      </div>

      <div className="task-overview-card__description">
        <span className="task-meta-label">Description</span>
        <p className="task-meta-value">{workflow.description}</p>
      </div>

      <div className="task-overview-card__description">
        <span className="task-meta-label">Progress</span>
        <WorkflowProgressBar progress={progress} />
        <span className="task-row__muted">
          {progress.completed} completed · {progress.failed} failed · {progress.blocked} blocked
        </span>
      </div>

      <div className="task-overview-card__grid">
        <div className="task-meta-item">
          <span className="task-meta-label">Project</span>
          <span className="task-meta-value task-meta-value--code">{workflow.projectId}</span>
        </div>

        <div className="task-meta-item">
          <span className="task-meta-label">Pending Approvals</span>
          <span className="task-meta-value">{workflow.pendingApprovals}</span>
        </div>

        {timestamps.map(([label, value]) =>
          value ? (
            <div key={label} className="task-meta-item">
              <span className="task-meta-label">{label}</span>
              <span className="task-meta-value">{formatDate(value)}</span>
            </div>
          ) : null,
        )}

        <div className="task-meta-item">
          <span className="task-meta-label">Participating Agents</span>
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
