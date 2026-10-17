export const UI_AUTOMATION_ACTIONS = [
  "open_panel",
  "restore_layout",
  "apply_filter",
  "suggest_navigation",
  "highlight_resource",
  "prepare_action_form",
] as const;

export const PRIVILEGED_ACTIONS = [
  "deploy",
  "delete",
  "approve",
  "spend",
  "modify_security_policy",
  "change_agent_permissions",
  "run_command",
] as const;

export type UiAutomationAction = (typeof UI_AUTOMATION_ACTIONS)[number];
export type PrivilegedAction = (typeof PRIVILEGED_ACTIONS)[number];

export function mayAutomateWithoutAuthorization(action: string): action is UiAutomationAction {
  return (UI_AUTOMATION_ACTIONS as readonly string[]).includes(action);
}

export function requiresExplicitAuthorization(action: string): action is PrivilegedAction {
  return (PRIVILEGED_ACTIONS as readonly string[]).includes(action) || !mayAutomateWithoutAuthorization(action);
}

