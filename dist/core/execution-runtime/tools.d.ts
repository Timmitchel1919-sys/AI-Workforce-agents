import { type CommandRecord, type CommandSpec, type FileChange, type RuntimeSession, type ValidationStageResult, type RuntimeWorkspaceOperation } from "../../contracts/execution-runtime.js";
import type { ProcessRunner } from "./process-runner.js";
import type { SessionManager } from "./session-manager.js";
import type { GitOps } from "./git-ops.js";
import { GovernedFileSystem, type ResolvedWorkspace } from "./workspace.js";
export interface RuntimeToolDefinition {
    id: string;
    name: string;
    /** Capability taxonomy id of the agent role this tool is meant for. */
    capability: string;
    risk: "low" | "medium" | "high";
    operations: readonly string[];
    /** Workspace operations the tool needs the workspace to permit. */
    permissions: readonly RuntimeWorkspaceOperation[];
    input: string;
    output: string;
}
export declare const RUNTIME_TOOLS: readonly RuntimeToolDefinition[];
export declare class ToolDeniedError extends Error {
    readonly tool: string;
    constructor(tool: string, message: string);
}
export declare class CommandRefusedError extends Error {
    readonly commandClass: "REVIEW_REQUIRED" | "BLOCKED";
    constructor(commandClass: "REVIEW_REQUIRED" | "BLOCKED", message: string);
}
export declare class ExecutionCancelledError extends Error {
    constructor();
}
export declare class ExecutionPausedError extends Error {
    constructor();
}
export declare class CommandTimeoutError extends Error {
    constructor(display: string);
}
export interface GateInput {
    projectId: string;
    executionId: string;
    taskId: string;
    agentId: string;
    modelId?: string;
    taskType?: string;
    toolId: string;
    action: string;
    resource: string;
    command?: string;
    content?: string;
    count?: number;
    expectedScope?: readonly string[];
    environment?: string;
}
export interface GateVerdict {
    effect: "ALLOW" | "REQUIRE_REVIEW" | "REQUIRE_SECURITY_REVIEW" | "REQUIRE_APPROVAL" | "DENY";
    risk: string;
    reasons: string[];
    explanation: string;
    policies: string[];
    approvalId?: string;
}
/** The policy decision point the runtime asks BEFORE every file write, delete, command or git action. */
export interface ActionGate {
    check(input: GateInput): Promise<GateVerdict>;
    noteRefusal?(note: {
        kind: "command" | "path";
        detail: string;
        agentId: string;
        projectId: string;
        taskId: string;
        executionId: string;
    }): void;
}
export declare class PolicyDeniedError extends Error {
    readonly verdict?: GateVerdict | undefined;
    constructor(message: string, verdict?: GateVerdict | undefined);
}
export declare class PolicyApprovalRequiredError extends Error {
    readonly approvalId: string | undefined;
    readonly verdict?: GateVerdict | undefined;
    constructor(message: string, approvalId: string | undefined, verdict?: GateVerdict | undefined);
}
/** The integration hub as the runtime sees it. Agents get capabilities, never providers or credentials. */
export interface CapabilityPort {
    discover(projectId: string): {
        capability: string;
        description: string;
        operation: string;
        risk: string;
        approval: string;
        available: boolean;
        reason?: string;
    }[];
    invoke(request: {
        capability: string;
        projectId: string;
        agentId: string;
        taskId: string;
        executionId: string;
        taskType?: string;
        resource?: string;
        parameters: Record<string, unknown>;
    }): Promise<{
        success: boolean;
        data?: unknown;
        error?: {
            kind: string;
            message: string;
            retryable: boolean;
            approvalId?: string;
        };
        connectorId?: string;
    }>;
}
export interface ToolSessionDeps {
    /** The integration hub (Layer 8). Absent when no hub is composed. */
    capabilities?: CapabilityPort;
    /** Layer 7: the governance gate. Absent only in tests of the bare runtime. */
    gate?: ActionGate;
    taskType?: string;
    expectedScope?: readonly string[];
    modelId?: string;
    session: RuntimeSession;
    manager: SessionManager;
    workspace: ResolvedWorkspace;
    permittedTools: readonly string[];
    /** The task's own human approval was granted (unlocks destructive file ops). */
    approved: boolean;
    runner: ProcessRunner;
    git: GitOps;
    clock: () => string;
    /** Upper bound on any command (tests and tight deployments). */
    maxCommandMs?: number;
}
export declare class AgentToolSession {
    private readonly deps;
    readonly fs: GovernedFileSystem;
    private readonly permitted;
    constructor(deps: ToolSessionDeps);
    get permittedTools(): string[];
    tree(dir?: string): Promise<{
        entries: import("./workspace.js").TreeEntry[];
        truncated: boolean;
    }>;
    readFile(path: string): Promise<{
        path: string;
        content: string;
        size: number;
        hash: string;
        truncated: boolean;
    }>;
    createFile(path: string, content: string): Promise<{
        change: FileChange;
    }>;
    updateFile(path: string, content: string, expectedHash?: string): Promise<{
        change: FileChange;
    }>;
    renameFile(from: string, to: string): Promise<{
        change: FileChange;
    }>;
    moveFile(from: string, to: string): Promise<{
        change: FileChange;
    }>;
    deleteFile(path: string): Promise<{
        change: FileChange;
    }>;
    diff(): Promise<{
        changes: FileChange[];
    }>;
    gitState(): Promise<import("../../contracts/execution-runtime.js").GitState>;
    /** Run an allow-listed command. Anything else is refused, never executed. */
    runCommand(line: string): Promise<CommandRecord>;
    runSpec(spec: CommandSpec): Promise<CommandRecord>;
    /** Ask the governance gate (if any) and act on its verdict. */
    enforce(toolId: string, action: string, resource: string, extra?: {
        content?: string;
        command?: string;
        count?: number;
        environment?: string;
    }): Promise<GateVerdict | undefined>;
    private refusal;
    /** What can be asked of the integration hub in this project. */
    listCapabilities(): Promise<{
        capability: string;
        description: string;
        operation: string;
        risk: string;
        approval: string;
        available: boolean;
        reason?: string;
    }[]>;
    /**
     * Ask the integration hub for a capability. Denials and approvals surface as the same errors as any
     * other governed tool; other failures come back as a result the agent can read.
     */
    useCapability(capability: string, parameters: Record<string, unknown>, resource?: string): Promise<{
        success: boolean;
        data?: unknown;
        error?: {
            kind: string;
            message: string;
            retryable: boolean;
            approvalId?: string;
        };
        connectorId?: string;
    }>;
    /** Throws when the execution was cancelled or paused; otherwise a heartbeat. */
    checkpoint(): void;
    /** Record a masked, bounded progress event (used by the agent loop). */
    note(data: Record<string, unknown>): void;
    private execute;
    private track;
    private guard;
    private record;
}
export declare function parseTestCounts(output: string): ValidationStageResult["counts"] | undefined;
export declare function extractErrors(output: string, max?: number): string[];
/**
 * CODE → TYPE CHECK → LINT → TEST → BUILD. A failed stage stops the pipeline;
 * later stages are reported as skipped (never silently). A missing script is
 * reported as such: missing typecheck/lint are skipped, a missing test or
 * build is "unavailable" (not a pass).
 */
export declare function runValidation(tools: AgentToolSession, session: RuntimeSession, manager: SessionManager, scripts: readonly string[], stages: readonly ("typecheck" | "lint" | "test" | "build")[], clock: () => string): Promise<ValidationStageResult[]>;
export interface GateDecision {
    allowed: boolean;
    reasons: string[];
}
/**
 * Before commit: there are changes, the change stayed in scope, validation
 * (test + build) PASSED after the last change, and nothing looks like a
 * credential. Failed or unverified work is not committed.
 */
export declare function commitPolicy(runChanges: readonly FileChange[], validation: readonly ValidationStageResult[], scopeFlagged: boolean): GateDecision;
/** Push adds: correct repository + branch, and an existing verified commit. */
export declare function pushPolicy(commit: GateDecision, input: {
    branch: string;
    workspaceBranch?: string;
    repository?: string;
    hasCommit: boolean;
}): GateDecision;
