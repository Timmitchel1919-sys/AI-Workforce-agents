import { Card } from "../../../components/ui";
import { formatDateTime, translateStatus, useI18n } from "../../../i18n";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import type { Status } from "../../../components/ui/StatusBadge";
import type { TaskLifecycleEvent, TaskStatus } from "../../../features/tasks";

function mapTaskStatusToBadge(status?: TaskStatus): Status {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "queued":
    case "pending":
      return "pending";
    case "paused":
      return "paused";
    case "blocked":
      return "blocked";
    case "cancelled":
      return "offline";
    default:
      return "idle";
  }
}

export interface TaskTimelineProps {
  timeline?: TaskLifecycleEvent[];
}

export function TaskTimeline({ timeline }: TaskTimelineProps) {
  const { t, language } = useI18n();
  const formatDate = (value: string) => formatDateTime(value, language) ?? value;
  const events = timeline ?? [];
  const hasEvents = events.length > 0;

  return (
    <Card className="task-timeline-card">
      <div className="task-card-header">
        <h2>{t("tasks.timeline")}</h2>
      </div>

      <div className="task-timeline-card__body">
        {!hasEvents ? (
          <div className="task-timeline-empty">
            <p className="task-meta-value task-meta-value--muted">
              {t("tasks.noTimeline")}
            </p>
          </div>
        ) : (
          <ol className="task-timeline">
            {events.map((item, index) => {
              const isLast = index === events.length - 1;
              return (
                <li key={item.id || index} className={`task-timeline__item ${isLast ? "task-timeline__item--last" : ""}`}>
                  <div className="task-timeline__marker" aria-hidden />
                  <div className="task-timeline__content">
                    <div className="task-timeline__header">
                      <span className="task-timeline__event-name">{item.event}</span>
                      {item.status ? (
                        <StatusBadge status={mapTaskStatusToBadge(item.status)}>
                          {translateStatus(t, item.status)}
                        </StatusBadge>
                      ) : null}
                    </div>

                    <time className="task-timeline__time" dateTime={item.timestamp}>
                      {formatDate(item.timestamp)}
                    </time>

                    {item.details ? (
                      <p className="task-timeline__details">{item.details}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}

export default TaskTimeline;

