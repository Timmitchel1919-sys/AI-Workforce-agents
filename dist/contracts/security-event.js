export const SECURITY_EVENT_CATEGORIES = [
    // Legacy categories — preserved for stored events.
    "authentication",
    "authorization",
    "policy",
    "data_protection",
    "agent_security",
    "system",
    // Security Foundation V1 Layer 4 — expanded taxonomy. Additive only;
    // nothing above is renamed. `data_protection` is retained for
    // backward compatibility; new code should prefer `data_access`.
    "access_control",
    "destructive_action",
    "api_security",
    "secrets",
    "deployment",
    "data_access",
    "configuration",
    "incident",
    "vulnerability",
    "integrity",
    "availability",
    "prompt_injection",
    "external_content",
    "integration",
];
export const SECURITY_EVENT_SEVERITIES = [
    "info",
    "low",
    "medium",
    "high",
    "critical",
];
export const SECURITY_EVENT_OUTCOMES = [
    // Legacy outcomes — never rename.
    "allowed",
    "denied",
    "blocked",
    "failed",
    "observed",
    // Security Foundation V1 Layer 4 — additive outcomes.
    "succeeded",
    "pending",
    "escalated",
    "contained",
];
/**
 * Standardized actor kinds. The runtime still accepts arbitrary strings on
 * the wire (actor.kind is `string`) for backward compatibility, but new
 * emitters MUST use one of these values so queries and dashboards can
 * classify actors reliably.
 */
export const SECURITY_EVENT_ACTOR_KINDS = [
    "human",
    "agent",
    "service",
    "system",
    "integration",
    "unknown",
];
/**
 * Catalog of well-known canonical event types. Not exhaustive — the
 * stored `type` field is `string` for forward compatibility — but
 * every emitter should prefer a documented value here when one fits
 * so the taxonomy stays consistent across subsystems.
 */
export const SECURITY_EVENT_TYPES = {
    // AUTHENTICATION
    AUTH_FAILED: "authentication_failed",
    AUTH_SUCCEEDED: "authentication_succeeded",
    SESSION_REVOKED: "session_revoked",
    // AUTHORIZATION
    AUTHZ_DENIED: "authorization_denied",
    CAPABILITY_DENIED: "capability_denied",
    PROJECT_SCOPE_DENIED: "project_scope_denied",
    // ACCESS
    ACCESS_REQUESTED: "access_requested",
    ACCESS_APPROVED: "access_approved",
    ACCESS_REJECTED: "access_rejected",
    ACCESS_REVOKED: "access_revoked",
    ROLE_CHANGED: "role_changed",
    // POLICY
    POLICY_EVALUATED: "security_policy_evaluated",
    POLICY_ALLOWED: "security_policy_allowed",
    POLICY_DENIED: "security_policy_denied",
    POLICY_APPROVAL_REQUIRED: "security_policy_approval_required",
    POLICY_CHANGED: "security_policy_changed",
    POLICY_CHANGE_DENIED: "security_policy_change_denied",
    // DESTRUCTIVE
    DESTRUCTIVE_REQUESTED: "destructive_action_requested",
    DESTRUCTIVE_UNDER_REVIEW: "destructive_action_under_review",
    DESTRUCTIVE_APPROVAL_REQUIRED: "destructive_action_approval_required",
    DESTRUCTIVE_APPROVED: "destructive_action_approved",
    DESTRUCTIVE_REJECTED: "destructive_action_rejected",
    DESTRUCTIVE_CHANGES_REQUESTED: "destructive_action_changes_requested",
    DESTRUCTIVE_SAFER_PREFERRED: "destructive_action_safer_alternative_preferred",
    DESTRUCTIVE_EXECUTION_STARTED: "destructive_action_execution_started",
    DESTRUCTIVE_EXECUTED: "destructive_action_executed",
    DESTRUCTIVE_FAILED: "destructive_action_failed",
    DESTRUCTIVE_EXPIRED: "destructive_action_expired",
    DESTRUCTIVE_BLOCKED: "destructive_action_blocked",
    DESTRUCTIVE_BYPASS_ATTEMPT: "destructive_action_bypass_attempt",
    // AGENT
    AGENT_DISABLED: "agent_disabled",
    AGENT_ENABLED: "agent_enabled",
    AGENT_SECURITY_CHANGE: "agent_security_change",
    AGENT_PRIVILEGE_EXPANSION_DENIED: "agent_privilege_expansion_denied",
    // SECRETS
    SECRET_REFERENCE_CHANGE: "secret_reference_change",
    RAW_SECRET_ACCESS_DENIED: "raw_secret_access_denied",
    // DEPLOYMENT
    DEPLOYMENT_REQUESTED: "deployment_requested",
    DEPLOYMENT_BLOCKED: "deployment_blocked",
    ROLLBACK_REQUESTED: "rollback_requested",
    // API
    UNAUTHORIZED_API_REQUEST: "unauthorized_api_request",
    INVALID_REQUEST_DETECTED: "invalid_request_detected",
    RATE_LIMIT_EXCEEDED: "rate_limit_exceeded",
    // PROMPT / EXTERNAL CONTENT
    PROMPT_INJECTION_SUSPECTED: "prompt_injection_suspected",
    UNTRUSTED_INSTRUCTION_DETECTED: "untrusted_instruction_detected",
};
export function validateSecurityEvent(event) {
    if (!event.id || !event.eventId || event.id !== event.eventId)
        throw new Error("security event id must equal eventId");
    if (event.schemaVersion !== 1)
        throw new Error("unsupported security event schema");
    if (!event.occurredAt || Number.isNaN(Date.parse(event.occurredAt)))
        throw new Error("security event occurredAt must be an ISO timestamp");
    if (!event.category || !event.type || !event.severity || !event.outcome)
        throw new Error("security event identity fields are required");
    if (!event.actor.kind || !event.source.kind)
        throw new Error("security event actor and source are required");
}
