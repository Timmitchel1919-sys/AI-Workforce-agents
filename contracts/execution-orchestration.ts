/**
 * Execution Orchestration contracts (Layer 4).
 *
 *   PreparedExecutionRequest (Layer 3, validated)
 *     → Execution Planner → Task Decomposer → Dependency Engine
 *     → Workflow (run) → Agent Router → Model Router → Tool Authorization
 *     → Runtime → Verification → Review gates → Approval → next task / done
 *
 * Distinctions encoded here:
 *   PLANNED != EXECUTED            a task in a plan has run nothing
 *   QUALIFIED != AVAILABLE         an agent must be qualified, not merely exist
 *   CLAIMED SUCCESS != VERIFIED    an agent saying "done" is evidence, not proof
 *   APPROVAL REQUESTED != GRANTED  only a human decision releases a gate
 *   DERIVED != STORED STATE        run status is computed from its tasks
 *
 * Private, single-user platform: nothing here models tenants, organizations or
 * enterprise administration.
 */
import type { Entity } from "./persistence.js";
import type {
  CapabilityRole,
  IntentCategory,
  RiskLevel,
} from "./prompt-intelligence.js";

/* ------------------------------------------------------------------ */
/* Task model                                                         */
/* ------------------------------------------------------------------ */

export const ORCH_TASK_TYPES = [
  "RESEARCH",
  "ANALYSIS",
  "DESIGN",
  "DEVELOPMENT",
  "REVIEW",
  "TEST",
  "SECURITY",
  "DOCUMENTATION",
  "INTEGRATION",
  "DEPLOYMENT",
  "MAINTENANCE",
] as const;
export type OrchTaskType = (typeof ORCH_TASK_TYPES)[number];

export const ORCH_TASK_STATUSES = [
  "PENDING",
  "READY",
  "QUEUED",
  "RUNNING",
  "BLOCKED",
  "WAITING_APPROVAL",
  "REVIEW",
  "FAILED",
  "RETRYING",
  "COMPLETED",
  "CANCELLED",
] as const;
export type OrchTaskStatus = (typeof ORCH_TASK_STATUSES)[number];

/**
 * The only legal task transitions. `COMPLETED` and `CANCELLED` are terminal;
 * `FAILED` is terminal until an explicit operator retry (FAILED → RETRYING).
 */
export const ORCH_TASK_TRANSITIONS: Readonly<
  Record<OrchTaskStatus, readonly OrchTaskStatus[]>
