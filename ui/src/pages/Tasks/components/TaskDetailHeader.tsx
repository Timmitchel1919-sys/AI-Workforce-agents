import { Link } from "react-router-dom";
import { translatePriority, translateStatus, useI18n } from "../../../i18n";
import { ArrowLeft } from "lucide-react";
import { Badge, StatusBadge } from "../../../components/ui";
import type { Status } from "../../../components/ui/StatusBadge";
import type { TaskPriority, TaskStatus } from "../../../features/tasks";

function mapTaskStatusToBadge(status: TaskStatus): Status {
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

function mapPriorityToBadgeVariant(
  priority?: TaskPriority,
): "neutral" | "info" | "warning" | "danger" {
  switch (priority) {
    case "low":
      return "neutral";
    case "medium":
      return "info";
    case "high":
      return "warning";
    case "critical":
    case "urgent":
      return "danger";
    default:
      return "neutral";
  }
}

export interface TaskDetailHeaderProps {
  taskId: string;
  title: string;
  status: TaskStatus;
  priority?: TaskPriority;
}

export function TaskDetailHeader({
  taskId,
  title,
  status,
  priority,
}: TaskDetailHeaderProps) {
  const { t } = useI18n();
  return (
    <div className="task-detail-header">
      <div className="task-detail-header__nav">
        <Link to="/tasks" className="task-detail-header__back-link">
          <ArrowLeft size={16} aria-hidden />
          <span>{t("tasks.backToTasks")}</span>
        </Link>
      </div>

      <div className="task-detail-header__main">
        <div className="task-detail-header__titles">
          <div className="task-detail-header__id-row">
            <span className="task-detail-header__id">{t("common.idLabel", { id: taskId })}</span>
          </div>
          <h1 className="task-detail-header__title">{title}</h1>
        </div>

        <div className="task-detail-header__badges">
          <StatusBadge status={mapTaskStatusToBadge(status)}>{translateStatus(t, status)}</StatusBadge>
          {priority ? (
            <Badge variant={mapPriorityToBadgeVariant(priority)}>
              {t("tasks.priorityLabel", { priority: translatePriority(t, priority) })}
            </Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default TaskDetailHeader;

