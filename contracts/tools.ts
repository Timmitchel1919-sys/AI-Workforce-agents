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
import {
  type Environment,
  type PermissionAction,
  type PermissionRequest,
  ENVIRONMENTS,
  PERMISSION_ACTIONS,
  requireText,
  ValidationError,
} from "./index.js";

/* ------------------------------------------------------------------ */
/* Enumerations                                                       */
/* ------------------------------------------------------------------ */

export const TOOL_EXECUTION_STATUSES = [
  "success",
  "failure",
  "timeout",
  "denied",
  "approval_required",
] as const;
export type ToolExecutionStatus = (typeof TOOL_EXECUTION_STATUSES)[number];

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
] as const;
export type ToolFailureReason = (typeof TOOL_FAILURE_REASONS)[number];

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
] as const;
export type ToolExecutionPhase = (typeof TOOL_EXECUTION_PHASES)[number];

/** Token meaning "any" in a tool's `allowedAgents` / `allowedProjects`. */
export const TOOL_WILDCARD = "*";

/* ------------------------------------------------------------------ */
/* Limits & policy                                                    */
/* ------------------------------------------------------------------ */

export interface ToolExecutionLimits {
  maxCallsPerTask: number;
  maxCallsPerAgent: number;
  /** Per-call wall-clock ceiling (ms). */
  maxDurationMs: number;
  maxInputBytes: number;
  maxOutputBytes: number;
}

export const DEFAULT_TOOL_LIMITS: ToolExecutionLimits = {
  maxCallsPerTask: 25,
  maxCallsPerAgent: 200,
  maxDurationMs: 30_000,
  maxInputBytes: 64 * 1024,
  maxOutputBytes: 1024 * 1024,
};

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

/* ------------------------------------------------------------------ */
/* Tool definition                                                    */
/* ------------------------------------------------------------------ */

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  capabilities: readonly string[];
  /** The single permission action a caller must hold. */
  requiredPermission: { action: PermissionAction };
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

/* ------------------------------------------------------------------ */
/* Request & result                                                   */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Validators                                                         */
/* ------------------------------------------------------------------ */

const LIMIT_KEYS: readonly (keyof ToolExecutionLimits)[] = [
  "maxCallsPerTask",
  "maxCallsPerAgent",
  "maxDurationMs",
  "maxInputBytes",
  "maxOutputBytes",
];

export function validateToolExecutionLimits(limits: ToolExecutionLimits): void {
  if (!limits || typeof limits !== "object") {
    throw new ValidationError("tool.limits must be an object");
  }
  for (const key of LIMIT_KEYS) {
    const value = limits[key];
    if (!Number.isInteger(value) || value <= 0) {
      throw new ValidationError(
        `tool.limits.${key} must be a positive integer`,
      );
    }
  }
}

export function validateToolDefinition(def: ToolDefinition): void {
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
  if (
    !def.requiredPermission ||
    !PERMISSION_ACTIONS.includes(def.requiredPermission.action)
  ) {
    throw new ValidationError(
      "tool.requiredPermission.action is not a known permission action",
    );
  }
  for (const key of ["allowedAgents", "allowedProjects"] as const) {
    if (!Array.isArray(def[key])) {
      throw new ValidationError(`tool.${key} must be an array`);
    }
  }
  if (
    !Array.isArray(def.allowedEnvironments) ||
    def.allowedEnvironments.length === 0
  ) {
    throw new ValidationError(
      "tool.allowedEnvironments must be a non-empty array",
    );
  }
  for (const env of def.allowedEnvironments) {
    if (!ENVIRONMENTS.includes(env)) {
      throw new ValidationError(
        `tool.allowedEnvironments contains unknown environment "${env}"`,
      );
    }
  }
  if (!Number.isInteger(def.timeoutMs) || def.timeoutMs <= 0) {
    throw new ValidationError("tool.timeoutMs must be a positive integer");
  }
  validateToolExecutionLimits(def.limits);
  if (def.inputSchema !== undefined && typeof def.inputSchema !== "function") {
    throw new ValidationError("tool.inputSchema must be a function");
  }
  if (
    def.outputSchema !== undefined &&
    typeof def.outputSchema !== "function"
  ) {
    throw new ValidationError("tool.outputSchema must be a function");
  }
  if (def.approvalPolicy !== undefined) {
    const rule = def.approvalPolicy;
    if (typeof rule !== "object") {
      throw new ValidationError("tool.approvalPolicy must be an object");
    }
    for (const env of rule.environments ?? []) {
      if (!ENVIRONMENTS.includes(env)) {
        throw new ValidationError(
          `tool.approvalPolicy.environments contains unknown environment "${env}"`,
        );
      }
    }
    for (const action of rule.actions ?? []) {
      if (!PERMISSION_ACTIONS.includes(action)) {
        throw new ValidationError(
          `tool.approvalPolicy.actions contains unknown action "${action}"`,
        );
      }
    }
  }
}

export function validateToolExecutionRequest(
  request: ToolExecutionRequest,
): void {
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
    throw new ValidationError(
      "toolRequest.action is not a known permission action",
    );
  }
  if (!ENVIRONMENTS.includes(request.environment)) {
    throw new ValidationError(
      "toolRequest.environment is not a known environment",
    );
  }
}

/** Build the `PermissionRequest` the engine asserts for a tool call. */
export function toolPermissionRequest(
  request: ToolExecutionRequest,
): PermissionRequest {
  return {
    action: request.action,
    toolId: request.toolId,
    agentId: request.agentId,
    projectId: request.projectId,
    environment: request.environment,
  };
}
