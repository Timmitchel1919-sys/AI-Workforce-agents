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
    /* UI Layer 4 — Workflow Studio: authoring drafts vs publishing immutable versions. */
    "author_workflow",
    "publish_workflow",
    /* UI Layer 13 - project knowledge documents. */
    "author_knowledge",
    /* PROJECT-2 — project onboarding & provisioning (administrators only). */
    "create_project",
    /* EO-6.2 — AI Cost Center: setting the enforced budget is administrator-only. */
    "manage_budget_policy",
    /* EO-6.3 — Governance Policy Engine: the allow-list/threshold policy is administrator-only. */
    "manage_governance_policy",
    /* SECURITY FOUNDATION V1 — Layer 1: Security Capability Model (deny-by-default).
     *
     * These capabilities are AUTHORIZATION PRIMITIVES. They establish the role
     * boundaries later layers (Policy Engine, Destructive Action Approval Gate,
     * Secret Vault, Security Center, Threat Containment) will consume. Adding a
     * capability here does NOT, on its own, enable the capability's action —
     * each later layer must still implement the governed route and audit it.
     */
    /** Read high-level security posture (summary tiles, counts). */
    "view_security",
    /** Mutate security policy (allow-lists, thresholds, risk tiers). */
    "manage_security_policy",
    /** Read detailed canonical security events / incident evidence. */
    "view_security_events",
    /** Manage security incident lifecycle (assign, status, resolve, notes). */
    "manage_security_incidents",
    /** Submit a destructive-action request for approval (does NOT execute it). */
    "request_destructive_action",
    /** Approve a submitted destructive-action request (does NOT execute it). */
    "approve_destructive_action",
    /** Manage secret references / metadata — never raw secret values. */
    "manage_secret_references",
    /** Internal/governed resolution of secret references via vault lease. */
    "use_secret_reference",
    /** Privileged identity-security administration (operator lifecycle writes). */
    "manage_identity_security",
    /** Agent-security administration (trust level, quarantine, revoke). */
    "manage_agent_security",
    /** Governed containment response (block agent, quarantine resource). */
    "contain_security_threat",
];
/** Deny-by-default: a role has exactly the capabilities listed here. */
export const ROLE_CAPABILITIES = {
    viewer: [
        "view",
        // SECURITY V1 Layer 1: viewers may see high-level security posture only.
        // Detailed events, policy mutation, incidents, destructive actions,
        // secrets, identity/agent-security admin, and containment are deliberately
        // withheld from viewers.
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
        // UI Layer 4: operators author workflow drafts; publishing is administrator-only.
        "author_workflow",
        "author_knowledge",
        // SECURITY V1 Layer 1: operators may read posture + detailed events, and
        // submit (but not approve) destructive-action requests. Policy mutation,
        // incident lifecycle, approvals, secrets, identity/agent-security admin,
        // and containment remain administrator-only.
        "view_security",
        "view_security_events",
        "request_destructive_action",
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
        "author_workflow",
        "publish_workflow",
        "author_knowledge",
        // PROJECT-2: creating/provisioning a project is administrator-only.
        "create_project",
        // EO-6.2: setting the enforced budget policy is administrator-only.
        "manage_budget_policy",
        // EO-6.3: setting the governance allow-list/threshold policy is administrator-only.
        "manage_governance_policy",
        // SECURITY V1 Layer 1: administrators receive every new security capability.
        "view_security",
        "view_security_events",
        "manage_security_policy",
        "manage_security_incidents",
        "request_destructive_action",
        "approve_destructive_action",
        "manage_secret_references",
        "use_secret_reference",
        "manage_identity_security",
        "manage_agent_security",
        "contain_security_threat",
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
    // UI Layer 4 — Workflow Studio.
    "save_workflow_draft",
    "validate_workflow",
    "publish_workflow",
    "archive_workflow",
    "restore_workflow_version",
    "duplicate_workflow",
    // UI Layer 13 - knowledge documents.
    "save_knowledge_document",
    "archive_knowledge_document",
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
