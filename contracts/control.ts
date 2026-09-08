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
import {
  requireText,
  ValidationError,
  type Entity,
  type Repository,
} from "./index.js";

/* ------------------------------------------------------------------ */
/* Operator authorization                                             */
/* ------------------------------------------------------------------ */

export const OPERATOR_ROLES = ["viewer", "operator", "admin"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

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
] as const;
export type ControlCapability = (typeof CONTROL_CAPABILITIES)[number];

/** Deny-by-default: a role has exactly the capabilities listed here. */
export const ROLE_CAPABILITIES: Record<
  OperatorRole,
  readonly ControlCapability[]
> = {
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
  ],
};

/**
 * The authenticated operator making a request. Authentication itself
 * (session, token, SSO) is the responsibility of whatever HTTP layer fronts
 * the control services — the services trust this object and enforce
 * authorization from it.
 */
export interface OperatorPrincipal {
  id: string;
  role: OperatorRole;
  /** `"*"` = every project. Otherwise an explicit allow-list. */
  allowedProjects: readonly string[] | "*";
}

export function validateOperatorPrincipal(principal: OperatorPrincipal): void {
  if (!principal || typeof principal !== "object") {
    throw new ValidationError("operator principal must be an object");
  }
  requireText(principal.id, "operator.id");
  if (!OPERATOR_ROLES.includes(principal.role)) {
    throw new ValidationError(
      `operator.role must be one of ${OPERATOR_ROLES.join(", ")}`,
    );
  }
  if (
    principal.allowedProjects !== "*" &&
    !Array.isArray(principal.allowedProjects)
  ) {
    throw new ValidationError(
      'operator.allowedProjects must be "*" or an array of project ids',
    );
  }
}

export function operatorCan(
  principal: OperatorPrincipal,
  capability: ControlCapability,
): boolean {
  return (ROLE_CAPABILITIES[principal.role] ?? []).includes(capability);
}

export function operatorCanAccessProject(
  principal: OperatorPrincipal,
  projectId: string,
): boolean {
  return (
    principal.allowedProjects === "*" ||
    principal.allowedProjects.includes(projectId)
  );
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
] as const;
export type ControlCommand = (typeof CONTROL_COMMANDS)[number];

/**
 * `executed` — the command ran and changed state.
 * `denied`   — authorization failed (wrong role / project).
 * `rejected` — the input or the current state made the command invalid.
 */
export type ControlCommandOutcome = "executed" | "denied" | "rejected";

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
] as const;
export type ControlErrorKind = (typeof CONTROL_ERROR_KINDS)[number];

/**
 * Per-request options carried alongside every command. `correlationId` ties a
 * control request to the command, the core operation it triggers, and the audit
 * event it produces. Generated when absent.
 */
export interface CommandOptions {
  correlationId?: string;
}

export interface ControlCommandResult {
  command: ControlCommand;
  outcome: ControlCommandOutcome;
  ok: boolean;
  /** Present on every non-`executed` outcome. */
  errorKind?: ControlErrorKind;
  /** Human-readable explanation — safe to show an operator. Never a secret. */
  reason: string;
  /** The primary resource the command targeted (task / workflow / agent / approval id). */
  resourceId?: string;
  /** Traces this result back through the audit event and the core operation. */
  correlationId: string;
  /** Extra structured detail (redacted). */
  details: Record<string, unknown>;
  /** Id of the `control_command` audit event this command produced. */
  auditEventId: string;
  timestamp: string;
}

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
] as const;
export type AgentOperationalStatus =
  (typeof AGENT_OPERATIONAL_STATUSES)[number];

export const HEALTH_STATUSES = [
  "healthy",
  "degraded",
  "unavailable",
  /** The component has not been measured in this build — not a failure. */
  "unknown",
] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const PROJECT_OPERATIONAL_STATUSES = [
  "available",
  "degraded",
  "unavailable",
] as const;
export type ProjectOperationalStatus =
  (typeof PROJECT_OPERATIONAL_STATUSES)[number];

export const APPROVAL_RISK_LEVELS = ["low", "medium", "high"] as const;
export type ApprovalRiskLevel = (typeof APPROVAL_RISK_LEVELS)[number];

/* ------------------------------------------------------------------ */
/* Operational state records (the "smallest necessary" state model)   */
/* ------------------------------------------------------------------ */

