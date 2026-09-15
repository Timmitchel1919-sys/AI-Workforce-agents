import type { OperatorRole, WorkflowView } from "../../api/contracts";
import {
  can,
  canAccessProject,
  type UiCapability,
} from "../../auth/permissions";

/** The complete workflow command set currently exposed by the Control Plane. */
export type WorkflowAction = "pause" | "resume" | "cancel";

interface WorkflowActionSpec {
  action: WorkflowAction;
  capability: UiCapability;
  label: string;
  dialogTitle: (workflow: WorkflowView) => string;
  consequence: (workflow: WorkflowView) => string;
  appliesTo: (workflow: WorkflowView) => boolean;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function isTerminal(workflow: WorkflowView): boolean {
  return TERMINAL_STATUSES.has(workflow.status);
}

/**
 * This is an advisory UI matrix, derived from the current command service.
 * The Control Plane re-evaluates every action, since another operator may
 * change the workflow between render and submission.
 */
const ACTION_SPECS: readonly WorkflowActionSpec[] = [
  {
    action: "pause",
    capability: "pause_workflow",
    label: "Pause workflow",
    dialogTitle: (workflow) => `Pause ${workflow.workflowId}?`,
    consequence: () =>
      "The Control Plane will request a pause. No further task dispatch occurs until the workflow is resumed if the request is accepted.",
    appliesTo: (workflow) =>
      !isTerminal(workflow) &&
      !workflow.paused &&
      workflow.status !== "awaiting_approval",
  },
  {
    action: "resume",
    capability: "resume_workflow",
    label: "Resume workflow",
    dialogTitle: (workflow) => `Resume ${workflow.workflowId}?`,
    consequence: () =>
      "The Control Plane will resume this workflow only if its current execution is genuinely resumable. This does not create a new execution.",
    appliesTo: (workflow) =>
      !isTerminal(workflow) &&
      (workflow.paused || workflow.status === "awaiting_approval"),
  },
  {
    action: "cancel",
    capability: "cancel_workflow",
    label: "Cancel workflow",
    dialogTitle: (workflow) => `Cancel ${workflow.workflowId}?`,
    consequence: () =>
      "Cancellation will be requested through the AI Workforce Control Plane. Running work may require time to reach a safe terminal state.",
    appliesTo: (workflow) => !isTerminal(workflow),
  },
];

function specFor(action: WorkflowAction): WorkflowActionSpec {
  const spec = ACTION_SPECS.find((candidate) => candidate.action === action);
  if (!spec) throw new Error(`unknown workflow action: ${action}`);
  return spec;
}

export function structuralWorkflowActions(
  workflow: WorkflowView,
): WorkflowAction[] {
  return ACTION_SPECS.filter((spec) => spec.appliesTo(workflow)).map(
    (spec) => spec.action,
  );
}

export function availableWorkflowActions(
  workflow: WorkflowView,
  role: OperatorRole | null | undefined,
  allowedProjects: readonly string[] | "*" | null | undefined,
): WorkflowAction[] {
  return ACTION_SPECS.filter(
    (spec) =>
      spec.appliesTo(workflow) &&
      can(role, spec.capability) &&
      canAccessProject(allowedProjects, workflow.projectId),
  ).map((spec) => spec.action);
}

export function workflowActionUnavailableReason(
  workflow: WorkflowView,
  action: WorkflowAction,
  role: OperatorRole | null | undefined,
  allowedProjects: readonly string[] | "*" | null | undefined,
): string | null {
  const spec = specFor(action);
  if (!can(role, spec.capability)) {
    return "You have read-only access to this workflow.";
  }
  if (!canAccessProject(allowedProjects, workflow.projectId)) {
    return "This workflow's project is outside your current access scope.";
  }
  return null;
}

export function workflowActionLabel(action: WorkflowAction): string {
  return specFor(action).label;
}

export function workflowActionDialogTitle(
  action: WorkflowAction,
  workflow: WorkflowView,
): string {
  return specFor(action).dialogTitle(workflow);
}

export function workflowActionConsequence(
  action: WorkflowAction,
  workflow: WorkflowView,
): string {
  return specFor(action).consequence(workflow);
}
