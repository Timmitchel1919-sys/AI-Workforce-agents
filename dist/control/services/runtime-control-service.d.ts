/**
 * RuntimeControlService — the governed read/command surface for the Execution
 * Runtime and the Live Development Workspace (Layer 5).
 *
 * Reads need `view` plus access to the session's project; a foreign session is
 * indistinguishable from a missing one. File inspection goes through the same
 * governed file system the agents use (path guard, sensitive files hidden,
 * secrets masked). Commands need `orchestrate_execution`, are audited as
 * `control_command`, and never accept a command line or a path to run.
 */
import { type CommandOptions, type ControlCommandResult, type OperatorPrincipal } from "../../contracts/index.js";
import { type RuntimeEvent, type RuntimeOverview, type RuntimeSession, type RuntimeSessionSummary, type RuntimeWorkspaceDescriptor } from "../../contracts/execution-runtime.js";
import type { AuditLog, ExecutionOrchestrator, SessionManager, TreeEntry, WorkspaceResolver } from "../../core/index.js";
type Body = Record<string, unknown>;
export declare class RuntimeControlService {
    private readonly sessions;
    private readonly resolver;
    private readonly orchestrator;
    private readonly audit;
    private readonly clock;
    constructor(sessions: SessionManager, resolver: Pick<WorkspaceResolver, "resolve">, orchestrator: Pick<ExecutionOrchestrator, "stats"> | undefined, audit: AuditLog, clock?: () => string);
    private requireReader;
    private mustSee;
    overview(principal: OperatorPrincipal): RuntimeOverview;
    list(principal: OperatorPrincipal, filter?: {
        projectId?: string;
        runId?: string;
        limit?: number;
    }): RuntimeSessionSummary[];
    get(principal: OperatorPrincipal, executionId: string): RuntimeSession;
    /** Long-poll: resolves as soon as there are events after `after`, or after `waitMs`. */
    events(principal: OperatorPrincipal, executionId: string, after: number, waitMs: number): Promise<{
        events: RuntimeEvent[];
        status: RuntimeSession["status"];
        done: boolean;
    }>;
    workspace(principal: OperatorPrincipal, executionId: string): Promise<RuntimeWorkspaceDescriptor>;
    tree(principal: OperatorPrincipal, executionId: string, dir?: string): Promise<{
        entries: TreeEntry[];
        truncated: boolean;
    }>;
    file(principal: OperatorPrincipal, executionId: string, path: string): Promise<{
        path: string;
        content: string;
        size: number;
        hash: string;
        truncated: boolean;
    }>;
    private fileSystem;
    runtimeCancelSession(p: OperatorPrincipal, b: Body, o?: CommandOptions): ControlCommandResult;
    runtimePauseSession(p: OperatorPrincipal, b: Body, o?: CommandOptions): ControlCommandResult;
    runtimeResumeSession(p: OperatorPrincipal, b: Body, o?: CommandOptions): ControlCommandResult;
    private command;
    private result;
}
export {};
