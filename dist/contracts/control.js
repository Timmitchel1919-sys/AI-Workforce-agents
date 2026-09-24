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
];
/** Deny-by-default: a role has exactly the capabilities listed here. */
export const ROLE_CAPABILITIES = {
    viewer: ["view"],
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
    "approve_access",
    "reject_access",
    "suspend_access",
    "reactivate_access",
    "revoke_access",
    "change_operator_role",
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