> = Object.freeze({
  PENDING: ["READY", "BLOCKED", "WAITING_APPROVAL", "CANCELLED"],
  READY: [
    "QUEUED",
    "RUNNING",
    "BLOCKED",
    "WAITING_APPROVAL",
    "CANCELLED",
    "PENDING",
  ],
  QUEUED: ["RUNNING", "READY", "BLOCKED", "WAITING_APPROVAL", "CANCELLED"],
  RUNNING: ["REVIEW", "FAILED", "RETRYING", "BLOCKED", "CANCELLED"],
  BLOCKED: ["READY", "PENDING", "FAILED", "CANCELLED"],
  WAITING_APPROVAL: [
    "PENDING",
    "READY",
    "QUEUED",
    "RUNNING",
    "CANCELLED",
    "BLOCKED",
  ],
  REVIEW: ["COMPLETED", "FAILED", "RETRYING", "BLOCKED", "CANCELLED"],
  FAILED: ["RETRYING", "CANCELLED"],
  RETRYING: ["READY", "PENDING", "FAILED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
});

export function canTransitionOrchTask(
  from: OrchTaskStatus,
  to: OrchTaskStatus,
): boolean {
  return ORCH_TASK_TRANSITIONS[from].includes(to);
}

export const TERMINAL_TASK_STATUSES: readonly OrchTaskStatus[] = [
  "COMPLETED",
  "CANCELLED",
];

export const ORCH_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type OrchPriority = (typeof ORCH_PRIORITIES)[number];

/** Review gates a task may carry; a downstream task cannot skip them. */
export type GateKind = "review" | "qa" | "security";

export const FAILURE_CLASSES = [
  "TRANSIENT",
  "LOGICAL",
  "SECURITY",
  "APPROVAL",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export const RECOVERY_ACTIONS = [
  "RETRY",
  "CORRECT",
  "REASSIGN",
  "WAIT",
  "BLOCK",
  "ESCALATE",
] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

export interface AgentAssignmentEvidence {
  agentId: string;
  agentName: string;
  /** Which required capabilities this agent covers (and why it qualified). */
  coveredCapabilities: string[];
  reasons: string[];
  workload: number;
}

export interface ModelAssignment {
  provider?: string;
  model?: string;
  /** Why this model, or why none could be selected (never fabricated). */
  reason: string;
  routingDecisionId?: string;
}

export interface TaskFailure {
  at: string;
  taskId: string;
  agentId?: string;
  model?: string;
  tool?: string;
  /** Bounded, secret-scrubbed. */
  error: string;
  classification: FailureClass;
  retryCount: number;
  recovery: RecoveryAction;
}

export interface TaskResult {
  /** What the agent reported. NEVER proof by itself. */
  claimed: "success" | "failure";
  summary: string;
  evidence: string[];
  checks: { name: string; passed: boolean }[];
  /** Review-type tasks: the reviewer's verdict. */
  verdict?: "approved" | "changes_requested";
  verified: boolean;
  verifiedAt?: string;
  verification?: string;
}

export interface TaskApprovalTrace {
  approvalId: string;
  state: "requested" | "approved" | "rejected" | "expired";
  requestedAt: string;
}

export interface OrchTask {
  taskId: string;
  runId: string;
  projectId: string;
  parentTaskId?: string;
  title: string;
  description: string;
  type: OrchTaskType;
  /** Canonical capability taxonomy ids. */
  requiredCapabilities: string[];
  dependencies: string[];
  priority: OrchPriority;
  risk: RiskLevel;
  status: OrchTaskStatus;
  assignedAgent?: AgentAssignmentEvidence;
  assignedModel?: ModelAssignment;
  permittedTools: string[];
  deniedTools: string[];
  acceptanceCriteria: string[];
  /** Task-scoped instruction (a slice of the generated prompt). */
  prompt: string;
  destructive: boolean;
  requiresApproval: boolean;
  approval?: TaskApprovalTrace;
  /** This task is a mandatory gate of this kind. */
  gate?: GateKind;
  /** On a LOGICAL gate failure, send this implementer task back. */
  correctionTarget?: string;
  /** Exclusive resources (lock keys) this task writes. */
  resources: string[];
  /** This gate is a fresh re-run of an earlier (now stale) gate after a correction. */
  rerunOf?: string;
  /** Agents that must NOT take this task (independence / failed earlier). */
  excludedAgents: string[];
  /** Tasks whose assignee must differ from this task's assignee (review independence). */
  independentOf: string[];
  attempts: number;
  maxAttempts: number;
  corrections: number;
  /** Do not run before this ISO time (retry backoff). */
  notBefore?: string;
  blockedReason?: string;
  /** Why it is blocked: re-evaluated each advance except `security`. */
  blockKind?: "routing" | "budget" | "security" | "runtime" | "dependency";
  result?: TaskResult;
  failures: TaskFailure[];
  /** Token/context estimate. A dollar figure is only present if priced. */
  estimate?: { inputTokens: number; note: string };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

/* ------------------------------------------------------------------ */
/* Run (workflow) model                                               */
/* ------------------------------------------------------------------ */

export const RUN_STATUSES = [
  "NOT_STARTED",
  "PLANNING",
  "EXECUTING",
  "BLOCKED",
  "WAITING_APPROVAL",
  "REVIEW",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface OrchestrationPolicy {
  maxRetries: number;
  maxCorrections: number;
  maxParallel: number;
  /** Lock expiry so a crashed task cannot hold a resource forever. */
  lockTtlMs: number;
  retryBackoffMs: number;
}

export const DEFAULT_ORCHESTRATION_POLICY: OrchestrationPolicy = Object.freeze({
  maxRetries: 2,
  maxCorrections: 2,
  maxParallel: 3,
  lockTtlMs: 10 * 60_000,
  retryBackoffMs: 5_000,
});

/**
 * The normalized request an orchestration run is created from. It REFERENCES
 * the authoritative Layer 3 records (`requestId` + `promptVersion`) instead of
 * copying the resolved context, so there is one source of truth.
 */
export interface OrchestrationRequest {
  requestId: string;
  promptVersion: number;
  projectId: string;
  taskId?: string;
  objective: string;
  intent: IntentCategory;
  /** Reference to the stored Layer 3 context (prompt_requests/{requestId}). */
  resolvedContextRef: string;
  generatedPrompt: string;
  constraints: string[];
  acceptanceCriteria: string[];
  requiredCapabilities: string[];
  riskLevel: RiskLevel;
  approvalRequirements: string[];
  relevantFiles: string[];
  dependencies: string[];
  requestedOutputs: string[];
  executionPolicy: OrchestrationPolicy;
}

export interface ExecutionRun extends Entity {
  /** Run id (== `id`). */
  runId: string;
  /** The Layer 3 prompt request this run executes. */
  requestId: string;
  promptVersion: number;
  request: OrchestrationRequest;
  projectId: string;
  objective: string;
  intent: IntentCategory;
  riskLevel: RiskLevel;
  priority: OrchPriority;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  started: boolean;
  paused: boolean;
  cancelled: boolean;
  policy: OrchestrationPolicy;
  /** Constraints that every task must preserve (referenced from the request). */
  constraints: string[];
  acceptanceCriteria: string[];
  relevantFiles: string[];
  tasks: OrchTask[];
  /** Plan rationale: why these tasks exist (and which standard tasks were omitted). */
  planNotes: string[];
  revision: number;
}

export interface RunProgress {
  total: number;
  completed: number;
  /** completed / total, 0–100. Derived, never stored. */
  percent: number;
}

export interface RunView {
  run: ExecutionRun;
  status: RunStatus;
  progress: RunProgress;
  activeTaskIds: string[];
  /** Cost visibility (tokens always; dollars only when the ledger priced them). */
  cost: { estimatedInputTokens: number; spentUsd?: number; note: string };
}

export interface RunSummary {
  runId: string;
  requestId: string;
  projectId: string;
  objective: string;
  intent: IntentCategory;
  status: RunStatus;
  progress: RunProgress;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export const ORCHESTRATION_COMMANDS = [
  "orchestration_create",
  "orchestration_start",
  "orchestration_advance",
  "orchestration_pause",
  "orchestration_resume",
  "orchestration_cancel",
  "orchestration_retry_task",
] as const;
export type OrchestrationCommand = (typeof ORCHESTRATION_COMMANDS)[number];

/** Capability roles reused from Layer 3 (primary / supporting / verification). */
export type { CapabilityRole };
