import type { OperatorRole, TaskView } from "../../api/contracts";
import {
  can,
  canAccessProject,
  type UiCapability,
} from "../../auth/permissions";
import type { TaskAction } from "../../features/tasks";

export type { TaskAction };

interface TaskActionSpec {
  action: TaskAction;
  capability: UiCapability;
  label: string;
  dialogTitle: (task: TaskView) => string;
  consequence: (task: TaskView) => string;
  appliesTo: (task: TaskView) => boolean;
}

const CANCELLABLE_STATUSES = new Set([
  "created",
  "queued",
  "running",
  "blocked",
  "awaiting_approval",
]);

/**
 * Task operation matrix, verified against the Control Plane command service:
 *
 * | Action | Valid task state | Backend behavior |
 * | --- | --- | --- |
 * | Cancel | created, queued, running, blocked, awaiting approval | transitions the same task to cancelled if accepted |
 * | Retry | failed standalone task | re-queues the same task if its failure is retryable and its retry limit remains |
 *
 * The UI only knows the first-level eligibility shown above. Retryability and
 * retry-limit checks remain authoritative on the Control Plane.
 */
const ACTION_SPECS: readonly TaskActionSpec[] = [
  {
    action: "cancel",
    capability: "cancel_task",
    label: "Cancel task",
    dialogTitle: (task) => `Cancel ${task.taskId}?`,
    consequence: () =>
      "The Control Plane will request cancellation. The task stops only if cancellation is accepted.",
    appliesTo: (task) => CANCELLABLE_STATUSES.has(task.status),
  },
  {
    action: "retry",
    capability: "retry_task",
    label: "Retry task",
    dialogTitle: (task) => `Retry ${task.taskId}?`,
    consequence: () =>
      "The Control Plane will request a retry. If accepted, this same task is re-queued; no local duplicate is created.",
    appliesTo: (task) => task.status === "failed" && !task.workflowId,
  },
];

function specFor(action: TaskAction): TaskActionSpec {
  const spec = ACTION_SPECS.find((candidate) => candidate.action === action);
  if (!spec) throw new Error(`unknown task action: ${action}`);
  return spec;
}

export function structuralTaskAction(task: TaskView): TaskAction | null {
  return ACTION_SPECS.find((spec) => spec.appliesTo(task))?.action ?? null;
}

export function availableTaskActions(
  task: TaskView,
  role: OperatorRole | null | undefined,
  allowedProjects: readonly string[] | "*" | null | undefined,
): TaskAction[] {
  return ACTION_SPECS.filter(
    (spec) =>
      spec.appliesTo(task) &&
      can(role, spec.capability) &&
      canAccessProject(allowedProjects, task.projectId),
  ).map((spec) => spec.action);
}

export function taskActionUnavailableReason(
  task: TaskView,
  action: TaskAction,
  role: OperatorRole | null | undefined,
  allowedProjects: readonly string[] | "*" | null | undefined,
): string | null {
  const spec = specFor(action);
  if (!can(role, spec.capability)) {
    return "You do not have permission to operate this task.";
  }
  if (!canAccessProject(allowedProjects, task.projectId)) {
    return "This task's project is outside your current access scope.";
  }
  return null;
}

export function taskActionLabel(action: TaskAction): string {
  return specFor(action).label;
}

export function taskActionDialogTitle(
  action: TaskAction,
  task: TaskView,
): string {
  return specFor(action).dialogTitle(task);
}

export function taskActionConsequence(
  action: TaskAction,
  task: TaskView,
): string {
  return specFor(action).consequence(task);
}
