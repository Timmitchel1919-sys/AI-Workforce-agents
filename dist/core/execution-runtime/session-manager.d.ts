import { type Repository } from "../../contracts/index.js";
import { type RuntimeError, type RuntimeEvent, type RuntimeEventType, type RuntimeOverview, type RuntimeSession, type RuntimeSessionSummary, type RuntimeState } from "../../contracts/execution-runtime.js";
import type { AuditLog } from "../audit/audit-log.js";
export interface CreateSessionInput {
    projectId: string;
    runId?: string;
    workflowId?: string;
    taskId: string;
    agentId: string;
    modelId?: string;
    workspaceId?: string;
    estimatedInputTokens?: number;
    retries?: number;
}
export declare class SessionManager {
    private readonly sessions;
    private readonly audit;
    private readonly controllers;
    /** The single in-process source of truth; the repository is its durable write-through. */
    private readonly cache;
    private hydrated;
    private readonly waiters;
    private readonly clock;
    private readonly newId;
    constructor(sessions: Repository<RuntimeSession>, audit: AuditLog, options?: {
        clock?: () => string;
        newId?: () => string;
    });
    private all;
    create(input: CreateSessionInput): RuntimeSession;
    /** Move to `to` (validated) and persist. Terminal states release the controller. */
    transition(session: RuntimeSession, to: RuntimeState, patch?: {
        error?: RuntimeError;
        operation?: string;
    }): void;
    emit(session: RuntimeSession, type: RuntimeEventType, data: Record<string, unknown>): RuntimeEvent;
    /** Attach governance findings (review routing, drift) to a session and persist it. */
    annotateGovernance(executionId: string, patch: {
        reviewRequired?: string[];
        drift?: NonNullable<RuntimeSession["governance"]>["drift"];
    }): void;
    persist(session: RuntimeSession): void;
    signal(executionId: string): AbortSignal | undefined;
    cancel(executionId: string): RuntimeSession | undefined;
    /** Cancel every live session of a run (used when the run is cancelled). */
    cancelRun(runId: string): number;
    pause(session: RuntimeSession): void;
    resume(session: RuntimeSession): void;
    heartbeat(session: RuntimeSession): void;
    /**
     * Recovery: a session that is non-terminal, not running in THIS process and
     * whose heartbeat is stale was interrupted (restart, crash). It is failed
     * with a clear reason; its logs, changes and commands are preserved.
     */
    recoverStale(nowMs?: number): number;
    get(executionId: string): RuntimeSession | undefined;
    /** The live, mutable in-process record. */
    live(executionId: string): RuntimeSession | undefined;
    list(filter?: {
        projectId?: string;
        runId?: string;
        taskId?: string;
    }): RuntimeSession[];
    summary(session: RuntimeSession): RuntimeSessionSummary;
    activeCount(): number;
    overview(projectIds?: ReadonlySet<string>, queued?: number, waitingApproval?: number): RuntimeOverview;
    eventsAfter(executionId: string, after: number): RuntimeEvent[];
    /**
     * Resolve with events newer than `after`: immediately if there are any,
     * otherwise when the next one is emitted or after `timeoutMs`. Event-driven
     * delivery without aggressive polling.
     */
    waitForEvents(executionId: string, after: number, timeoutMs: number): Promise<RuntimeEvent[]>;
    private notify;
}
export declare class CapacityError extends Error {
    constructor(message: string);
}
