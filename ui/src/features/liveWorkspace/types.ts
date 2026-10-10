/**
 * Mirrors `contracts/execution-runtime.ts` (Layer 5). Names are identical so the contract stays the
 * single source of truth; the browser only ever reads these through the Control Plane.
 */

export const RUNTIME_STATES = [
  "CREATED", "INITIALIZING", "READY", "RUNNING", "PAUSED", "WAITING_APPROVAL",
  "REVIEWING", "SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT",
] as const;
export type RuntimeState = (typeof RUNTIME_STATES)[number];

export const TERMINAL_RUNTIME_STATES: readonly RuntimeState[] = ["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"];

export type RuntimeErrorKind =
  | "ENVIRONMENT_ERROR" | "COMMAND_ERROR" | "CODE_ERROR" | "TEST_FAILURE" | "BUILD_FAILURE" | "NETWORK_ERROR"
  | "AUTHORIZATION_ERROR" | "SECURITY_ERROR" | "TIMEOUT" | "AGENT_ERROR" | "MODEL_ERROR" | "TOOL_ERROR";

export interface RuntimeError { kind: RuntimeErrorKind; message: string; at: string }

export type RuntimeWorkspaceOperation =
  | "read" | "list" | "create" | "update" | "rename" | "move" | "delete" | "run_script" | "git_read" | "git_write";
export type RuntimeWorkspaceEnvironment = "local" | "docker" | "cloud_runner" | "wsl";

export interface RuntimeWorkspaceDescriptor {
  workspaceId: string;
  projectId: string;
  repository?: string;
  branch?: string;
  environment: RuntimeWorkspaceEnvironment;
  runtime: string;
  packageManager?: string;
  permittedOperations: RuntimeWorkspaceOperation[];
  scripts: string[];
  resolvedAt: string;
}

export type CommandClass = "SAFE" | "REVIEW_REQUIRED" | "BLOCKED";
export type CommandSpec =
  | { kind: "script"; script: string }
  | { kind: "install" }
  | { kind: "git"; sub: "status" | "diff" | "log" | "branch" };

export interface CommandRecord {
  commandId: string;
  display: string;
  spec: CommandSpec;
  class: CommandClass;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  durationMs?: number;
  timedOut: boolean;
  cancelled: boolean;
  output: string;
  truncated: boolean;
}

export type FileOperation = "create" | "update" | "rename" | "move" | "delete";

export interface FileChange {
  path: string;
  operation: FileOperation;
  at: string;
  taskId: string;
  agentId: string;
  beforeHash?: string;
  afterHash?: string;
  diff?: string;
  renamedFrom?: string;
}

export interface ScopeReport {
  status: "IN_SCOPE" | "FLAGGED_FOR_REVIEW";
  expected: string[];
  unexpected: string[];
  sensitive: string[];
}

export type ValidationStageName = "typecheck" | "lint" | "test" | "build";

export interface ValidationStageResult {
  stage: ValidationStageName;
  status: "passed" | "failed" | "skipped" | "unavailable";
  note?: string;
  command?: string;
  durationMs?: number;
  completedAt?: string;
  counts?: { total: number; passed: number; failed: number; skipped: number };
  errors: string[];
  warnings: number;
}

export interface ToolExecutionRecord {
  executionId: string;
  taskId: string;
  agentId: string;
  tool: string;
  operation: string;
  at: string;
  result: "ok" | "denied" | "error";
  error?: string;
  durationMs: number;
}

export type RuntimeEventType =
  | "execution.created" | "execution.started" | "execution.state"
  | "execution.command.started" | "execution.command.output" | "execution.command.completed"
  | "execution.file.changed" | "execution.test.started" | "execution.test.completed"
  | "execution.build.started" | "execution.build.completed" | "execution.scope.flagged"
  | "execution.approval.requested" | "execution.failed" | "execution.cancelled" | "execution.completed";

export interface RuntimeEvent {
  seq: number;
  executionId: string;
  type: RuntimeEventType;
  at: string;
  data: Record<string, unknown>;
}

export interface GitState { branch?: string; head?: string; dirty: boolean; changedFiles: string[] }

export interface RuntimeSession {
  id: string;
  executionId: string;
  projectId: string;
  runId?: string;
  workflowId?: string;
  taskId: string;
  agentId: string;
  modelId?: string;
  workspaceId?: string;
  status: RuntimeState;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  currentOperation?: string;
  paused: boolean;
  heartbeatAt: string;
  commands: CommandRecord[];
  changes: FileChange[];
  validation: ValidationStageResult[];
  scope?: ScopeReport;
  tools: ToolExecutionRecord[];
  gitState?: GitState;
  approval?: { approvalId?: string; reason: string };
  error?: RuntimeError;
  retries: number;
  estimatedInputTokens?: number;
  events: RuntimeEvent[];
  nextSeq: number;
  revision: number;
}

export interface RuntimeSessionSummary {
  executionId: string;
  projectId: string;
  runId?: string;
  taskId: string;
  agentId: string;
  status: RuntimeState;
  currentOperation?: string;
  createdAt: string;
  updatedAt: string;
  changedFiles: number;
  flagged: boolean;
}

export interface RuntimeOverview {
  active: number;
  queued: number;
  waitingApproval: number;
  failed: number;
  completedToday: number;
}

export type RuntimeCommand = "runtime_cancel_session" | "runtime_pause_session" | "runtime_resume_session";

/* UI-only shapes for the file endpoints and the long-poll response. */
export interface TreeEntry { path: string; type: "file" | "dir" }
export interface TreeResponse { entries: TreeEntry[]; truncated: boolean }
export interface FileResponse { path: string; content: string; size: number; hash: string; truncated: boolean }
export interface EventsResponse { events: RuntimeEvent[]; status: RuntimeState; done: boolean }

export const SESSION_LIST_LIMIT = 25;
export const EVENT_WAIT_MS = 20_000;
export const BACKOFF_START_MS = 1_000;
export const BACKOFF_MAX_MS = 10_000;
export const MAX_LIVE_EVENTS = 2_000;
/** UX gating only; the Control Plane enforces the capability. */
export const ORCHESTRATE_CAPABILITY = "orchestrate_execution";
