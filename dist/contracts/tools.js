/**
 * Tool & Execution Framework contracts.
 *
 * One standardised way for any agent to request a tool. The `Tool` definition
 * carries its own security policy (permissions, approval, allowed agents /
 * projects / environments, limits); the `ToolExecutionEngine` (core) is the
 * single enforcement point. Agents never invoke tools directly.
 *
 * Naming note: the low-level `ToolProvider` shapes `ToolRequest` / `ToolResponse`
 * (in `index.ts`) are the vendor-adapter surface a tool handler may wrap. The
 * framework request/result are `ToolExecutionRequest` / `ToolExecutionResult`
 * (aliased `ToolResult`).
 */
import { ENVIRONMENTS, PERMISSION_ACTIONS, requireText, ValidationError, } from "./index.js";
/* ------------------------------------------------------------------ */
/* Enumerations                                                       */
/* ------------------------------------------------------------------ */
export const TOOL_EXECUTION_STATUSES = [
    "success",
    "failure",
    "timeout",
    "denied",
    "approval_required",
];
export const TOOL_FAILURE_REASONS = [
    "invalid_request",
    "unknown_tool",
    "agent_not_allowed",
    "project_not_allowed",
    "environment_not_allowed",
    "permission_denied",
    "approval_rejected",
    "approval_expired",
    "input_too_large",
    "output_too_large",
    "call_limit_exceeded",
    "tool_error",
    "timeout",
    "malformed_result",
    "internal_error",
];
/**
 * Lifecycle phase markers recorded on `tool_execution` audit events:
 * REGISTERED (registry) → REQUESTED → VALIDATED → RESOLVED → AUTHORIZED →
 * APPROVAL_REQUIRED → APPROVED → EXECUTING → COMPLETED | FAILED | TIMEOUT |
 * DENIED | LIMIT_EXCEEDED.
 */
export const TOOL_EXECUTION_PHASES = [
    "requested",
    "validated",
    "resolved",
    "authorized",
    "approval_required",
    "approved",
    "executing",
    "completed",
    "failed",
    "timeout",
    "denied",
    "limit_exceeded",
];
/** Token meaning "any" in a tool's `allowedAgents` / `allowedProjects`. */
export const TOOL_WILDCARD = "*";
export const DEFAULT_TOOL_LIMITS = {
    maxCallsPerTask: 25,
    maxCallsPerAgent: 200,
    maxDurationMs: 30_000,
    maxInputBytes: 64 * 1024,
    maxOutputBytes: 1024 * 1024,
};
/* ------------------------------------------------------------------ */
/* Validators                                                         */
/* ------------------------------------------------------------------ */
const LIMIT_KEYS = [
    "maxCallsPerTask",
    "maxCallsPerAgent",
    "maxDurationMs",
    "maxInputBytes",
    "maxOutputBytes",
];
export function validateToolExecutionLimits(limits) {
    if (!limits || typeof limits !== "object") {
        throw new ValidationError("tool.limits must be an object");
    }
    for (const key of LIMIT_KEYS) {
        const value = limits[key];
        if (!Number.isInteger(value) || value <= 0) {
            throw new ValidationError(`tool.limits.${key} must be a positive integer`);
        }
    }
}
export function validateToolDefinition(def) {
    if (!def || typeof def !== "object") {
        throw new ValidationError("tool definition must be an object");
    }
    requireText(def.id, "tool.id");
    requireText(def.name, "tool.name");
    requireText(def.description, "tool.description");
    requireText(def.version, "tool.version");
    if (!Array.isArray(def.capabilities) || def.capabilities.length === 0) {
        throw new ValidationError("tool.capabilities must be a non-empty array");
    }
    if (!def.requiredPermission ||
        !PERMISSION_ACTIONS.includes(def.requiredPermission.action)) {
        throw new ValidationError("tool.requiredPermission.action is not a known permission action");
    }
    for (const key of ["allowedAgents", "allowedProjects"]) {
        if (!Array.isArray(def[key])) {
            throw new ValidationError(`tool.${key} must be an array`);
        }
    }
    if (!Array.isArray(def.allowedEnvironments) ||
        def.allowedEnvironments.length === 0) {
        throw new ValidationError("tool.allowedEnvironments must be a non-empty array");
    }
    for (const env of def.allowedEnvironments) {
        if (!ENVIRONMENTS.includes(env)) {
            throw new ValidationError(`tool.allowedEnvironments contains unknown environment "${env}"`);
        }
    }
    if (!Number.isInteger(def.timeoutMs) || def.timeoutMs <= 0) {
        throw new ValidationError("tool.timeoutMs must be a positive integer");
    }
    validateToolExecutionLimits(def.limits);
    if (def.inputSchema !== undefined && typeof def.inputSchema !== "function") {
        throw new ValidationError("tool.inputSchema must be a function");
    }
    if (def.outputSchema !== undefined &&
        typeof def.outputSchema !== "function") {
        throw new ValidationError("tool.outputSchema must be a function");
    }
    if (def.approvalPolicy !== undefined) {
        const rule = def.approvalPolicy;
        if (typeof rule !== "object") {
            throw new ValidationError("tool.approvalPolicy must be an object");
        }
        for (const env of rule.environments ?? []) {
            if (!ENVIRONMENTS.includes(env)) {
                throw new ValidationError(`tool.approvalPolicy.environments contains unknown environment "${env}"`);
            }
        }
        for (const action of rule.actions ?? []) {
            if (!PERMISSION_ACTIONS.includes(action)) {
                throw new ValidationError(`tool.approvalPolicy.actions contains unknown action "${action}"`);
            }
        }
    }
}
export function validateToolExecutionRequest(request) {
    if (!request || typeof request !== "object") {
        throw new ValidationError("tool request must be an object");
    }
    requireText(request.requestId, "toolRequest.requestId");
    requireText(request.taskId, "toolRequest.taskId");
    requireText(request.agentId, "toolRequest.agentId");
    requireText(request.projectId, "toolRequest.projectId");
    requireText(request.toolId, "toolRequest.toolId");
    requireText(request.requestedAt, "toolRequest.requestedAt");
    if (!PERMISSION_ACTIONS.includes(request.action)) {
        throw new ValidationError("toolRequest.action is not a known permission action");
    }
    if (!ENVIRONMENTS.includes(request.environment)) {
        throw new ValidationError("toolRequest.environment is not a known environment");
    }
}
/** Build the `PermissionRequest` the engine asserts for a tool call. */
export function toolPermissionRequest(request) {
    return {
        action: request.action,
        toolId: request.toolId,
        agentId: request.agentId,
        projectId: request.projectId,
        environment: request.environment,
    };
}
