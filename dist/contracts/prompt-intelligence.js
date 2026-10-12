/* ------------------------------------------------------------------ */
/* Intent                                                             */
/* ------------------------------------------------------------------ */
export const INTENT_CATEGORIES = [
    "UI_MODIFICATION",
    "THEME_MODIFICATION",
    "FEATURE_IMPLEMENTATION",
    "BUG_FIX",
    "REFACTOR",
    "TESTING",
    "CODE_REVIEW",
    "SECURITY_REVIEW",
    "DEPLOYMENT",
    "DOCUMENTATION",
    "RESEARCH",
    "DATA_ANALYSIS",
    "PROJECT_MANAGEMENT",
    "CONFIGURATION",
    "DESTRUCTIVE_OPERATION",
    "UNKNOWN",
];
export const DESTRUCTIVE_KINDS = [
    "file_deletion",
    "repository_deletion",
    "project_deletion",
    "agent_deletion",
    "workflow_deletion",
    "integration_deletion",
    "environment_deletion",
    "configuration_deletion",
    "secret_deletion",
    "database_destruction",
    "history_rewrite",
];
/* ------------------------------------------------------------------ */
/* Context                                                            */
/* ------------------------------------------------------------------ */
export const CONTEXT_CATEGORIES = [
    "project",
    "architecture",
    "ui",
    "security",
    "development",
    "preference",
    "task",
    "knowledge",
];
/**
 * Where a fragment ranks when two fragments disagree. Lower number wins.
 * Security restrictions are rank 2 and nothing below rank 1 (an explicit user
 * instruction) can override them — and an explicit instruction that conflicts
 * with a security fragment is recorded as a conflict, not obeyed.
 */
export const CONTEXT_PRECEDENCE = [
    "explicit_user_instruction",
    "project_security_policy",
    "project_architecture_rule",
    "approved_project_decision",
    "current_task_context",
    "project_documentation",
    "general_default",
];
export function precedenceRank(precedence) {
    return CONTEXT_PRECEDENCE.indexOf(precedence) + 1;
}
/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */
export const VALIDATION_STATUSES = [
    "PASS",
    "WARN",
    "CLARIFY",
    "APPROVAL_REQUIRED",
    "BLOCKED",
];
export const PROMPT_COMMANDS = [
    "prompt_prepare",
    "prompt_request_approval",
];
/** Reserved project id for a request whose project could not be identified. */
export const UNRESOLVED_PROJECT = "unresolved";
/** Bounds on untrusted input. */
export const MAX_REQUEST_LENGTH = 4000;