/**
 * Control-plane-owned operational flag for an agent. The `AgentRegistry`
 * definition is never mutated; this lives alongside it.
 */
export interface AgentOperationalRecord {
  id: string;
  agentId: string;
  enabled: boolean;
  disabledBy?: string;
  disabledReason?: string;
  disabledAt?: string;
  enabledBy?: string;
  enabledAt?: string;
  updatedAt: string;
}

/** Control-plane-owned pause flag for a workflow. */
export interface WorkflowControlRecord {
  id: string;
  workflowId: string;
  paused: boolean;
  pausedBy?: string;
  pauseReason?: string;
  pausedAt?: string;
  resumedBy?: string;
  resumedAt?: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Query views                                                        */
/* ------------------------------------------------------------------ */

export interface WorkforceStatusCounts {
  activeWorkflows: number;
  queuedTasks: number;
  runningTasks: number;
  blockedTasks: number;
  awaitingApproval: number;
  failedTasks: number;
  completedTasks: number;
  cancelledTasks: number;
  registeredAgents: number;
  disabledAgents: number;
  availableTools: number;
  registeredProjects: number;
}

export interface WorkforceStatus {
  status: HealthStatus;
  generatedAt: string;
  counts: WorkforceStatusCounts;
  recentActivity: readonly AuditEventView[];
}

export interface AgentStats {
  taskCount: number;
  completed: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
}

export interface AgentView {
  agentId: string;
  name: string;
  role: string;
  capabilities: readonly string[];
  status: AgentOperationalStatus;
  enabled: boolean;
  disabledReason?: string;
  currentTaskId?: string;
  currentProjectId?: string;
  allowedProjects: readonly string[];
  lastActivityAt?: string;
  stats: AgentStats;
}

export interface TaskView {
  taskId: string;
  type: string;
  description: string;
  projectId: string;
  status: string;
  priority: string;
  assignedAgentId?: string;
  workflowId?: string;
  workflowSpecId?: string;
  dependsOn: readonly string[];
  retryCount: number;
  failureReason?: string;
  lastError?: string;
  approvalId?: string;
  approvalState?: string;
  createdAt: string;
  updatedAt: string;
  /** Present only when explicitly requested and the operator is authorized. */
  redactedInputKeys?: readonly string[];
}

export interface TaskQuery {
  taskId?: string;
  workflowId?: string;
  projectId?: string;
  agentId?: string;
  status?: string;
  priority?: string;
  /** ISO timestamp — tasks updated at or after this. */
  since?: string;
  /** ISO timestamp — tasks updated at or before this. */
  until?: string;
  /** ISO timestamp — tasks created at or after this. */
  createdAfter?: string;
  /** ISO timestamp — tasks created at or before this. */
  createdBefore?: string;
  /** Only tasks in a failure state (`failed`, or `blocked`). */
  failedOnly?: boolean;
  limit?: number;
  cursor?: string;
}

export interface WorkflowStageView {
  specId: string;
  type: string;
  description: string;
  status: string;
  assignedAgentId?: string;
  retryCount: number;
  error?: string;
}

export interface WorkflowView {
  workflowId: string;
  name: string;
  description: string;
  projectId: string;
  status: string;
  paused: boolean;
  pauseReason?: string;
  progress: {
    completed: number;
    total: number;
    failed: number;
    blocked: number;
    fraction: number;
  };
  currentSpecId?: string;
  pendingApprovals: number;
  participatingAgents: readonly string[];
  stages: readonly WorkflowStageView[];
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

export interface ApprovalView {
  approvalId: string;
  status: string;
  action: string;
  risk: ApprovalRiskLevel;
  requestedBy: string;
  reason: string;
  taskId?: string;
  workflowId?: string;
  toolId?: string;
  agentId?: string;
  projectId?: string;
  requestedAt: string;
  expiresAt?: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface ProjectCapabilityView {
  operation: string;
  description: string;
  action: string;
}

export interface ProjectView {
  projectId: string;
  displayName: string;
  status: ProjectOperationalStatus;
  adapterStatus: HealthStatus;
  capabilities: readonly ProjectCapabilityView[];
  connectedAgents: readonly string[];
  activeWorkflows: number;
  recentTaskIds: readonly string[];
  recentActivity: readonly AuditEventView[];
}

export interface ToolExecutionStats {
  total: number;
  completed: number;
  failed: number;
  denied: number;
  timedOut: number;
  approvalRequired: number;
}

export interface ToolView {
  toolId: string;
  name: string;
  version: string;
  capabilities: readonly string[];
  allowedAgents: readonly string[];
  allowedProjects: readonly string[];
  allowedEnvironments: readonly string[];
  requiredPermission: string;
  approvalRequired: boolean;
  stats: ToolExecutionStats;
}

export interface AuditEventView {
  id: string;
  timestamp: string;
  type: string;
  /** Best-effort actor: operator id, agent id, or a system component. */
  actor?: string;
  taskId?: string;
  agentId?: string;
  projectId?: string;
  workflowId?: string;
  toolId?: string;
  /** Correlation id, when the originating operation carried one. */
  correlationId?: string;
  /** e.g. `completed` / `failed` / `denied` / `executed` — best effort. */
  outcome?: string;
  /** Redacted, bounded. */
  data: Record<string, unknown>;
}

export interface AuditEventQuery {
  type?: string;
  agentId?: string;
  projectId?: string;
  taskId?: string;
  workflowId?: string;
  toolId?: string;
  actor?: string;
  correlationId?: string;
  outcome?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}

export interface HealthComponent {
  name: string;
  status: HealthStatus;
  detail: string;
  checkedAt: string;
}

export interface SystemHealth {
  status: HealthStatus;
  generatedAt: string;
  components: readonly HealthComponent[];
}

export interface PageResult<T> {
  items: readonly T[];
  total: number;
  /** Opaque cursor for the next page, or `null` when there is no next page. */
  nextCursor: string | null;
}

/** The single bundle the operations dashboard renders from. Bounded. */
export interface DashboardSnapshot {
  generatedAt: string;
  operator: { id: string; role: OperatorRole };
  status: WorkforceStatus;
  health: SystemHealth;
  agents: readonly AgentView[];
  workflows: readonly WorkflowView[];
  tasks: readonly TaskView[];
  approvals: readonly ApprovalView[];
  projects: readonly ProjectView[];
  tools: readonly ToolView[];
  recentAudit: readonly AuditEventView[];
  /** Set when the snapshot could not be fully built. */
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Infrastructure ports (adapters plug in here — never the reverse)   */
/* ------------------------------------------------------------------ */

/**
 * The persistence port. The control-plane stores accept an injected
 * `Repository<T>`; a Firestore-backed implementation (bridged to sync by
 * `CachedRepository`) is the Phase 7B adapter. See ADR-0011.
 */
export type ControlRepository<T extends Entity> = Repository<T>;

/**
 * Resolves an opaque credential (session cookie, bearer token, Firebase ID
 * token) to an `OperatorPrincipal`, or `null` when it cannot be trusted. The
 * auth adapter implements this; the control services still trust only the
 * resolved principal and enforce authorization from it.
 */
export interface OperatorDirectory {
  resolve(credential: string): Promise<OperatorPrincipal | null>;
}

/** A control-plane change worth pushing to connected clients. */
export type ControlPlaneEvent =
  | { kind: "command_result"; result: ControlCommandResult }
  | { kind: "audit_appended"; event: AuditEventView }
  | { kind: "snapshot_invalidated"; reason: string; correlationId?: string };

/**
 * Fan-out seam for real-time updates. A no-op by default; a Phase 7B adapter
 * bridges it to Firestore / SSE / WebSocket. `publish` must never throw into a
 * command — implementations swallow their own failures.
 */
export interface ControlEventPublisher {
  publish(event: ControlPlaneEvent): void;
}

/* ------------------------------------------------------------------ */
/* Command inputs + validators                                        */
/* ------------------------------------------------------------------ */

export interface ApprovalCommandInput {
  approvalId: string;
  note?: string;
}
export interface RejectCommandInput {
  approvalId: string;
  reason: string;
}
export interface TaskCommandInput {
  taskId: string;
  reason?: string;
}
export interface WorkflowCommandInput {
  workflowId: string;
  reason?: string;
}
export interface AgentCommandInput {
  agentId: string;
  reason?: string;
}

export function requireId(value: unknown, field: string): string {
  return requireText(value, field);
}
