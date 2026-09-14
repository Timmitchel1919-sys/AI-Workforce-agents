import type { TaskView } from "../../api/contracts";

export interface TasksSummaryData {
  total: number;
  running: number;
  queued: number;
  awaitingApproval: number;
  attention: number;
  completed: number;
}

export function sortTasksByUpdated(tasks: readonly TaskView[]): TaskView[] {
  return [...tasks].sort((a, b) => {
    const time = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    return time || a.taskId.localeCompare(b.taskId);
  });
}

export function summarizeTasks(
  tasks: readonly TaskView[],
  total = tasks.length,
): TasksSummaryData {
  const count = (status: string) =>
    tasks.filter((task) => task.status === status).length;
  return {
    total,
    running: count("running"),
    queued: count("queued"),
    awaitingApproval: count("awaiting_approval"),
    attention: tasks.filter(
      (task) => task.status === "failed" || task.status === "blocked",
    ).length,
    completed: count("completed"),
  };
}

export function priorityTone(
  priority: string,
): "neutral" | "info" | "warning" | "danger" {
  switch (priority.toLowerCase()) {
    case "critical":
    case "urgent":
      return "danger";
    case "high":
      return "warning";
    case "low":
      return "neutral";
    default:
      return "info";
  }
}
