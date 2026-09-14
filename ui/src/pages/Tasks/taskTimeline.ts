import type { AuditEventView, TaskView } from "../../api/contracts";

export interface TaskTimelineEntry {
  id: string;
  timestamp: string;
  title: string;
  detail: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
}

const EVENT_LABELS: Record<string, string> = {
  task_created: "Task created",
  task_assigned: "Agent assigned",
  task_resumed: "Execution resumed",
  agent_executed: "Agent execution started",
  approval_requested: "Approval requested",
  approval_decided: "Approval decision recorded",
  permission_decision: "Permission evaluated",
  handoff_created: "Handoff created",
  task_completed: "Task completed",
  task_failed: "Task failed",
  control_command: "Operator command recorded",
};

function eventTone(event: AuditEventView): TaskTimelineEntry["tone"] {
  if (event.type === "task_completed") return "success";
  if (event.type === "task_failed" || event.outcome === "denied")
    return "danger";
  if (event.type === "approval_requested") return "warning";
  if (event.type === "task_created" || event.type === "task_assigned")
    return "info";
  return "neutral";
}

function eventDetail(event: AuditEventView): string {
  if (event.type === "task_assigned" && event.agentId) {
    return `Assigned to ${event.agentId}`;
  }
  if (event.type === "permission_decision") {
    return event.outcome
      ? `Decision: ${event.outcome}`
      : "Permission decision recorded";
  }
  if (event.outcome) return `Outcome: ${event.outcome}`;
  if (event.actor) return `Actor: ${event.actor}`;
  return "Recorded in the governed audit trail";
}

export function buildTaskTimeline(
  task: TaskView,
  events: readonly AuditEventView[],
): TaskTimelineEntry[] {
  const entries = events
    .filter((event) => event.taskId === task.taskId)
    .map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      title: EVENT_LABELS[event.type] ?? event.type.replaceAll("_", " "),
      detail: eventDetail(event),
      tone: eventTone(event),
    }));

  if (!entries.some((entry) => entry.title === "Task created")) {
    entries.push({
      id: `${task.taskId}-created`,
      timestamp: task.createdAt,
      title: "Task created",
      detail: "Creation timestamp from the task record",
      tone: "info",
    });
  }

  return entries.sort(
    (a, b) =>
      Date.parse(a.timestamp) - Date.parse(b.timestamp) ||
      a.id.localeCompare(b.id),
  );
}
