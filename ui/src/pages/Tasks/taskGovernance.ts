import type {
  ApprovalView,
  AuditEventView,
  OperatorRole,
} from "../../api/contracts";
import {
  can,
  canAccessProject,
  type UiCapability,
} from "../../auth/permissions";
import { titleCase } from "../../lib/formatters";
import type { TaskView } from "../../api/contracts";

export interface TaskGovernancePermission {
  capability: UiCapability;
  label: string;
  granted: boolean;
}

const TASK_GOVERNANCE_CAPABILITIES: ReadonlyArray<{
  capability: UiCapability;
  label: string;
}> = [
  { capability: "view", label: "View task and governance" },
  { capability: "cancel_task", label: "Cancel task" },
  { capability: "retry_task", label: "Retry task" },
];

const TASK_GOVERNANCE_EVENT_TYPES = new Set([
  "task_created",
  "task_assigned",
  "task_resumed",
  "task_completed",
  "task_failed",
  "control_command",
  "approval_requested",
  "approval_decided",
  "permission_decision",
]);

export const TASK_AUDIT_SUMMARY_LIMIT = 6;

export function taskAccessLevelLabel(
  role: OperatorRole | null | undefined,
): string {
  return role ? titleCase(role) : "Unauthenticated";
}

export function taskPermissions(
  role: OperatorRole | null | undefined,
): TaskGovernancePermission[] {
  return TASK_GOVERNANCE_CAPABILITIES.map((permission) => ({
    ...permission,
    granted: can(role, permission.capability),
  }));
}

export function hasTaskProjectAccess(
  allowedProjects: readonly string[] | "*" | null | undefined,
  task: TaskView,
): boolean {
  return canAccessProject(allowedProjects, task.projectId);
}

/**
 * Resolve the real approval attached to the task. The Task's `approvalId` is
 * authoritative when present; the task-id fallback remains a real backend
 * relationship for older task records that do not expose an approval id.
 */
export function findTaskApproval(
  approvals: readonly ApprovalView[],
  task: TaskView,
): ApprovalView | null {
  if (task.approvalId) {
    return (
      approvals.find((approval) => approval.approvalId === task.approvalId) ??
      null
    );
  }
  const matches = approvals
    .filter((approval) => approval.taskId === task.taskId)
    .slice()
    .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
  return matches[0] ?? null;
}

/** A concise task-local view, never a substitute for the global Audit Log. */
export function taskGovernanceEvents(
  events: readonly AuditEventView[],
  taskId: string,
): AuditEventView[] {
  return events
    .filter(
      (event) =>
        event.taskId === taskId && TASK_GOVERNANCE_EVENT_TYPES.has(event.type),
    )
    .slice()
    .sort(
      (a, b) =>
        Date.parse(b.timestamp) - Date.parse(a.timestamp) ||
        b.id.localeCompare(a.id),
    )
    .slice(0, TASK_AUDIT_SUMMARY_LIMIT);
}

export function taskAuditEventLabel(type: string): string {
  const labels: Record<string, string> = {
    task_created: "Task created",
    task_assigned: "Agent assigned",
    task_resumed: "Execution resumed",
    task_completed: "Task completed",
    task_failed: "Task failed",
    control_command: "Operator command recorded",
    approval_requested: "Approval requested",
    approval_decided: "Approval decision recorded",
    permission_decision: "Permission evaluated",
  };
  return labels[type] ?? type.replaceAll("_", " ");
}
