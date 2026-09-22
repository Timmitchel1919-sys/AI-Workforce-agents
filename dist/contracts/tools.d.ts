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
import { type Environment, type PermissionAction, type PermissionRequest } from "./index.js";
export declare const TOOL_EXECUTION_STATUSES: readonly ["success", "failure", "timeout", "denied", "approval_required"];
export type ToolExecutionStatus = (typeof TOOL_EXECUTION_STATUSES)[number];
export declare const TOOL_FAILURE_REASONS: readonly ["invalid_request", "unknown_tool", "agent_not_allowed", "project_not_allowed", "environment_not_allowed", "permission_denied", "approval_rejected", "approval_expired", "input_too_large", "output_too_large", "call_limit_exceeded", "tool_error", "timeout", "malformed_result", "internal_error"];
export type ToolFailureReason = (typeof TOOL_FAILURE_REASONS)[number];
/**
 * Lifecycle phase markers recorded on `tool_execution` audit events:
 * REGISTERED (registry) → REQUESTED → VALIDATED → RESOLVED → AUTHORIZED →
 * APPROVAL_REQUIRED → APPROVED → EXECUTING → COMPLETED | FAILED | TIMEOUT |
 * DENIED | LIMIT_EXCEEDED.
 */
export declare const TOOL_EXECUTION_PHASES: readonly ["requested", "validated", "resolved", "authorized", "approval_required", "approved", "executing", "completed", "failed", "timeout", "denied", "limit_exceeded"];
export type ToolExecutionPhase = (typeof TOOL_EXECUTION_PHASES)[number];
/** Token meaning "any" in a tool's `allowedAgents` / `allowedProjects`. */
export declare const TOOL_WILDCARD = "*";
export interface ToolExecutionLimits {
    maxCallsPerTask: number;
    maxCallsPerAgent: number;
    /** Per-call wall-clock ceiling (ms). */
    maxDurationMs: number;
    maxInputBytes: number;
    maxOutputBytes: number;
}
export declare const DEFAULT_TOOL_LIMITS: ToolExecutionLimits;
/** When a tool requires human approval before it runs. */
export interface ToolApprovalRule {
    /** Always require approval. */
    always?: boolean;
    /** Require approval in these environments. */
    environments?: readonly Environment[];
    /** Require approval for these permission actions. */
    actions?: readonly PermissionAction[];
    reason?: string;
}
/** Throws `ValidationError` when the value does not match. */
export type ToolSchemaValidator = (value: unknown) => void;
export interface ToolDefinition {
    id: string;
    name: string;
    description: string;
    version: string;
    capabilities: readonly string[];
    /** The single permission action a caller must hold. */
    requiredPermission: {
        action: PermissionAction;
    };
    /** Absent = never approval-gated. */
    approvalPolicy?: ToolApprovalRule;
    /** Agent ids allowed to call this tool. `["*"]` = any. Empty = none. */
    allowedAgents: readonly string[];
    /** Project ids this tool may run for. `["*"]` = any. Empty = none. */
    allowedProjects: readonly string[];
    /** Environments this tool may run in. Non-empty. */
    allowedEnvironments: readonly Environment[];
    /** Per-call timeout (ms). */
    timeoutMs: number;
    limits: ToolExecutionLimits;
    inputSchema?: ToolSchemaValidator;
    outputSchema?: ToolSchemaValidator;
    metadata: Record<string, unknown>;
}
/** Everything a tool handler receives. No permission system, no credentials. */
export interface ToolExecutionContext {
    requestId: string;
    taskId: string;
    agentId: string;
    projectId: string;
    environment: Environment;
    /** Clock value (ms) after which the handler should abort. */
    deadlineMs: number;
}
export interface Tool extends ToolDefinition {
    execute(input: unknown, context: ToolExecutionContext): Promise<unknown>;
}
export interface ToolExecutionRequest {
    requestId: string;
    taskId: string;
    agentId: string;
    projectId: string;
    toolId: string;
    action: PermissionAction;
    input: unknown;
    environment: Environment;
    requestedAt: string;
    metadata: Record<string, unknown>;
}
export interface ToolExecutionRequestDraft {
    taskId: string;
    agentId: string;
    projectId: string;
    toolId: string;
    action?: PermissionAction;
    input?: unknown;
    environment?: Environment;
    metadata?: Record<string, unknown>;
}
export interface ToolExecutionError {
    reason: ToolFailureReason;
    message: string;
    details: Record<string, unknown>;
}
export interface ToolExecutionResult {
    requestId: string;
    toolId: string;
    taskId: string;
    status: ToolExecutionStatus;
    /** Present on `success`. */
    output?: unknown;
    /** Present on `failure` / `timeout` / `denied`. Never carries a credential. */
    error?: ToolExecutionError;
    /** Present on `approval_required`. */
    approvalId?: string;
    durationMs: number;
    timestamp: string;
    metadata: Record<string, unknown>;
}
/** Alias matching the Phase 4 spec vocabulary. */
export type ToolResult = ToolExecutionResult;
export declare function validateToolExecutionLimits(limits: ToolExecutionLimits): void;
export declare function validateToolDefinition(def: ToolDefinition): void;
export declare function validateToolExecutionRequest(request: ToolExecutionRequest): void;
/** Build the `PermissionRequest` the engine asserts for a tool call. */
export declare function toolPermissionRequest(request: ToolExecutionRequest): PermissionRequest;
