/**
 * Mirror of the Control Plane contract `contracts/execution-orchestration.ts`.
 * The UI cannot import from the repository root, so the shapes it renders are
 * copied here with identical names. Run status, progress and cost are derived
 * on the server; the UI only displays them.
 */
import type { IntentCategory, RiskLevel, ValidationStatus } from "../promptIntelligence/types";

export const ORCH_TASK_TYPES = [
  "RESEARCH", "ANALYSIS", "DESIGN", "DEVELOPMENT", "REVIEW", "TEST", "SECURITY",
  "DOCUMENTATION", "INTEGRATION", "DEPLOYMENT", "MAINTENANCE",
] as const;
export type OrchTaskType = (typeof ORCH_TASK_TYPES)[number];

export const ORCH_TASK_STATUSES = [
  "PENDING", "READY", "QUEUED", "RUNNING", "BLOCKED", "WAITING_APPROVAL", "REVIEW",
  "FAILED", "RETRYING", "COMPLETED", "CANCELLED",
] as const;
export type OrchTaskStatus = (typeof ORCH_TASK_STATUSES)[number];

export const ORCH_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type OrchPriority = (typeof ORCH_PRIORITIES)[number];

export type GateKind = "review" | "qa" | "security";
export const GATE_KINDS: readonly GateKind[] = ["review", "qa", "security"];

export const FAILURE_CLASSES = ["TRANSIENT", "LOGICAL", "SECURITY", "APPROVAL"] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export const RECOVERY_ACTIONS = ["RETRY", "CORRECT", "REASSIGN", "WAIT", "BLOCK", "ESCALATE"] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

export const BLOCK_KINDS = ["routing", "budget", "security", "runtime", "dependency"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const APPROVAL_TRACE_STATES = ["requested", "approved", "rejected", "expired"] as const;

export interface AgentAssignmentEvidence {
  agentId: string;
  agentName: string;
  coveredCapabilities: string[];
  reasons: string[];
  workload: number;
}

export interface ModelAssignment {
  provider?: string;
  model?: string;
  reason: string;
  routingDecisionId?: string;
}

export interface TaskFailure {
  at: string;
  taskId: string;
  agentId?: string;
  model?: string;
  tool?: string;
  error: string;
  classification: FailureClass;
  retryCount: number;
  recovery: RecoveryAction;
}

export interface TaskResult {
  claimed: "success" | "failure";
  summary: string;
  evidence: string[];
  checks: { name: string; passed: boolean }[];
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
  prompt: string;
  destructive: boolean;
  requiresApproval: boolean;
  approval?: TaskApprovalTrace;
  gate?: GateKind;
  correctionTarget?: string;
  resources: string[];
  excludedAgents: string[];
  independentOf: string[];
  attempts: number;
  maxAttempts: number;
  corrections: number;
  notBefore?: string;
  blockedReason?: string;
  blockKind?: BlockKind;
  result?: TaskResult;
  failures: TaskFailure[];
  estimate?: { inputTokens: number; note: string };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export const RUN_STATUSES = [
  "NOT_STARTED", "PLANNING", "EXECUTING", "BLOCKED", "WAITING_APPROVAL", "REVIEW",
  "COMPLETED", "FAILED", "CANCELLED",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface ExecutionRun {
  id: string;
  runId: string;
  requestId: string;
  promptVersion: number;
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
  constraints: string[];
  acceptanceCriteria: string[];
  relevantFiles: string[];
  tasks: OrchTask[];
  planNotes: string[];
  revision: number;
}

export interface RunProgress {
  total: number;
  completed: number;
  percent: number;
}

export interface RunView {
  run: ExecutionRun;
  status: RunStatus;
  progress: RunProgress;
  activeTaskIds: string[];
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
  "orchestration_create", "orchestration_start", "orchestration_advance", "orchestration_pause",
  "orchestration_resume", "orchestration_cancel", "orchestration_retry_task",
] as const;
export type OrchestrationCommand = (typeof ORCHESTRATION_COMMANDS)[number];

/** Subset of a Layer 3 prompt request summary used to pick a request to plan from. */
export interface PreparedRequestSummary {
  requestId: string;
  projectId: string;
  createdAt: string;
  validation: ValidationStatus;
  request: string;
}

/** Validation statuses a plan may be created from. */
export const PLANNABLE_VALIDATIONS: readonly ValidationStatus[] = ["PASS", "WARN", "APPROVAL_REQUIRED"];

export const EXECUTE_CAPABILITY = "orchestrate_execution";
export const RUN_LIST_LIMIT = 50;
export const POLL_INTERVAL_MS = 3000;
