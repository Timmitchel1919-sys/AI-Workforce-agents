/**
 * AI Workforce — Core Contracts
 *
 * Shared type contracts and pure validators for the Workforce foundation.
 * This module has NO dependency on any model provider, tool vendor, project
 * repository, or infrastructure. Everything provider- or project-specific
 * enters the system through the interfaces declared here and is implemented
 * under `adapters/`.
 */
export const ENVIRONMENTS = ["local", "test", "staging", "production"];
/* ------------------------------------------------------------------ */
/* Tasks                                                              */
/* ------------------------------------------------------------------ */
export const TASK_STATUSES = [
    "created",
    "queued",
    "running",
    "blocked",
    "awaiting_approval",
    "completed",
    "failed",
    "cancelled",
];
/* ------------------------------------------------------------------ */
/* Audit                                                              */
/* ------------------------------------------------------------------ */
export const AUDIT_EVENT_TYPES = [
    "task_created",
    "task_assigned",
    "agent_executed",
    "handoff_created",
    "permission_decision",
    "approval_requested",
    "approval_decided",
    "task_resumed",
    "task_completed",
    "task_failed",
    "model_provider_requested",
    "model_execution_started",
    "model_execution_completed",
    "model_execution_failed",
    "agent_activity",
    "tool_registered",
    "tool_execution",
    "workflow_event",
    "project_adapter_event",
    "control_command",
    "host_registered",
    "environment_discovered",
    "environment_refreshed",
    "environment_unavailable",
    "execution_plan_event",
];
export const DEFAULT_AGENT_LIMITS = {
    maxIterations: 3,
    maxToolCalls: 8,
    maxModelCalls: 4,
    timeoutMs: 60_000,
};
/* ------------------------------------------------------------------ */
/* Errors                                                             */
/* ------------------------------------------------------------------ */
export class WorkforceError extends Error {
}
export class ValidationError extends WorkforceError {
}
export class StateTransitionError extends WorkforceError {
}
export class PermissionDeniedError extends WorkforceError {
}
export class NotFoundError extends WorkforceError {
}
/**
 * Structured failure from a General Agent execution. Carries a machine-readable
 * `reason` and diagnostic `details` (never secrets). Agents fail closed with
 * this rather than returning a partial or unstructured result.
 */
export class AgentExecutionError extends WorkforceError {
    agentId;
    reason;
    details;
    constructor(agentId, reason, message, details = {}, cause) {
        super(`[${agentId}:${reason}] ${message}`, cause !== undefined ? { cause } : undefined);
        this.name = "AgentExecutionError";
        this.agentId = agentId;
        this.reason = reason;
        this.details = details;
    }
}
/** Base class for failures originating from an external provider. */
export class ProviderError extends WorkforceError {
    provider;
    status;
    retryable;
    constructor(provider, message, options = {}) {
        super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = new.target.name;
        this.provider = provider;
        this.status = options.status;
        this.retryable = options.retryable ?? false;
    }
}
/**
 * Invalid or missing provider configuration (no API key, bad model id, ...).
 * A `ValidationError` so existing configuration-error handling catches it.
 * Never contains the offending secret value.
 */
export class ProviderConfigError extends ValidationError {
    provider;
    constructor(provider, message) {
        super(`[${provider}] ${message}`);
        this.name = "ProviderConfigError";
        this.provider = provider;
    }
}
/** Authentication / authorization failure (bad or missing credentials). */
export class ProviderAuthError extends ProviderError {
}
/** The provider rejected the request for exceeding a rate limit. */
export class ProviderRateLimitError extends ProviderError {
}
/** The request did not complete within the configured timeout. */
export class ProviderTimeoutError extends ProviderError {
}
/** The provider could not be reached or returned a server-side error. */
export class ProviderUnavailableError extends ProviderError {
}
/** The provider rejected the request as malformed (client-side, 4xx). */
export class ProviderRequestError extends ProviderError {
}
/** The provider returned a response the adapter could not interpret. */
export class ProviderResponseError extends ProviderError {
}
/* ------------------------------------------------------------------ */
/* Pure validators                                                    */
/* ------------------------------------------------------------------ */
export function requireText(value, field) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new ValidationError(`${field} is required`);
    }
    return value;
}
export function requireArray(value, field) {
    if (!Array.isArray(value)) {
        throw new ValidationError(`${field} must be an array`);
    }
    return value;
}
export const PERMISSION_ACTIONS = [
    "read",
    "write",
    "execute",
    "deploy",
    "external_communication",
    "secret_access",
];
export function validatePermissionGrant(grant, field = "permission") {
    if (grant.effect !== "allow" && grant.effect !== "deny") {
        throw new ValidationError(`${field}.effect must be "allow" or "deny"`);
    }
    if (!PERMISSION_ACTIONS.includes(grant.action)) {
        throw new ValidationError(`${field}.action is not a known permission action`);
    }
}
export function validateAgent(agent) {
    requireText(agent.id, "agent.id");
    requireText(agent.name, "agent.name");
    requireText(agent.description, "agent.description");
    requireArray(agent.capabilities, "agent.capabilities");
    requireArray(agent.allowedTools, "agent.allowedTools");
    requireArray(agent.allowedProjects, "agent.allowedProjects");
    requireArray(agent.supportedTaskTypes, "agent.supportedTaskTypes");
    requireArray(agent.permissions, "agent.permissions");
    if (agent.capabilities.length === 0) {
        throw new ValidationError("agent.capabilities must not be empty");
    }
    agent.permissions.forEach((grant, index) => validatePermissionGrant(grant, `agent.permissions[${index}]`));
    if (agent.modelPolicy) {
        const { provider, model } = agent.modelPolicy;
        if (provider !== undefined && typeof provider !== "string") {
            throw new ValidationError("agent.modelPolicy.provider must be a string");
        }
        if (model !== undefined && typeof model !== "string") {
            throw new ValidationError("agent.modelPolicy.model must be a string");
        }
    }
}
export function validateTaskDraft(draft) {
    requireText(draft.type, "task.type");
    requireText(draft.description, "task.description");
    requireText(draft.projectId, "task.projectId");
}
export function validateHandoffDraft(draft) {
    requireText(draft.taskId, "handoff.taskId");
    requireText(draft.sourceAgentId, "handoff.sourceAgentId");
    requireText(draft.destinationAgentId, "handoff.destinationAgentId");
    requireText(draft.completedWork, "handoff.completedWork");
    requireText(draft.remainingWork, "handoff.remainingWork");
    requireArray(draft.acceptanceCriteria, "handoff.acceptanceCriteria");
    if (draft.sourceAgentId === draft.destinationAgentId) {
        throw new ValidationError("handoff source and destination agents must differ");
    }
    if (draft.acceptanceCriteria.length === 0) {
        throw new ValidationError("handoff.acceptanceCriteria must not be empty");
    }
}
export function validateApprovalRequest(draft) {
    requireText(draft.action, "approval.action");
    requireText(draft.requestedBy, "approval.requestedBy");
    requireText(draft.reason, "approval.reason");
}
export * from "./storage.js";
export * from "./research.js";
export * from "./tools.js";
export * from "./workflow.js";
export * from "./project-manager.js";
export * from "./developer.js";
export * from "./qa.js";
export * from "./money-mind.js";
export * from "./control.js";
export * from "./environments.js";
export * from "./planning.js";
