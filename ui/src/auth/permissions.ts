export type Permission =
  | "dashboard.read"
  | "agents.read"
  | "agents.manage"
  | "tasks.read"
  | "tasks.manage"
  | "workflows.read"
  | "workflows.manage"
  | "approvals.read"
  | "approvals.manage"
  | "projects.read"
  | "projects.manage"
  | "audit.read"
  | "knowledge.read"
  | "settings.read"
  | "settings.manage";

export function hasPermission(
  permissions: readonly Permission[],
  required: Permission,
): boolean {
  return permissions.includes(required);
}