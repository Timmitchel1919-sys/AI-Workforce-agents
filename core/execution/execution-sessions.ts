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
import {
  StateTransitionError,
  ValidationError,
  canTransitionSession,
  isTerminalSession,
  type ExecutionAttempt,
  type ExecutionAttemptStatus,
  type ExecutionSession,
  type ExecutionSessionStatus,
} from "../../contracts/index.js";

/** Pure transition. Throws `StateTransitionError` for an illegal move. */
export function transitionSession(
  session: ExecutionSession,
  to: ExecutionSessionStatus,
  at: string,
  patch: Partial<Pick<ExecutionSession, "reasons" | "cancellation">> = {},
): ExecutionSession {
  if (!canTransitionSession(session.status, to)) {
    throw new StateTransitionError(
      `execution session ${session.sessionId} cannot move from ${session.status} to ${to}`,
    );
  }
  return {
    ...session,
    ...patch,
    status: to,
    ...(to === "running" && !session.startedAt ? { startedAt: at } : {}),
    ...(isTerminalSession(to) ? { endedAt: at } : {}),
    revision: session.revision + 1,
  };
}

const ATTEMPT_TERMINAL: readonly ExecutionAttemptStatus[] = [
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
];

/** Open a new attempt. Only a `running` session may have one open attempt. */
export function beginAttempt(
  session: ExecutionSession,
  attemptId: string,
  at: string,
): ExecutionSession {
  if (session.status !== "running") {
    throw new StateTransitionError(
      `execution session ${session.sessionId} is ${session.status}; attempts need a running session`,
    );
  }
  if (session.attempts.some((a) => !ATTEMPT_TERMINAL.includes(a.status))) {
    throw new StateTransitionError(
      `execution session ${session.sessionId} already has an open attempt`,
    );
  }
  const attempt: ExecutionAttempt = {
    attemptId,
    sessionId: session.sessionId,
    number: session.attempts.length + 1,
    status: "running",
    startedAt: at,
  };
  return {
    ...session,
    attempts: [...session.attempts, attempt],
    revision: session.revision + 1,
  };
}

/** Close the open attempt. A closed attempt is never reopened or rewritten. */
export function finishAttempt(
  session: ExecutionSession,
  attemptId: string,
  status: Exclude<ExecutionAttemptStatus, "pending" | "running">,
  at: string,
  receiptId?: string,
): ExecutionSession {
  const attempt = session.attempts.find((a) => a.attemptId === attemptId);
  if (!attempt) throw new ValidationError(`unknown attempt ${attemptId}`);
  if (ATTEMPT_TERMINAL.includes(attempt.status)) {
    throw new StateTransitionError(
      `attempt ${attemptId} is already ${attempt.status}`,
    );
  }
  return {
    ...session,
    attempts: session.attempts.map((a) =>
      a.attemptId === attemptId
        ? { ...a, status, endedAt: at, ...(receiptId ? { receiptId } : {}) }
        : a,
    ),
    revision: session.revision + 1,
  };
}

export type CancelOutcome =
  | "cancelled"
  | "cancelling"
  | "already_cancelled"
  | "already_cancelling"
  | "already_terminal";

/**
 * State-aware, idempotent cancellation:
 *   created/validating/ready → cancelled (nothing is running),
 *   running → cancelling (the sandbox must confirm termination),
 *   cancelling / cancelled → unchanged (idempotent),
 *   other terminal states → unchanged (`already_terminal`, history intact).
 */
export function planCancellation(
  session: ExecutionSession,
  request: { by: string; at: string; reason: string; kind: "cancel" | "kill" },
): { outcome: CancelOutcome; session: ExecutionSession } {
  if (session.status === "cancelled") {
    return { outcome: "already_cancelled", session };
  }
  if (session.status === "cancelling") {
    return { outcome: "already_cancelling", session };
  }
  if (isTerminalSession(session.status)) {
    return { outcome: "already_terminal", session };
  }
  const cancellation = {
    requestedBy: request.by,
    requestedAt: request.at,
    reason: request.reason,
    kind: request.kind,
  };
  if (session.status === "running") {
    return {
      outcome: "cancelling",
      session: transitionSession(session, "cancelling", request.at, {
        cancellation,
      }),
    };
  }
  return {
    outcome: "cancelled",
    session: transitionSession(session, "cancelled", request.at, {
      cancellation,
      reasons: [
        ...session.reasons,
        {
          code: "CANCELLED",
          detail: `${request.kind} requested by an operator`,
        },
      ],
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Store                                                              */
/* ------------------------------------------------------------------ */

export type SessionCommitResult = "committed" | "conflict";

/** Authoritative session storage port (in-memory in EO-4.1). */
export interface ExecutionSessionStore {
  get(sessionId: string): Promise<ExecutionSession | undefined>;
  listByProject(projectId: string): Promise<ExecutionSession[]>;
  findByIdempotencyKey(
    requestedBy: string,
    idempotencyKey: string,
  ): Promise<ExecutionSession | undefined>;
  /** Insert (expectedRevision undefined) or compare-and-swap update. */
  commit(
    session: ExecutionSession,
    expectedRevision?: number,
  ): Promise<SessionCommitResult>;
}

export class InMemoryExecutionSessionStore implements ExecutionSessionStore {
  private readonly sessions = new Map<string, ExecutionSession>();
  private readonly idempotency = new Map<string, string>();

  async get(sessionId: string) {
    const s = this.sessions.get(sessionId);
    return s ? structuredClone(s) : undefined;
  }

  async listByProject(projectId: string) {
    return [...this.sessions.values()]
      .filter((s) => s.projectId === projectId)
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          a.sessionId.localeCompare(b.sessionId),
      )
      .map((s) => structuredClone(s));
  }

  async findByIdempotencyKey(requestedBy: string, idempotencyKey: string) {
    const id = this.idempotency.get(`${requestedBy}\u0000${idempotencyKey}`);
    return id ? this.get(id) : undefined;
  }

  async commit(session: ExecutionSession, expectedRevision?: number) {
    const current = this.sessions.get(session.sessionId);
    if (expectedRevision === undefined) {
      const key = `${session.requestedBy}\u0000${session.idempotencyKey}`;
      if (current || this.idempotency.has(key)) return "conflict";
      this.idempotency.set(key, session.sessionId);
    } else if (!current || current.revision !== expectedRevision) {
      return "conflict";
    }
    this.sessions.set(session.sessionId, structuredClone(session));
    return "committed";
  }
}
