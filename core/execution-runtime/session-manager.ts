/**
 * Execution sessions (Layer 5).
 *
 * One durable `RuntimeSession` per task execution: a closed state machine, a
 * bounded, secret-masked event stream (resumable by sequence number, with
 * long-poll delivery), persistence on every material change, cancellation and
 * pause control, and crash recovery from a stale heartbeat. State lives in the
 * repository, never only in memory or in the browser.
 */
import { randomBytes } from "node:crypto";
import {
  StateTransitionError,
  type Repository,
} from "../../contracts/index.js";
import {
  RUNTIME_LIMITS,
  TERMINAL_RUNTIME_STATES,
  canTransitionRuntime,
  type RuntimeError,
  type RuntimeEvent,
  type RuntimeEventType,
  type RuntimeOverview,
  type RuntimeSession,
  type RuntimeSessionSummary,
  type RuntimeState,
} from "../../contracts/execution-runtime.js";
import type { AuditLog } from "../audit/audit-log.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";

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

type Waiter = {
  after: number;
  resolve: (events: RuntimeEvent[]) => void;
  timer: NodeJS.Timeout;
};

/** Event types persisted to the audit log (command output is not). */
const AUDITED: ReadonlySet<RuntimeEventType> = new Set([
  "execution.created",
  "execution.started",
  "execution.command.started",
  "execution.command.completed",
  "execution.file.changed",
  "execution.scope.flagged",
  "execution.approval.requested",
  "execution.failed",
  "execution.cancelled",
  "execution.completed",
]);

function maskData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] =
      typeof value === "string" ? maskSecrets(value).slice(0, 2000) : value;
  }
  return out;
}

export class SessionManager {
  private readonly controllers = new Map<string, AbortController>();
  /** The single in-process source of truth; the repository is its durable write-through. */
  private readonly cache = new Map<string, RuntimeSession>();
  private hydrated = false;
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly clock: () => string;
  private readonly newId: () => string;

