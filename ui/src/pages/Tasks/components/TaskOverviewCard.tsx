import { Card } from "../../../components/ui";
import { formatDateTime, useI18n } from "../../../i18n";

export interface TaskOverviewCardProps {
  description?: string;
  type?: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  dueAt?: string;
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
  const { t, language } = useI18n();
  const formatDate = (value?: string) => formatDateTime(value, language);
  const formattedCreated = formatDate(createdAt);
  const formattedUpdated = formatDate(updatedAt);
  const formattedStarted = formatDate(startedAt);
  const formattedCompleted = formatDate(completedAt);
  const formattedDue = formatDate(dueAt);

  return (
    <Card className="task-overview-card">
      <div className="task-card-header">
        <h2>{t("tasks.overview")}</h2>
      </div>

      <div className="task-overview-card__body">
        {description ? (
          <div className="task-overview-card__description">
            <span className="task-meta-label">{t("tasks.taskDescription")}</span>
            <p className="task-meta-value">{description}</p>
          </div>
        ) : null}

        <div className="task-overview-card__grid">
          {type ? (
            <div className="task-meta-item">
              <span className="task-meta-label">{t("tasks.taskType")}</span>
              <span className="task-meta-value">{type}</span>
            </div>
          ) : null}

          {formattedCreated ? (
            <div className="task-meta-item">
              <span className="task-meta-label">{t("common.created")}</span>
              <span className="task-meta-value">{formattedCreated}</span>
            </div>
          ) : null}

          {formattedUpdated ? (
            <div className="task-meta-item">
              <span className="task-meta-label">{t("tasks.lastUpdated")}</span>
              <span className="task-meta-value">{formattedUpdated}</span>
            </div>
          ) : null}

          {formattedStarted ? (
            <div className="task-meta-item">
              <span className="task-meta-label">{t("common.started")}</span>
              <span className="task-meta-value">{formattedStarted}</span>
            </div>
          ) : null}

          {formattedCompleted ? (
            <div className="task-meta-item">
              <span className="task-meta-label">{t("common.completed")}</span>
              <span className="task-meta-value">{formattedCompleted}</span>
            </div>
          ) : null}

          {formattedDue ? (
            <div className="task-meta-item">
              <span className="task-meta-label">{t("tasks.dueDate")}</span>
              <span className="task-meta-value">{formattedDue}</span>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export default TaskOverviewCard;

