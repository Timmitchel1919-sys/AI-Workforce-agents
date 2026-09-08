/**
 * Frontend permission helpers — for UX ONLY (navigation, visibility, disabled
 * states). Never a security boundary: every command is still sent to the
 * Control Plane, which enforces authorization independently. This map mirrors
 * the backend `ROLE_CAPABILITIES` so the UI hides actions the server would
 * reject anyway.
 */
import type { OperatorRole } from "../api/contracts";

export type UiCapability =
  | "view"
  | "approve"
  | "reject"
  | "cancel_task"
  | "retry_task"
  | "pause_workflow"
  | "resume_workflow"
  | "cancel_workflow"
  | "disable_agent"
  | "enable_agent";

const OPERATOR_CAPS: readonly UiCapability[] = [
  "view",
  "approve",
  "reject",
  "cancel_task",
  "retry_task",
  "pause_workflow",
  "resume_workflow",
  "cancel_workflow",
];

export const ROLE_CAPABILITIES: Record<OperatorRole, readonly UiCapability[]> =
  {
    viewer: ["view"],
    operator: OPERATOR_CAPS,
    admin: [...OPERATOR_CAPS, "disable_agent", "enable_agent"],
  };

export function can(
  role: OperatorRole | null | undefined,
  capability: UiCapability,
): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function canAccessProject(
  allowedProjects: readonly string[] | "*" | null | undefined,
  projectId: string,
): boolean {
  if (allowedProjects == null) return false;
  return allowedProjects === "*" || allowedProjects.includes(projectId);
}