  constructor(
    private readonly sessions: Repository<RuntimeSession>,
    private readonly audit: AuditLog,
    options: { clock?: () => string; newId?: () => string } = {},
  ) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.newId =
      options.newId ?? (() => `exec-${randomBytes(6).toString("hex")}`);
  }

  /* -------------------------------------------------------------- */

  private all(): RuntimeSession[] {
    if (!this.hydrated) {
      this.hydrated = true;
      for (const stored of this.sessions.list()) {
        if (!this.cache.has(stored.id))
          this.cache.set(stored.id, structuredClone(stored));
      }
    }
    return [...this.cache.values()];
  }

  create(input: CreateSessionInput): RuntimeSession {
    if (this.activeCount() >= RUNTIME_LIMITS.maxConcurrentSessions) {
      throw new CapacityError(
        "the execution runtime is at its concurrency limit",
      );
    }
    const now = this.clock();
    const id = this.newId();
    const session: RuntimeSession = {
      id,
      executionId: id,
      projectId: input.projectId,
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.workflowId ? { workflowId: input.workflowId } : {}),
      taskId: input.taskId,
      agentId: input.agentId,
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      status: "CREATED",
      createdAt: now,
      updatedAt: now,
      paused: false,
      heartbeatAt: now,
      commands: [],
      changes: [],
      validation: [],
      tools: [],
      retries: input.retries ?? 0,
      ...(input.estimatedInputTokens !== undefined
        ? { estimatedInputTokens: input.estimatedInputTokens }
        : {}),
      events: [],
      nextSeq: 1,
      revision: 1,
    };
    this.controllers.set(id, new AbortController());
    this.all();
    this.cache.set(id, session);
    this.sessions.upsert(structuredClone(session));
    this.emit(session, "execution.created", {
      taskId: input.taskId,
      agentId: input.agentId,
    });
    return session;
  }

  /** Move to `to` (validated) and persist. Terminal states release the controller. */
  transition(
    session: RuntimeSession,
    to: RuntimeState,
    patch: { error?: RuntimeError; operation?: string } = {},
  ): void {
    if (session.status === to) return;
    if (!canTransitionRuntime(session.status, to)) {
      throw new StateTransitionError(
        `execution ${session.executionId}: illegal transition ${session.status} → ${to}`,
      );
    }
    session.status = to;
    session.updatedAt = this.clock();
    session.heartbeatAt = session.updatedAt;
    if (patch.operation !== undefined)
      session.currentOperation = patch.operation;
    if (to === "RUNNING" && !session.startedAt) {
      session.startedAt = session.updatedAt;
      this.emit(session, "execution.started", {});
    }
    if (TERMINAL_RUNTIME_STATES.includes(to)) {
      session.completedAt = session.updatedAt;
      delete session.currentOperation;
      this.controllers.delete(session.executionId);
    }
    if (patch.error)
      session.error = {
        ...patch.error,
        message: maskSecrets(patch.error.message).slice(0, 1000),
      };
    this.emit(session, "execution.state", { status: to });
    if (to === "SUCCEEDED") this.emit(session, "execution.completed", {});
    else if (to === "CANCELLED") this.emit(session, "execution.cancelled", {});
    else if (to === "FAILED" || to === "TIMED_OUT") {
      this.emit(session, "execution.failed", {
        status: to,
        error: session.error?.message ?? "",
      });
    }
    this.persist(session);
  }

  emit(
    session: RuntimeSession,
    type: RuntimeEventType,
    data: Record<string, unknown>,
  ): RuntimeEvent {
    const event: RuntimeEvent = {
      seq: session.nextSeq,
      executionId: session.executionId,
      type,
      at: this.clock(),
      data: maskData(data),
    };
    session.nextSeq += 1;
    session.events.push(event);
    if (session.events.length > RUNTIME_LIMITS.maxEvents) {
      session.events.splice(
        0,
        session.events.length - RUNTIME_LIMITS.maxEvents,
      );
    }
    session.heartbeatAt = event.at;
    if (AUDITED.has(type)) {
      this.audit.record("execution_event", {
        projectId: session.projectId,
        taskId: session.taskId,
        agentId: session.agentId,
        data: {
          event: type,
          executionId: session.executionId,
          runId: session.runId,
          ...event.data,
        },
      });
    }
    this.notify(session.executionId, event);
    return event;
  }

  persist(session: RuntimeSession): void {
    session.revision += 1;
    session.updatedAt = this.clock();
    this.sessions.upsert(structuredClone(session));
  }

  /* -------------------------------------------------------------- */
  /* control                                                        */
  /* -------------------------------------------------------------- */

  signal(executionId: string): AbortSignal | undefined {
    return this.controllers.get(executionId)?.signal;
  }

  cancel(executionId: string): RuntimeSession | undefined {
    this.all();
    const session = this.cache.get(executionId);
    if (!session) return undefined;
    this.controllers.get(executionId)?.abort();
    if (!TERMINAL_RUNTIME_STATES.includes(session.status))
      this.transition(session, "CANCELLED");
    return session;
  }

  /** Cancel every live session of a run (used when the run is cancelled). */
  cancelRun(runId: string): number {
    let n = 0;
    for (const session of this.all()) {
      if (
        session.runId === runId &&
        !TERMINAL_RUNTIME_STATES.includes(session.status)
      ) {
        this.controllers.get(session.executionId)?.abort();
        n += 1;
      }
    }
    return n;
  }

  pause(session: RuntimeSession): void {
    session.paused = true;
    this.persist(session);
  }
  resume(session: RuntimeSession): void {
    session.paused = false;
    this.persist(session);
  }

  heartbeat(session: RuntimeSession): void {
    session.heartbeatAt = this.clock();
  }

  /**
   * Recovery: a session that is non-terminal, not running in THIS process and
   * whose heartbeat is stale was interrupted (restart, crash). It is failed
   * with a clear reason; its logs, changes and commands are preserved.
   */
  recoverStale(nowMs = Date.parse(this.clock())): number {
    let recovered = 0;
    for (const session of this.all()) {
      if (TERMINAL_RUNTIME_STATES.includes(session.status)) continue;
      if (this.controllers.has(session.executionId)) continue;
      if (
        nowMs - Date.parse(session.heartbeatAt) <
        RUNTIME_LIMITS.staleHeartbeatMs
      )
        continue;
      // CREATED/INITIALIZING/READY/RUNNING/PAUSED/WAITING/REVIEWING all allow FAILED except
      // WAITING_APPROVAL (which allows FAILED too) — all legal.
      this.transition(session, "FAILED", {
        error: {
          kind: "ENVIRONMENT_ERROR",
          message:
            "the execution was interrupted (the runtime restarted or lost the process)",
          at: this.clock(),
        },
      });
      recovered += 1;
    }
    return recovered;
  }

  /* -------------------------------------------------------------- */
  /* queries                                                        */
  /* -------------------------------------------------------------- */

  get(executionId: string): RuntimeSession | undefined {
    this.all();
    const found = this.cache.get(executionId);
    return found ? structuredClone(found) : undefined;
  }

  /** The live, mutable in-process record. */
  live(executionId: string): RuntimeSession | undefined {
    this.all();
    return this.cache.get(executionId);
  }

  list(
    filter: { projectId?: string; runId?: string; taskId?: string } = {},
  ): RuntimeSession[] {
    // Newest first; creation order breaks ties so ordering never depends on clock resolution.
    return this.all()
      .map((session, index) => ({ session, index }))
      .filter(({ session: s }) =>
        filter.projectId ? s.projectId === filter.projectId : true,
      )
      .filter(({ session: s }) =>
        filter.runId ? s.runId === filter.runId : true,
      )
      .filter(({ session: s }) =>
        filter.taskId ? s.taskId === filter.taskId : true,
      )
      .sort(
        (a, b) =>
          b.session.createdAt.localeCompare(a.session.createdAt) ||
          b.index - a.index,
      )
      .map(({ session }) => session);
  }

  summary(session: RuntimeSession): RuntimeSessionSummary {
    return {
      executionId: session.executionId,
      projectId: session.projectId,
      ...(session.runId ? { runId: session.runId } : {}),
      taskId: session.taskId,
      agentId: session.agentId,
      status: session.status,
      ...(session.currentOperation
        ? { currentOperation: session.currentOperation }
        : {}),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      changedFiles: new Set(session.changes.map((c) => c.path)).size,
      flagged: session.scope?.status === "FLAGGED_FOR_REVIEW",
    };
  }

  activeCount(): number {
    return this.all().filter((s) => !TERMINAL_RUNTIME_STATES.includes(s.status))
      .length;
  }

  overview(
    projectIds?: ReadonlySet<string>,
    queued = 0,
    waitingApproval = 0,
  ): RuntimeOverview {
    const mine = this.all().filter((s) =>
      projectIds ? projectIds.has(s.projectId) : true,
    );
    const today = new Date(this.clock()).toISOString().slice(0, 10);
    return {
      active: mine.filter(
        (s) =>
          s.status === "RUNNING" ||
          s.status === "INITIALIZING" ||
          s.status === "READY" ||
          s.status === "REVIEWING",
      ).length,
      queued,
      waitingApproval:
        waitingApproval +
        mine.filter((s) => s.status === "WAITING_APPROVAL").length,
      failed: mine.filter(
        (s) => s.status === "FAILED" || s.status === "TIMED_OUT",
      ).length,
      completedToday: mine.filter(
        (s) =>
          s.status === "SUCCEEDED" && (s.completedAt ?? "").startsWith(today),
      ).length,
    };
  }

  /* -------------------------------------------------------------- */
  /* event delivery (resumable, long-poll)                          */
  /* -------------------------------------------------------------- */

  eventsAfter(executionId: string, after: number): RuntimeEvent[] {
    this.all();
    const session = this.cache.get(executionId);
    return session ? session.events.filter((e) => e.seq > after) : [];
  }

  /**
   * Resolve with events newer than `after`: immediately if there are any,
   * otherwise when the next one is emitted or after `timeoutMs`. Event-driven
   * delivery without aggressive polling.
   */
  waitForEvents(
    executionId: string,
    after: number,
    timeoutMs: number,
  ): Promise<RuntimeEvent[]> {
    const ready = this.eventsAfter(executionId, after);
    if (ready.length > 0 || timeoutMs <= 0) return Promise.resolve(ready);
    return new Promise((resolve) => {
      const set = this.waiters.get(executionId) ?? new Set<Waiter>();
      this.waiters.set(executionId, set);
      const waiter: Waiter = {
        after,
        resolve,
        timer: setTimeout(
          () => {
            set.delete(waiter);
            resolve([]);
          },
          Math.min(timeoutMs, 25_000),
        ),
      };
      set.add(waiter);
    });
  }

  private notify(executionId: string, event: RuntimeEvent): void {
    const set = this.waiters.get(executionId);
    if (!set) return;
    for (const waiter of [...set]) {
      if (event.seq > waiter.after) {
        clearTimeout(waiter.timer);
        set.delete(waiter);
        waiter.resolve(this.eventsAfter(executionId, waiter.after));
      }
    }
  }
}

export class CapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapacityError";
  }
}
