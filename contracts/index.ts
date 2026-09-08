/**
 * AI Workforce — Core Contracts
 *
 * Shared type contracts and pure validators for the Workforce foundation.
 * This module has NO dependency on any model provider, tool vendor, project
 * repository, or infrastructure. Everything provider- or project-specific
 * enters the system through the interfaces declared here and is implemented
 * under `adapters/`.
 */

/* ------------------------------------------------------------------ */
/* Shared primitives                                                  */
/* ------------------------------------------------------------------ */

export type Priority = "low" | "normal" | "high" | "critical";

export const ENVIRONMENTS = ["local", "test", "staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/* ------------------------------------------------------------------ */
/* Permissions                                                        */
/* ------------------------------------------------------------------ */

export type PermissionAction =
  | "read"
  | "write"
  | "execute"
  | "deploy"
  | "external_communication"
  | "secret_access";

export type PermissionEffect = "allow" | "deny";

/**
 * A single deny-by-default permission rule. Any scope field left `undefined`
 * acts as a wildcard for that dimension.
 */
export interface PermissionGrant {
  effect: PermissionEffect;
  action: PermissionAction;
  agentId?: string;
  projectId?: string;
  toolId?: string;
  environment?: Environment;
  reason?: string;
}

export interface PermissionRequest {
  action: PermissionAction;
  agentId: string;
  projectId: string;
  toolId?: string;
  environment: Environment;
}

export interface PermissionDecision {
  allowed: boolean;
  reason: string;
  matched?: PermissionGrant;
}

/**
 * A capability a task needs before an agent may act on it. The orchestrator
 * fills in agent / project / environment and asserts each entry against the
 * {@link PermissionSystem} at the execution boundary.
 */
export interface RequiredPermission {
  action: PermissionAction;
  toolId?: string;
}

/* ------------------------------------------------------------------ */
/* Agents                                                             */
/* ------------------------------------------------------------------ */

export interface ModelPolicy {
  provider?: string;
  model?: string;
  maxOutputTokens?: number;
}

/**
 * Declarative description of an agent. An agent owns no behavior here — it is
 * metadata the registry validates and the orchestrator routes against.
 */
export interface Agent {
  id: string;
  name: string;
  description: string;
  capabilities: readonly string[];
  allowedTools: readonly string[];
  allowedProjects: readonly string[];
  supportedTaskTypes: readonly string[];
  permissions: readonly PermissionGrant[];
  modelPolicy?: ModelPolicy;
  metadata?: Record<string, unknown>;
}

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
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
  id: string;
  type: string;
  description: string;
  projectId: string;
  assignedAgentId?: string;
  priority: Priority;
  status: TaskStatus;
  input: unknown;
  output?: unknown;
  errors: string[];
  /** Capabilities the execution boundary must clear before dispatch. */
  requiredPermissions: readonly RequiredPermission[];
  /** Set while the task sits in `awaiting_approval`. */
  approvalId?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface TaskDraft {
  type: string;
  description: string;
  projectId: string;
  input?: unknown;
  priority?: Priority;
  requiredPermissions?: readonly RequiredPermission[];
  metadata?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Handoffs                                                           */
/* ------------------------------------------------------------------ */

export type HandoffStatus = "proposed" | "accepted" | "rejected";

export interface Handoff {
  id: string;
  taskId: string;
  sourceAgentId: string;
  destinationAgentId: string;
  status: HandoffStatus;
  context: Record<string, unknown>;
  completedWork: string;
  remainingWork: string;
  acceptanceCriteria: readonly string[];
  artifacts: readonly string[];
  risks: readonly string[];
  createdAt: string;
  resolvedAt?: string;
  resolution?: string;
}

export interface HandoffDraft {
  taskId: string;
  sourceAgentId: string;
  destinationAgentId: string;
  context?: Record<string, unknown>;
  completedWork: string;
  remainingWork: string;
  acceptanceCriteria: readonly string[];
  artifacts?: readonly string[];
  risks?: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Approvals                                                          */
/* ------------------------------------------------------------------ */

export type ApprovalStatus = "requested" | "approved" | "rejected" | "expired";

export interface Approval {
  id: string;
  action: string;
  requestedBy: string;
  reason: string;
  status: ApprovalStatus;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  expiresAt?: string;
  decisionMetadata: Record<string, unknown>;
}

export interface ApprovalRequestDraft {
  action: string;
  requestedBy: string;
  reason: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Deterministic decision on whether a task needs human approval before it can
 * be dispatched. Implementations must not auto-approve — they only decide
 * whether an approval request is required.
 */
export interface ApprovalRequirement {
  required: boolean;
  action?: string;
  reason?: string;
  /** Optional ISO timestamp after which the approval request should expire. */
  expiresAt?: string;
}

export interface ApprovalPolicy {
  evaluate(task: Task): ApprovalRequirement;
}

/* ------------------------------------------------------------------ */
/* Context                                                            */
/* ------------------------------------------------------------------ */

export interface TaskContext {
  scope: "task";
  taskId: string;
  projectId: string;
  values: Record<string, unknown>;
}

export interface ProjectContext {
  scope: "project";
  projectId: string;
  values: Record<string, unknown>;
}

export interface AgentContext {
  scope: "agent";
  agentId: string;
  projectId: string;
  values: Record<string, unknown>;
}

export type Context = TaskContext | ProjectContext | AgentContext;

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
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  timestamp: string;
  taskId?: string;
  agentId?: string;
  projectId?: string;
  data: Record<string, unknown>;
}

/** Pluggable destination for audit events. Local, in-process for Phase 1. */
export interface AuditSink {
  write(event: AuditEvent): void;
}

/* ------------------------------------------------------------------ */
/* Model provider interface                                           */
/* ------------------------------------------------------------------ */

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelRequest {
  messages: readonly ModelMessage[];
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface ModelResponse {
  content: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Provider-neutral text generation. Concrete providers live under adapters/. */
export interface ModelProvider {
  readonly id: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

/* ------------------------------------------------------------------ */
/* Tool provider interface                                            */
/* ------------------------------------------------------------------ */

export interface ToolRequest {
  tool: string;
  input: unknown;
  context: TaskContext;
}

export interface ToolResponse {
  output: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Provider-neutral external tool access. A concrete provider must expose only
 * explicitly named, individually reviewed tools — never unrestricted shell,
 * filesystem, or credential access.
 */
export interface ToolProvider {
  readonly id: string;
  readonly tools: readonly string[];
  execute(request: ToolRequest): Promise<ToolResponse>;
}

/* ------------------------------------------------------------------ */
/* Project adapter interface                                          */
/* ------------------------------------------------------------------ */

export interface ProjectCapability {
  operation: string;
  description: string;
  action: PermissionAction;
}

/**
 * Controlled access to a single real project (AIMS, Money Mind, Mastery,
 * Tripod, ...). Project internals are never copied into this repository; an
 * adapter exposes a fixed, declared set of operations.
 */
export interface ProjectAdapter {
  readonly projectId: string;
  describe(): Promise<{
    name: string;
    capabilities: readonly ProjectCapability[];
  }>;
  execute(operation: string, input: unknown): Promise<unknown>;
}

/* ------------------------------------------------------------------ */
/* Agent execution boundary                                           */
/* ------------------------------------------------------------------ */

/**
 * Guard handed to an executor so tool-level calls can be permission-checked at
 * the moment of use, in addition to the pre-dispatch checks the orchestrator
 * performs. Bound to one agent + task + environment.
 */
export interface PermissionGuard {
  assert(action: PermissionAction, toolId?: string): void;
}

/**
 * A pluggable unit of work the orchestrator dispatches a task to. A General
 * Agent is an `AgentExecutor` plus a declarative {@link Agent} definition.
 */
export interface AgentExecutor {
  execute(agent: Agent, task: Task, guard?: PermissionGuard): Promise<unknown>;
}

/** Hard ceilings a General Agent enforces on a single execution. */
export interface AgentLimits {
  maxIterations: number;
  maxToolCalls: number;
  maxModelCalls: number;
  timeoutMs: number;
}

export const DEFAULT_AGENT_LIMITS: AgentLimits = {
  maxIterations: 3,
  maxToolCalls: 8,
  maxModelCalls: 4,
  timeoutMs: 60_000,
};

export type AgentFailureReason =
  | "invalid_task"
  | "missing_context"
  | "model_unavailable"
  | "tool_unavailable"
  | "permission_denied"
  | "tool_failure"
  | "model_failure"
  | "timeout"
  | "limit_exceeded"
  | "invalid_result"
  | "internal_error";

/* ------------------------------------------------------------------ */
/* Errors                                                             */
/* ------------------------------------------------------------------ */

export class WorkforceError extends Error {}
export class ValidationError extends WorkforceError {}
export class StateTransitionError extends WorkforceError {}
export class PermissionDeniedError extends WorkforceError {}
export class NotFoundError extends WorkforceError {}

/**
 * Structured failure from a General Agent execution. Carries a machine-readable
 * `reason` and diagnostic `details` (never secrets). Agents fail closed with
 * this rather than returning a partial or unstructured result.
 */
export class AgentExecutionError extends WorkforceError {
  readonly agentId: string;
  readonly reason: AgentFailureReason;
  readonly details: Record<string, unknown>;

  constructor(
    agentId: string,
    reason: AgentFailureReason,
    message: string,
    details: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(
      `[${agentId}:${reason}] ${message}`,
      cause !== undefined ? { cause } : undefined,
    );
    this.name = "AgentExecutionError";
    this.agentId = agentId;
    this.reason = reason;
    this.details = details;
  }
}

/* ------------------------------------------------------------------ */
/* Provider errors                                                    */
/*                                                                    */
/* Provider-neutral: the "provider" here is any external model or tool */
/* vendor. Concrete adapters (e.g. Anthropic) map their SDK/API        */
/* failures onto these classes. Instances must never carry secrets.    */
/* ------------------------------------------------------------------ */

export interface ProviderErrorOptions {
  /** HTTP-ish status code, when the failure had one. */
  status?: number;
  /** Whether retrying the same request could plausibly succeed. */
  retryable?: boolean;
  /** Underlying error, for diagnostics. Never a credential. */
  cause?: unknown;
}

/** Base class for failures originating from an external provider. */
export class ProviderError extends WorkforceError {
  readonly provider: string;
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(
    provider: string,
    message: string,
    options: ProviderErrorOptions = {},
  ) {
    super(
      message,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
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
  readonly provider: string;

  constructor(provider: string, message: string) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderConfigError";
    this.provider = provider;
  }
}

/** Authentication / authorization failure (bad or missing credentials). */
export class ProviderAuthError extends ProviderError {}
/** The provider rejected the request for exceeding a rate limit. */
export class ProviderRateLimitError extends ProviderError {}
/** The request did not complete within the configured timeout. */
export class ProviderTimeoutError extends ProviderError {}
/** The provider could not be reached or returned a server-side error. */
export class ProviderUnavailableError extends ProviderError {}
/** The provider rejected the request as malformed (client-side, 4xx). */
export class ProviderRequestError extends ProviderError {}
/** The provider returned a response the adapter could not interpret. */
export class ProviderResponseError extends ProviderError {}

/* ------------------------------------------------------------------ */
/* Pure validators                                                    */
/* ------------------------------------------------------------------ */

export function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${field} is required`);
  }
  return value;
}

export function requireArray(
  value: unknown,
  field: string,
): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array`);
  }
  return value;
}

export const PERMISSION_ACTIONS: readonly PermissionAction[] = [
  "read",
  "write",
  "execute",
  "deploy",
  "external_communication",
  "secret_access",
];

export function validatePermissionGrant(
  grant: PermissionGrant,
  field = "permission",
): void {
  if (grant.effect !== "allow" && grant.effect !== "deny") {
    throw new ValidationError(`${field}.effect must be "allow" or "deny"`);
  }
  if (!PERMISSION_ACTIONS.includes(grant.action)) {
    throw new ValidationError(
      `${field}.action is not a known permission action`,
    );
  }
}

export function validateAgent(agent: Agent): void {
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

  agent.permissions.forEach((grant, index) =>
    validatePermissionGrant(grant, `agent.permissions[${index}]`),
  );

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

export function validateTaskDraft(draft: TaskDraft): void {
  requireText(draft.type, "task.type");
  requireText(draft.description, "task.description");
  requireText(draft.projectId, "task.projectId");
}

export function validateHandoffDraft(draft: HandoffDraft): void {
  requireText(draft.taskId, "handoff.taskId");
  requireText(draft.sourceAgentId, "handoff.sourceAgentId");
  requireText(draft.destinationAgentId, "handoff.destinationAgentId");
  requireText(draft.completedWork, "handoff.completedWork");
  requireText(draft.remainingWork, "handoff.remainingWork");
  requireArray(draft.acceptanceCriteria, "handoff.acceptanceCriteria");

  if (draft.sourceAgentId === draft.destinationAgentId) {
    throw new ValidationError(
      "handoff source and destination agents must differ",
    );
  }
  if (draft.acceptanceCriteria.length === 0) {
    throw new ValidationError("handoff.acceptanceCriteria must not be empty");
  }
}

export function validateApprovalRequest(draft: ApprovalRequestDraft): void {
  requireText(draft.action, "approval.action");
  requireText(draft.requestedBy, "approval.requestedBy");
  requireText(draft.reason, "approval.reason");
}

/* ------------------------------------------------------------------ */
/* Re-exports                                                         */
/* ------------------------------------------------------------------ */

export type {
  Entity,
  Repository,
  AsyncRepository,
  PersistenceProvider,
} from "./persistence.js";
export * from "./storage.js";

export * from "./research.js";
export * from "./tools.js";
export * from "./workflow.js";
export * from "./project-manager.js";
export * from "./developer.js";
export * from "./qa.js";
export * from "./money-mind.js";
export * from "./control.js";
