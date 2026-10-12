/**
 * Execution Runtime & Live Development Workspace contracts (Layer 5).
 *
 *   Layer 4 task ─► Execution Runtime ─► Workspace Resolver ─► Command/File
 *   policy ─► Tool authorization ─► host (files / process / git) ─► events
 *   ─► session record ─► validation ─► result back to Layer 4 (verified there)
 *
 * Distinctions encoded here:
 *   RESOLVED != ASSUMED         a workspace is looked up explicitly, never inferred
 *   COMMAND != SHELL            only classified, structured commands run
 *   SAFE != REVIEW != BLOCKED   every command is classified before it can run
 *   CHANGED != EXPECTED         file changes are checked against the task scope
 *   AGENT CLAIM != VERIFIED     a build/test/diff is evidence; the agent's word is not
 *   DEPLOY != COMMAND           deployment is a hand-off, never a shell command
 *
 * Private, single-user platform: no tenants or enterprise administration.
 */
import type { Entity } from "./persistence.js";
export declare const RUNTIME_STATES: readonly ["CREATED", "INITIALIZING", "READY", "RUNNING", "PAUSED", "WAITING_APPROVAL", "REVIEWING", "SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"];
export type RuntimeState = (typeof RUNTIME_STATES)[number];
/** There is deliberately no edge from any state to a deployment state. */
export declare const RUNTIME_TRANSITIONS: Readonly<Record<RuntimeState, readonly RuntimeState[]>>;
export declare function canTransitionRuntime(from: RuntimeState, to: RuntimeState): boolean;
export declare const TERMINAL_RUNTIME_STATES: readonly RuntimeState[];
export declare const RUNTIME_ERROR_KINDS: readonly ["ENVIRONMENT_ERROR", "COMMAND_ERROR", "CODE_ERROR", "TEST_FAILURE", "BUILD_FAILURE", "NETWORK_ERROR", "AUTHORIZATION_ERROR", "SECURITY_ERROR", "TIMEOUT", "AGENT_ERROR", "MODEL_ERROR", "TOOL_ERROR"];
export type RuntimeErrorKind = (typeof RUNTIME_ERROR_KINDS)[number];
export interface RuntimeError {
    kind: RuntimeErrorKind;
    /** Operator-safe and secret-masked. */
    message: string;
    at: string;
}
export declare const RUNTIME_WORKSPACE_OPERATIONS: readonly ["read", "list", "create", "update", "rename", "move", "delete", "run_script", "git_read", "git_write"];
export type RuntimeWorkspaceOperation = (typeof RUNTIME_WORKSPACE_OPERATIONS)[number];
/** The environment a workspace lives in. Only `local` is implemented now. */
export declare const RUNTIME_WORKSPACE_ENVIRONMENTS: readonly ["local", "docker", "cloud_runner", "wsl"];
export type RuntimeWorkspaceEnvironment = (typeof RUNTIME_WORKSPACE_ENVIRONMENTS)[number];
/** What the UI and agents may see of a workspace. NEVER the host path. */
export interface RuntimeWorkspaceDescriptor {
    workspaceId: string;
    projectId: string;
    repository?: string;
    branch?: string;
    environment: RuntimeWorkspaceEnvironment;
    runtime: string;
    packageManager?: string;
    permittedOperations: RuntimeWorkspaceOperation[];
    /** npm scripts the workspace actually declares. */
    scripts: string[];
    resolvedAt: string;
}
export declare const COMMAND_CLASSES: readonly ["SAFE", "REVIEW_REQUIRED", "BLOCKED"];
export type CommandClass = (typeof COMMAND_CLASSES)[number];
/** A structured command. There is no free-form shell string anywhere. */
export type CommandSpec = {
    kind: "script";
    script: string;
} | {
    kind: "install";
} | {
    kind: "git";
    sub: "status" | "diff" | "log" | "branch";
};
export interface CommandClassification {
    class: CommandClass;
    reason: string;
    spec?: CommandSpec;
}
export interface CommandRecord {
    commandId: string;
    /** Display form only; it is never executed through a shell. */
    display: string;
    spec: CommandSpec;
    class: CommandClass;
    startedAt: string;
    completedAt?: string;
    exitCode?: number;
    durationMs?: number;
    timedOut: boolean;
    cancelled: boolean;
    /** Secret-masked, size-bounded. */
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
    /** Unified-style diff (masked, bounded). */
    diff?: string;
    renamedFrom?: string;
}
export interface ScopeReport {
    status: "IN_SCOPE" | "FLAGGED_FOR_REVIEW";
    /** What counted as expected for this task. */
    expected: string[];
    unexpected: string[];
    /** Unexpected AND in a security-sensitive area (auth, database, rules, config). */
    sensitive: string[];
}
export declare const VALIDATION_STAGES: readonly ["typecheck", "lint", "test", "build"];
export type ValidationStageName = (typeof VALIDATION_STAGES)[number];
export interface ValidationStageResult {
    stage: ValidationStageName;
    status: "passed" | "failed" | "skipped" | "unavailable";
    /** Why a stage was skipped/unavailable (never silently). */
    note?: string;
    command?: string;
    durationMs?: number;
    /** When the stage finished; commit/push require validation AFTER the last change. */
    completedAt?: string;
    counts?: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
    };
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
export declare const RUNTIME_EVENT_TYPES: readonly ["execution.created", "execution.started", "execution.state", "execution.command.started", "execution.command.output", "execution.command.completed", "execution.file.changed", "execution.test.started", "execution.test.completed", "execution.build.started", "execution.build.completed", "execution.scope.flagged", "execution.agent.step", "execution.approval.requested", "execution.failed", "execution.cancelled", "execution.completed"];
export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];
export interface RuntimeEvent {
    /** Monotonic per session; clients resume with `after=<seq>`. */
    seq: number;
    executionId: string;
    type: RuntimeEventType;
    at: string;
    /** Small, secret-masked payload. */
    data: Record<string, unknown>;
}
export interface GitState {
    branch?: string;
    head?: string;
    dirty: boolean;
    changedFiles: string[];
}
/** Durable record of one task execution inside a workspace (`runtime_sessions`). */
export interface RuntimeSession extends Entity {
    /** executionId (== `id`). */
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
    /** Refreshed while work is in flight; a stale heartbeat means a crashed process. */
    heartbeatAt: string;
    commands: CommandRecord[];
    changes: FileChange[];
    validation: ValidationStageResult[];
    scope?: ScopeReport;
    /** Governance findings for this execution (review routing, drift). */
    governance?: {
        reviewRequired: string[];
        drift?: import("./security-governance.js").DriftReport;
    };
    tools: ToolExecutionRecord[];
    gitState?: GitState;
    approval?: {
        approvalId?: string;
        reason: string;
    };
    error?: RuntimeError;
    /** Retries of this task seen by the runtime (cost visibility). */
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
    /** Layer 4 tasks waiting to run (READY/QUEUED). */
    queued: number;
    waitingApproval: number;
    failed: number;
    completedToday: number;
}
export declare const RUNTIME_COMMANDS: readonly ["runtime_cancel_session", "runtime_pause_session", "runtime_resume_session"];
export type RuntimeCommand = (typeof RUNTIME_COMMANDS)[number];
/** Bounds on everything the runtime keeps or returns. */
export declare const RUNTIME_LIMITS: Readonly<{
    maxOutputBytes: number;
    maxReadBytes: number;
    maxDiffBytes: number;
    maxEvents: 300;
    maxCommands: 40;
    maxChanges: 200;
    maxTools: 200;
    maxFileOps: 500;
    maxConcurrentSessions: 3;
    defaultTimeoutMs: 120000;
    staleHeartbeatMs: number;
}>;
