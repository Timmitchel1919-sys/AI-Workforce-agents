import { Link } from "react-router-dom";
import { Bot, FolderKanban, GitBranch } from "lucide-react";
import { Card } from "../../../components/ui";

export interface TaskContextCardProps {
  agentId?: string;
  agentName?: string;
  projectId?: string;
  projectName?: string;
  workflowId?: string;
  workflowName?: string;
}

export function TaskContextCard({
  agentId,
  agentName,
  projectId,
  projectName,
  workflowId,
  workflowName,
}: TaskContextCardProps) {
  const hasRelationships = Boolean(agentName || projectName || workflowName);

  return (
    <Card className="task-context-card">
      <div className="task-card-header">
        <h2>Task Context & Relationships</h2>
      </div>

      <div className="task-context-card__body">
        {!hasRelationships ? (
          <p className="task-meta-value task-meta-value--muted">
            No agent, project, or workflow context associated with this task.
          </p>
        ) : (
          <div className="task-context-list">
            {agentName ? (
              <div className="task-context-item">
                <div className="task-context-icon">
                  <Bot size={18} aria-hidden />
                </div>
                <div className="task-context-info">
                  <span className="task-meta-label">Assigned Agent</span>
                  {agentId ? (
                    <Link to={`/agents/${agentId}`} className="task-context-link">
                      {agentName}
                    </Link>
                  ) : (
                    <span className="task-meta-value">{agentName}</span>
                  )}
                </div>
              </div>
            ) : null}

            {projectName ? (
              <div className="task-context-item">
                <div className="task-context-icon">
                  <FolderKanban size={18} aria-hidden />
                </div>
                <div className="task-context-info">
                  <span className="task-meta-label">Project</span>
                  {projectId ? (
                    <Link to={`/projects`} className="task-context-link">
                      {projectName}
                    </Link>
                  ) : (
                    <span className="task-meta-value">{projectName}</span>
                  )}
                </div>
              </div>
            ) : null}

            {workflowName ? (
              <div className="task-context-item">
                <div className="task-context-icon">
                  <GitBranch size={18} aria-hidden />
                </div>
                <div className="task-context-info">
                  <span className="task-meta-label">Workflow</span>
                  {workflowId ? (
                    <Link to={`/workflows`} className="task-context-link">
                      {workflowName}
                    </Link>
                  ) : (
                    <span className="task-meta-value">{workflowName}</span>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Card>
  );
}

export default TaskContextCard;

