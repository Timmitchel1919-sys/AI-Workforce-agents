/**
 * Execution session lifecycle + store (EO-4.1).
 *
 *   created → validating → ready → running → succeeded | failed | timed_out
 *                  ↘ denied   ↘ cancelled     ↘ cancelling → cancelled
 *
 * Terminal states have no exits. A retry is a NEW attempt on a non-terminal
 * session — history is never rewritten. Sessions are optimistic-locked by
 * `revision`; creation is idempotent per `(requestedBy, idempotencyKey)`.
 */
import { type ExecutionAttemptStatus, type ExecutionSession, type ExecutionSessionStatus } from "../../contracts/index.js";
/** Pure transition. Throws `StateTransitionError` for an illegal move. */
export declare function transitionSession(session: ExecutionSession, to: ExecutionSessionStatus, at: string, patch?: Partial<Pick<ExecutionSession, "reasons" | "cancellation">>): ExecutionSession;
/** Open a new attempt. Only a `running` session may have one open attempt. */
export declare function beginAttempt(session: ExecutionSession, attemptId: string, at: string): ExecutionSession;
/** Close the open attempt. A closed attempt is never reopened or rewritten. */
export declare function finishAttempt(session: ExecutionSession, attemptId: string, status: Exclude<ExecutionAttemptStatus, "pending" | "running">, at: string, receiptId?: string): ExecutionSession;
export type CancelOutcome = "cancelled" | "cancelling" | "already_cancelled" | "already_cancelling" | "already_terminal";
/**
 * State-aware, idempotent cancellation:
 *   created/validating/ready → cancelled (nothing is running),
 *   running → cancelling (the sandbox must confirm termination),
 *   cancelling / cancelled → unchanged (idempotent),
 *   other terminal states → unchanged (`already_terminal`, history intact).
 */
export declare function planCancellation(session: ExecutionSession, request: {
    by: string;
    at: string;
    reason: string;
    kind: "cancel" | "kill";
}): {
    outcome: CancelOutcome;
    session: ExecutionSession;
};
export type SessionCommitResult = "committed" | "conflict";
/** Authoritative session storage port (in-memory in EO-4.1). */
export interface ExecutionSessionStore {
    get(sessionId: string): Promise<ExecutionSession | undefined>;
    listByProject(projectId: string): Promise<ExecutionSession[]>;
    findByIdempotencyKey(requestedBy: string, idempotencyKey: string): Promise<ExecutionSession | undefined>;
    /** Insert (expectedRevision undefined) or compare-and-swap update. */
    commit(session: ExecutionSession, expectedRevision?: number): Promise<SessionCommitResult>;
}
export declare class InMemoryExecutionSessionStore implements ExecutionSessionStore {
    private readonly sessions;
    private readonly idempotency;
    get(sessionId: string): Promise<ExecutionSession | undefined>;
    listByProject(projectId: string): Promise<ExecutionSession[]>;
    findByIdempotencyKey(requestedBy: string, idempotencyKey: string): Promise<ExecutionSession | undefined>;
    commit(session: ExecutionSession, expectedRevision?: number): Promise<"committed" | "conflict">;
}
