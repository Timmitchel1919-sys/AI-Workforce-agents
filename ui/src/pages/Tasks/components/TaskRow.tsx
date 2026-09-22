import { Link } from "react-router-dom";
import { Badge, StatusBadge } from "../../../components/ui";
import type { Status } from "../../../components/ui/StatusBadge";
import type { TaskListItem, TaskPriority, TaskStatus } from "../../../features/tasks";

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

export function TaskRow({ task }: { task: TaskListItem }) {
  const taskHref = `/tasks/${task.id}`;

  return (
    <tr className="task-row">
      <td className="task-row__cell task-row__cell--primary">
        <Link to={taskHref} className="task-row__link" aria-label={`View details for ${task.title}`}>
          <div className="task-row__name-block">
            <span className="task-row__name">{task.title}</span>
            {task.description ? <span className="task-row__description">{task.description}</span> : null}
          </div>
        </Link>
      </td>
      <td className="task-row__cell">
        <StatusBadge status={mapTaskStatusToBadge(task.status)}>{task.status}</StatusBadge>
      </td>
      <td className="task-row__cell">
        {task.priority ? (
          <Badge variant={mapPriorityToBadgeVariant(task.priority)}>
            {task.priority.toUpperCase()}
          </Badge>
        ) : (
          <span className="task-row__muted">—</span>
        )}
      </td>
      <td className="task-row__cell task-row__cell--muted">
        {task.agentName ? (
          task.agentId ? (
            <Link to={`/agents/${task.agentId}`} className="task-row__agent-link">
              {task.agentName}
            </Link>
          ) : (
            task.agentName
          )
        ) : (
          "Unassigned"
        )}
      </td>
      <td className="task-row__cell task-row__cell--muted">{task.projectName ?? task.type ?? "General"}</td>
      <td className="task-row__cell task-row__cell--muted">
        {task.updatedAt ? new Date(task.updatedAt).toLocaleString() : new Date(task.createdAt).toLocaleString()}
      </td>
    </tr>
  );
}

export default TaskRow;

