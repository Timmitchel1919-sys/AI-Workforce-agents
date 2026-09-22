import { Card } from "../../../components/ui";

export interface TaskOverviewCardProps {
  description?: string;
  type?: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  dueAt?: string;
}

function formatDate(isoString?: string): string | null {
  if (!isoString) return null;
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? isoString : date.toLocaleString();
}

export function TaskOverviewCard({
  description,
  type,
  createdAt,
  updatedAt,
  startedAt,
  completedAt,
  dueAt,
}: TaskOverviewCardProps) {
  const formattedCreated = formatDate(createdAt);
  const formattedUpdated = formatDate(updatedAt);
  const formattedStarted = formatDate(startedAt);
  const formattedCompleted = formatDate(completedAt);
  const formattedDue = formatDate(dueAt);

  return (
    <Card className="task-overview-card">
      <div className="task-card-header">
        <h2>Overview</h2>
      </div>

      <div className="task-overview-card__body">
        {description ? (
          <div className="task-overview-card__description">
            <span className="task-meta-label">Description</span>
            <p className="task-meta-value">{description}</p>
          </div>
        ) : null}

        <div className="task-overview-card__grid">
          {type ? (
            <div className="task-meta-item">
              <span className="task-meta-label">Task Type</span>
              <span className="task-meta-value">{type}</span>
            </div>
          ) : null}

          {formattedCreated ? (
            <div className="task-meta-item">
              <span className="task-meta-label">Created</span>
              <span className="task-meta-value">{formattedCreated}</span>
            </div>
          ) : null}

          {formattedUpdated ? (
            <div className="task-meta-item">
              <span className="task-meta-label">Last Updated</span>
              <span className="task-meta-value">{formattedUpdated}</span>
            </div>
          ) : null}

          {formattedStarted ? (
            <div className="task-meta-item">
              <span className="task-meta-label">Started</span>
              <span className="task-meta-value">{formattedStarted}</span>
            </div>
          ) : null}

          {formattedCompleted ? (
            <div className="task-meta-item">
              <span className="task-meta-label">Completed</span>
              <span className="task-meta-value">{formattedCompleted}</span>
            </div>
          ) : null}

          {formattedDue ? (
            <div className="task-meta-item">
              <span className="task-meta-label">Due Date</span>
              <span className="task-meta-value">{formattedDue}</span>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export default TaskOverviewCard;

