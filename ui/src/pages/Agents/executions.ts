/**
 * Agent execution intelligence — pure model (UI-5D).
 *
 * There is no `Execution` / `AgentRun` entity anywhere in the Control Plane
 * (verified against `contracts/index.ts`, `contracts/control.ts`,
 * `control/derive.ts`, `core/orchestrator/orchestrator.ts`). The closest real
 * signal is the audit trail: `core/orchestrator/orchestrator.ts` records
 * `agent_executed` when a task is dispatched to an agent, followed by exactly
 * one terminal `task_completed` or `task_failed` for the same `taskId`. That
 * pair — both real, timestamped, backend-redacted audit events — is what this
 * module treats as "one execution". Nothing here is fabricated: an execution
 * without a matched terminal event shows no duration rather than a guessed
 * one, and a task that never even started never gets an invented start time.
 */
import type { AuditEventView } from "../../api/contracts";
import { durationBetween } from "../../lib/duration";

export type ExecutionStatus = "running" | "completed" | "failed" | "unknown";

export interface AgentExecutionView {
  /** The starting event's id when known, else the terminal event's id. */
  id: string;
  taskId?: string;
  agentId?: string;
  projectId?: string;
  status: ExecutionStatus;
  /** `agent_executed` timestamp — absent if the dispatch event is outside the loaded window. */
  startedAt?: string;
  /** `task_completed` / `task_failed` timestamp — absent while running or unknown. */
  completedAt?: string;
  /** Only set when both a real start and a real end were observed. */
  durationMs: number | null;
  /** From the (already backend-redacted) `task_failed` audit data. */
  error?: string;
  startEventId?: string;
  completedEventId?: string;
}

const EXECUTION_EVENT_TYPES = new Set([
  "agent_executed",
  "task_completed",
  "task_failed",
]);

function errorText(event: AuditEventView): string | undefined {
  const raw = (event.data as Record<string, unknown> | undefined)?.["error"];
  return typeof raw === "string" && raw.trim() ? raw : undefined;
}

function pairedExecution(
  start: AuditEventView,
  end: AuditEventView,
): AgentExecutionView {
  const status: ExecutionStatus =
    end.type === "task_failed" ? "failed" : "completed";
  return {
    id: start.id,
    taskId: start.taskId ?? end.taskId,
    agentId: start.agentId ?? end.agentId,
    projectId: start.projectId ?? end.projectId,
    status,
    startedAt: start.timestamp,
    completedAt: end.timestamp,
    durationMs: durationBetween(start.timestamp, end.timestamp),
    error: status === "failed" ? errorText(end) : undefined,
    startEventId: start.id,
    completedEventId: end.id,
  };
}

function terminalOnlyExecution(end: AuditEventView): AgentExecutionView {
  const status: ExecutionStatus =
    end.type === "task_failed" ? "failed" : "completed";
  return {
    id: end.id,
    taskId: end.taskId,
    agentId: end.agentId,
    projectId: end.projectId,
    status,
    completedAt: end.timestamp,
    durationMs: null,
    error: status === "failed" ? errorText(end) : undefined,
    completedEventId: end.id,
  };
}

function openExecution(
  start: AuditEventView,
  currentTaskId: string | undefined,
): AgentExecutionView {
  const isCurrent = Boolean(start.taskId) && start.taskId === currentTaskId;
  return {
    id: start.id,
    taskId: start.taskId,
    agentId: start.agentId,
    projectId: start.projectId,
    // Only claim "running" when corroborated by the agent's own currentTaskId
    // — an unmatched start could just mean its terminal event fell outside
    // the loaded audit window, not that the task is still in flight.
    status: isCurrent ? "running" : "unknown",
    startedAt: start.timestamp,
    durationMs: null,
    startEventId: start.id,
  };
}

/**
 * Correlate `agent_executed` → `task_completed`/`task_failed` audit events
 * (same `taskId`) into executions. `events` may be in any order and may
 * include unrelated audit types — both are filtered/sorted internally.
 */
export function pairExecutions(
  events: readonly AuditEventView[],
  currentTaskId: string | undefined,
): AgentExecutionView[] {
  const chronological = events
    .filter((e) => EXECUTION_EVENT_TYPES.has(e.type))
    .slice()
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const open = new Map<string, AuditEventView>();
  const results: AgentExecutionView[] = [];

  for (const event of chronological) {
    if (event.type === "agent_executed") {
      if (event.taskId) {
        open.set(event.taskId, event);
      } else {
        results.push(openExecution(event, currentTaskId));
      }
      continue;
    }
    const start = event.taskId ? open.get(event.taskId) : undefined;
    if (start) {
      if (event.taskId) open.delete(event.taskId);
      results.push(pairedExecution(start, event));
    } else {
      results.push(terminalOnlyExecution(event));
    }
  }

  for (const start of open.values()) {
    results.push(openExecution(start, currentTaskId));
  }

  return results.sort((a, b) => {
    const at = Date.parse(a.completedAt ?? a.startedAt ?? "");
    const bt = Date.parse(b.completedAt ?? b.startedAt ?? "");
    return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
  });
}

export interface ExecutionsSummary {
  active: number;
  completed: number;
  failed: number;
  /** `null` when no execution in the loaded window has a computed duration. */
  averageDurationMs: number | null;
}

/** Derived only from the executions actually loaded — a windowed, not a
 * lifetime, summary. (Lifetime totals already live in `AgentView.stats`.) */
export function summarizeExecutions(
  executions: readonly AgentExecutionView[],
): ExecutionsSummary {
  let active = 0;
  let completed = 0;
  let failed = 0;
  const durations: number[] = [];
  for (const e of executions) {
    if (e.status === "running") active += 1;
    else if (e.status === "completed") completed += 1;
    else if (e.status === "failed") failed += 1;
    if (e.durationMs !== null) durations.push(e.durationMs);
  }
  const averageDurationMs =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null;
  return { active, completed, failed, averageDurationMs };
}

export type ExecutionStatusFilter = ExecutionStatus | "all";

export interface ExecutionFilters {
  search: string;
  status: ExecutionStatusFilter;
}

export const EMPTY_EXECUTION_FILTERS: ExecutionFilters = {
  search: "",
  status: "all",
};

export function executionFiltersActive(filters: ExecutionFilters): boolean {
  return filters.search.trim() !== "" || filters.status !== "all";
}

export function filterExecutions(
  executions: readonly AgentExecutionView[],
  filters: ExecutionFilters,
): AgentExecutionView[] {
  const q = filters.search.trim().toLowerCase();
  return executions.filter((e) => {
    if (filters.status !== "all" && e.status !== filters.status) return false;
    if (!q) return true;
    return (
      e.id.toLowerCase().includes(q) ||
      Boolean(e.taskId?.toLowerCase().includes(q)) ||
      Boolean(e.error?.toLowerCase().includes(q))
    );
  });
}
