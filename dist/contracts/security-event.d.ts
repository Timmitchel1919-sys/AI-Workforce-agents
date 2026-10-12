import type { Entity } from "./persistence.js";
export declare const SECURITY_EVENT_CATEGORIES: readonly ["authentication", "authorization", "policy", "data_protection", "agent_security", "system", "access_control", "destructive_action", "api_security", "secrets", "deployment", "data_access", "configuration", "incident", "vulnerability", "integrity", "availability", "prompt_injection", "external_content", "integration"];
export type SecurityEventCategory = (typeof SECURITY_EVENT_CATEGORIES)[number];
export declare const SECURITY_EVENT_SEVERITIES: readonly ["info", "low", "medium", "high", "critical"];
export type SecurityEventSeverity = (typeof SECURITY_EVENT_SEVERITIES)[number];
export declare const SECURITY_EVENT_OUTCOMES: readonly ["allowed", "denied", "blocked", "failed", "observed", "succeeded", "pending", "escalated", "contained"];
export type SecurityEventOutcome = (typeof SECURITY_EVENT_OUTCOMES)[number];
/**
 * Standardized actor kinds. The runtime still accepts arbitrary strings on
 * the wire (actor.kind is `string`) for backward compatibility, but new
 * emitters MUST use one of these values so queries and dashboards can
 * classify actors reliably.
 */
export declare const SECURITY_EVENT_ACTOR_KINDS: readonly ["human", "agent", "service", "system", "integration", "unknown"];
export type SecurityEventActorKind = (typeof SECURITY_EVENT_ACTOR_KINDS)[number];
export interface CanonicalSecurityEvent extends Entity {
    eventId: string;
    schemaVersion: 1;
    occurredAt: string;
    category: SecurityEventCategory;
    type: string;
    severity: SecurityEventSeverity;
    outcome: SecurityEventOutcome;
    actor: {
        kind: string;
        id?: string;
    };
    source: {
        kind: string;
        id?: string;
        ip?: string;
    };
    target?: {
        kind: string;
        id?: string;
        projectId?: string;
    };
    projectId?: string;
    correlationId?: string;
    approvalId?: string;
    policyId?: string;
    evidence?: Readonly<Record<string, unknown>>;
    previousEventHash?: string;
    eventHash?: string;
}
export interface SecurityEventQuery {
    projectId?: string;
    category?: SecurityEventCategory;
    severity?: SecurityEventSeverity;
    outcome?: SecurityEventOutcome;
    type?: string;
    actorId?: string;
    agentId?: string;
    correlationId?: string;
    approvalId?: string;
    destructiveActionId?: string;
    incidentId?: string;
    targetId?: string;
    after?: string;
    before?: string;
    limit?: number;
}
/**
 * Catalog of well-known canonical event types. Not exhaustive — the
 * stored `type` field is `string` for forward compatibility — but
 * every emitter should prefer a documented value here when one fits
 * so the taxonomy stays consistent across subsystems.
 */
export declare const SECURITY_EVENT_TYPES: {
    readonly AUTH_FAILED: "authentication_failed";
    readonly AUTH_SUCCEEDED: "authentication_succeeded";
    readonly SESSION_REVOKED: "session_revoked";
    readonly AUTHZ_DENIED: "authorization_denied";
    readonly CAPABILITY_DENIED: "capability_denied";
    readonly PROJECT_SCOPE_DENIED: "project_scope_denied";
    readonly ACCESS_REQUESTED: "access_requested";
    readonly ACCESS_APPROVED: "access_approved";
    readonly ACCESS_REJECTED: "access_rejected";
    readonly ACCESS_REVOKED: "access_revoked";
    readonly ROLE_CHANGED: "role_changed";
    readonly POLICY_EVALUATED: "security_policy_evaluated";
    readonly POLICY_ALLOWED: "security_policy_allowed";
    readonly POLICY_DENIED: "security_policy_denied";
    readonly POLICY_APPROVAL_REQUIRED: "security_policy_approval_required";
    readonly POLICY_CHANGED: "security_policy_changed";
    readonly POLICY_CHANGE_DENIED: "security_policy_change_denied";
    readonly DESTRUCTIVE_REQUESTED: "destructive_action_requested";
    readonly DESTRUCTIVE_UNDER_REVIEW: "destructive_action_under_review";
    readonly DESTRUCTIVE_APPROVAL_REQUIRED: "destructive_action_approval_required";
    readonly DESTRUCTIVE_APPROVED: "destructive_action_approved";
    readonly DESTRUCTIVE_REJECTED: "destructive_action_rejected";
    readonly DESTRUCTIVE_CHANGES_REQUESTED: "destructive_action_changes_requested";
    readonly DESTRUCTIVE_SAFER_PREFERRED: "destructive_action_safer_alternative_preferred";
    readonly DESTRUCTIVE_EXECUTION_STARTED: "destructive_action_execution_started";
    readonly DESTRUCTIVE_EXECUTED: "destructive_action_executed";
    readonly DESTRUCTIVE_FAILED: "destructive_action_failed";
    readonly DESTRUCTIVE_EXPIRED: "destructive_action_expired";
    readonly DESTRUCTIVE_BLOCKED: "destructive_action_blocked";
    readonly DESTRUCTIVE_BYPASS_ATTEMPT: "destructive_action_bypass_attempt";
    readonly AGENT_DISABLED: "agent_disabled";
    readonly AGENT_ENABLED: "agent_enabled";
    readonly AGENT_SECURITY_CHANGE: "agent_security_change";
    readonly AGENT_PRIVILEGE_EXPANSION_DENIED: "agent_privilege_expansion_denied";
    readonly SECRET_REFERENCE_CHANGE: "secret_reference_change";
    readonly RAW_SECRET_ACCESS_DENIED: "raw_secret_access_denied";
    readonly DEPLOYMENT_REQUESTED: "deployment_requested";
    readonly DEPLOYMENT_BLOCKED: "deployment_blocked";
    readonly ROLLBACK_REQUESTED: "rollback_requested";
    readonly UNAUTHORIZED_API_REQUEST: "unauthorized_api_request";
    readonly INVALID_REQUEST_DETECTED: "invalid_request_detected";
    readonly RATE_LIMIT_EXCEEDED: "rate_limit_exceeded";
    readonly PROMPT_INJECTION_SUSPECTED: "prompt_injection_suspected";
    readonly UNTRUSTED_INSTRUCTION_DETECTED: "untrusted_instruction_detected";
};
/**
 * Async port used by durable security-event adapters.  The port intentionally
 * exposes only append and query: canonical security events are immutable once
 * accepted by the control plane.
 */
export interface AsyncSecurityEventStore {
    append(event: CanonicalSecurityEvent): Promise<void>;
    query(query?: SecurityEventQuery): Promise<CanonicalSecurityEvent[]>;
}
export declare function validateSecurityEvent(event: CanonicalSecurityEvent): void;
