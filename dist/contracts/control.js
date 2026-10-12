/**
 * Workforce Control & Operations Layer — contracts.
 *
 * The Control Plane sits ABOVE core. It provides operational visibility
 * (queries) and controlled human-in-the-loop actions (commands). It never
 * becomes the orchestration engine, and it never bypasses core security,
 * permission, approval, or audit mechanisms — every command runs through a
 * core service and emits a `control_command` audit event.
 *
 *   CONTROL PLANE
 *        │
 *   ┌────┼────┐
 *   ▼    ▼    ▼
 *  QUERY COMMAND EVENT
 *   │     │
 *   └─────┼─────┘
 *         ▼
 *        CORE  →  Security  →  Audit / State
 */
import { INTEGRATION_COMMANDS } from "./integration-gateway.js";
import { EXTENSION_COMMANDS } from "./extension-platform.js";
import { BUSINESS_COMMANDS } from "./business-layer.js";
import { PORTFOLIO_COMMANDS } from "./portfolio-intelligence.js";
import { AUTONOMY_COMMANDS } from "./autonomy.js";
import { ANALYTICS_COMMANDS } from "./analytics-intelligence.js";
import { requireText, ValidationError, } from "./index.js";
/* ------------------------------------------------------------------ */
/* Operator authorization                                             */
/* ------------------------------------------------------------------ */
export const OPERATOR_ROLES = ["viewer", "operator", "admin"];
export const CONTROL_CAPABILITIES = [
    "view",
    "approve",
    "reject",
    "cancel_task",
    "retry_task",
    "pause_workflow",
    "resume_workflow",
    "cancel_workflow",
    "disable_agent",
    "enable_agent",
    "create_execution_plan",
    "replan_execution_plan",
    "submit_execution_plan",
    "manage_access",
    "prepare_execution",
    "cancel_execution",
    "kill_execution",
    /* EO-4.6 — each release transition is its own capability. */
    "review_change",
    "commit_source",
    "push_source",
    "deploy_release",
    "rollback_release",
    /* EO-5.1 — Software Factory orchestration. */
    "plan_from_objective",
    "create_program",
    "create_workstream",
    "add_task_to_workstream",
    "tick_software_factory",
    /* PROJECT-2 — project onboarding & provisioning (administrators only). */
    "create_project",
    /* EO-6.2 — AI Cost Center: setting the enforced budget is administrator-only. */
    "manage_budget_policy",
    /* EO-6.3 — Governance Policy Engine: the allow-list/threshold policy is administrator-only. */
    "manage_governance_policy",
    /* SECURITY-0 — Security Foundation */
    "view_security",
    "manage_security_policy",
    "view_security_events",
    "manage_security_incidents",
    "request_destructive_action",
    "approve_destructive_action",
    "manage_secret_references",
    "manage_identity_security",
    "manage_agent_security",
    "contain_security_threat",
    /* Phase 3 — Context Engine + Prompt Intelligence (prepares, never executes). */
    "prepare_prompt",
    /* Layer 4 — Execution Orchestration (plans and coordinates; gated by approvals). */
    "orchestrate_execution",
    /* Knowledge, Memory & Context Intelligence (curating project memory). */
    "manage_knowledge",
    /* Governance & trust: suspend agents, emergency stop, alerts, policies. */
    "manage_security",
    /* Integration Hub: connectors, credentials, MCP servers, event subscriptions. */
    "manage_integrations",
    /* Layers 9–13: extensions, business layer, portfolio, autonomous operations, analytics. */
    "manage_extensions",
    "manage_business",
    "manage_portfolio",
    "manage_autonomy",
    "manage_analytics",
];
/** Deny-by-default: a role has exactly the capabilities listed here. */
export const ROLE_CAPABILITIES = {
    viewer: [
        "view",
        "view_security",
    ],
    operator: [
        "view",
        "approve",
        "reject",
        "cancel_task",
        "retry_task",
        "pause_workflow",
        "resume_workflow",
        "cancel_workflow",
        "create_execution_plan",
        "replan_execution_plan",
        "submit_execution_plan",
        "prepare_execution",
        "cancel_execution",
        // Operators review changes; committing, pushing and deploying are
        // administrator-only protected actions.
        "review_change",
        // EO-5.1 Software Factory: operators author programs/workstreams/tasks and
        // advance ready work through the governed orchestrator.
        "plan_from_objective",
        "create_program",
        "create_workstream",
        "add_task_to_workstream",
        "tick_software_factory",
        "view_security",
        "view_security_events",
        "request_destructive_action",
        // Phase 3: operators may prepare (analyse/validate) execution prompts.
        "prepare_prompt",
        // Layer 4: operators may plan and advance execution runs.
        "orchestrate_execution",
        // Knowledge: curate, confirm, supersede and ingest project memory.
        "manage_knowledge",
        // Governance: raise the emergency stop, handle alerts, suspend agents (critical changes stay admin-only).
        "manage_security",
        "manage_integrations",
        "manage_extensions",
        "manage_business",
        "manage_portfolio",
        "manage_autonomy",
        "manage_analytics",
    ],
    admin: [
        "view",
        "approve",
        "reject",
        "cancel_task",
        "retry_task",
        "pause_workflow",
        "resume_workflow",
        "cancel_workflow",
        "disable_agent",
        "enable_agent",
        "create_execution_plan",
        "replan_execution_plan",
        "submit_execution_plan",
        "manage_access",
        "prepare_execution",
        "cancel_execution",
        // Emergency termination of a specific session: administrators only.
        "kill_execution",
        "review_change",
        "commit_source",
        "push_source",
        "deploy_release",
        "rollback_release",
        // EO-5.1 Software Factory orchestrates the governed Orchestrator.
        "plan_from_objective",
        "create_program",
        "create_workstream",
        "add_task_to_workstream",
        "tick_software_factory",
        // PROJECT-2: creating/provisioning a project is administrator-only.
        "create_project",
        // EO-6.2: setting the enforced budget policy is administrator-only.
        "manage_budget_policy",
        // EO-6.3: setting the governance allow-list/threshold policy is administrator-only.
        "manage_governance_policy",
        "view_security",
        "manage_security_policy",
        "view_security_events",
        "manage_security_incidents",
        "request_destructive_action",
        "approve_destructive_action",
        "manage_secret_references",
        "manage_identity_security",
        "manage_agent_security",
        "contain_security_threat",
        // Phase 3: preparing execution prompts.
        "prepare_prompt",
        "orchestrate_execution",
        // Knowledge: curate, confirm, supersede and ingest project memory.
        "manage_knowledge",
        "manage_security",
        "manage_integrations",
        "manage_extensions",
        "manage_business",
        "manage_portfolio",
        "manage_autonomy",
        "manage_analytics",
    ],
};
export function validateOperatorPrincipal(principal) {
    if (!principal || typeof principal !== "object") {
        throw new ValidationError("operator principal must be an object");
    }
    requireText(principal.id, "operator.id");
    if (!OPERATOR_ROLES.includes(principal.role)) {
        throw new ValidationError(`operator.role must be one of ${OPERATOR_ROLES.join(", ")}`);
    }
    if (principal.allowedProjects !== "*" &&
        !Array.isArray(principal.allowedProjects)) {
        throw new ValidationError('operator.allowedProjects must be "*" or an array of project ids');
    }
}
export function operatorCan(principal, capability) {
    return (ROLE_CAPABILITIES[principal.role] ?? []).includes(capability);
}
export function operatorCanAccessProject(principal, projectId) {
    return (principal.allowedProjects === "*" ||
        principal.allowedProjects.includes(projectId));
}
/* ------------------------------------------------------------------ */
/* Command results                                                    */
/* ------------------------------------------------------------------ */
export const CONTROL_COMMANDS = [
    "approve",
    "reject",
    "cancel_task",
    "retry_task",
    "pause_workflow",
    "resume_workflow",
    "cancel_workflow",
    "disable_agent",
    "enable_agent",
    "create_execution_plan",
    "replan_execution_plan",
    "submit_execution_plan",
    "cancel_execution",
    "kill_execution",
    "approve_access",
    "reject_access",
    "suspend_access",
    "reactivate_access",
    "revoke_access",
    "change_operator_role",
    // EO-5.1 — Software Factory orchestration command names.
    "plan_from_objective",
    "create_program",
    "create_workstream",
    "add_task_to_workstream",
    "tick_software_factory",
    // PROJECT-2 — project onboarding & provisioning.
    "onboarding_create",
    "onboarding_update",
    "onboarding_analyze",
    "onboarding_plan",
    "onboarding_approve_plan",
    "onboarding_provision",
    "onboarding_revalidate",
    "onboarding_cancel",
    // EO-6.2/6.3 — AI Cost Center & Governance Policy Engine.
    "set_budget_policy",
    "set_governance_policy",
    "evaluate_governance",
    // Phase 3 — Context Engine + Prompt Intelligence.
    "prompt_prepare",
    "prompt_request_approval",
    // Layer 4 — Execution Orchestration.
    "orchestration_create",
    "orchestration_start",
    "orchestration_advance",
    "orchestration_pause",
    "orchestration_resume",
    "orchestration_cancel",
    "orchestration_retry_task",
    // Layer 5 — Execution Runtime.
    "runtime_cancel_session",
    "runtime_pause_session",
    "runtime_resume_session",
    // Knowledge, Memory & Context Intelligence.
    "knowledge_create_memory",
    "knowledge_update_memory",
    "knowledge_confirm_memory",
    "knowledge_archive_memory",
    "knowledge_restore_memory",
    "knowledge_supersede_memory",
    "knowledge_revoke_memory",
    "knowledge_delete_memory",
    "knowledge_link",
    "knowledge_resolve_conflict",
    "knowledge_ingest_document",
    "knowledge_discover_project",
    "knowledge_refresh_project",
    "knowledge_apply_retention",
    // Governance, Trust & Security.
    "security_set_agent_trust",
    "security_set_model_trust",
    "security_set_tool_trust",
    "security_create_policy",
    "security_update_policy",
    "security_set_policy_status",
    "security_decide_approval",
    "security_cancel_approval",
    "security_alert_transition",
    "security_emergency_stop",
    "security_emergency_advance",
    "security_emergency_resume",
    "security_scan_config",
    "security_accept_config",
    "security_scan_dependencies",
    // Integration Hub.
    ...INTEGRATION_COMMANDS,
    // Layers 9–13.
    ...EXTENSION_COMMANDS,
    ...BUSINESS_COMMANDS,
    ...PORTFOLIO_COMMANDS,
    ...AUTONOMY_COMMANDS,
    ...ANALYTICS_COMMANDS,
];
/**
 * A refinement of a non-`executed` outcome, aligned with the `WorkforceError`
 * hierarchy so a future HTTP layer can map each to a status code:
 *   invalid_request  → 400   unauthorized → 401   forbidden → 403
 *   not_found        → 404   invalid_state → 409
 *   approval_failure → 422   command_failure → 500
 */
export const CONTROL_ERROR_KINDS = [
    "invalid_request",
    "unauthorized",
    "forbidden",
    "not_found",
    "invalid_state",
    "approval_failure",
    "command_failure",
];
/* ------------------------------------------------------------------ */
/* Operational statuses                                               */
/* ------------------------------------------------------------------ */
export const AGENT_OPERATIONAL_STATUSES = [
    "idle",
    "available",
    "busy",
    "blocked",
    "waiting",
    "failed",
    "disabled",
];
export const HEALTH_STATUSES = [
    "healthy",
    "degraded",
    "unavailable",
    /** The component has not been measured in this build — not a failure. */
    "unknown",
];
export const PROJECT_OPERATIONAL_STATUSES = [
    "available",
    "degraded",
    "unavailable",
];
export const APPROVAL_RISK_LEVELS = ["low", "medium", "high"];
export function requireId(value, field) {
    return requireText(value, field);
}
