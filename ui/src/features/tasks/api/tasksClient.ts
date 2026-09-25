import { apiRequest } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import type { TaskDetail, TaskListItem, TaskPriority, TaskStatus, TaskSummary, TasksSnapshot } from "./tasksTypes";
import {
  getDevelopmentTaskDetailFallback,
  getDevelopmentTasksFallback,
} from "./tasksDevelopmentData";

const TASKS_PATH = import.meta.env.VITE_TASKS_PATH || "/api/tasks";

const STATUSES: readonly TaskStatus[] = ["queued", "pending", "running", "completed", "failed", "cancelled", "paused", "blocked"];
const PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high", "critical", "urgent"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** Control Plane statuses mapped onto the task board (never invented). */
function normalizeStatus(value: unknown): TaskStatus {
  if (value === "created") return "pending";
  if (value === "awaiting_approval") return "blocked";
  return STATUSES.includes(value as TaskStatus) ? (value as TaskStatus) : "unknown";
}

/**
 * Accepts the Control Plane `TaskView` (`taskId`, `assignedAgentId`, ...) as
 * well as the UI list shape, so a payload shape change can never crash the page.
 */
function normalizeTask(value: unknown): TaskListItem | null {
  if (!isRecord(value)) return null;
  const id = text(value.id) ?? text(value.taskId);
  if (!id) return null;
  const type = text(value.type);
  const priority = PRIORITIES.includes(value.priority as TaskPriority) ? (value.priority as TaskPriority) : undefined;
  return {
    id,
    title: text(value.title) ?? text(value.description) ?? type ?? id,
    ...(text(value.description) ? { description: text(value.description) } : {}),
    status: normalizeStatus(value.status),
    ...(priority ? { priority } : {}),
    ...(type ? { type } : {}),
    ...(text(value.agentId) ?? text(value.assignedAgentId) ? { agentId: text(value.agentId) ?? text(value.assignedAgentId) } : {}),
    ...(text(value.agentName) ? { agentName: text(value.agentName) } : {}),
    ...(text(value.projectId) ? { projectId: text(value.projectId) } : {}),
    ...(text(value.projectName) ? { projectName: text(value.projectName) } : {}),
    ...(text(value.workflowId) ? { workflowId: text(value.workflowId) } : {}),
    ...(text(value.workflowName) ? { workflowName: text(value.workflowName) } : {}),
    createdAt: text(value.createdAt) ?? "",
    ...(text(value.updatedAt) ? { updatedAt: text(value.updatedAt) } : {}),
  };
}

function summarize(tasks: TaskListItem[], total?: number): TaskSummary {
  const count = (status: TaskStatus) => tasks.filter((t) => t.status === status).length;
  return {
    total: typeof total === "number" && Number.isFinite(total) ? total : tasks.length,
    running: count("running"),
    completed: count("completed"),
    failed: count("failed"),
    pending: count("pending") + count("queued"),
  };
}

/** `{ tasks, summary }`, a `{ items, total }` page, or a bare array. */
export function parseTasksPayload(payload: unknown): TasksSnapshot {
  const record = isRecord(payload) ? payload : {};
  const collection = Array.isArray(payload)
    ? payload
    : Array.isArray(record.tasks)
      ? record.tasks
      : Array.isArray(record.items)
        ? record.items
        : [];
  const tasks = collection.map(normalizeTask).filter((t): t is TaskListItem => t !== null);
  const summary = isRecord(record.summary) && typeof record.summary.total === "number"
    ? (record.summary as unknown as TaskSummary)
    : summarize(tasks, typeof record.total === "number" ? record.total : undefined);
  return { tasks, summary };
}

function parseTaskDetail(payload: unknown, taskId: string): TaskDetail {
  const task = normalizeTask(payload);
  if (!task) throw new TasksClientError("NOT_FOUND", `Task '${taskId}' was not found.`, false);
  const record = payload as Record<string, unknown>;
  const failure = text(record.failureReason) ?? text(record.lastError);
  return {
    ...task,
    ...(text(record.startedAt) ? { startedAt: text(record.startedAt) } : {}),
    ...(text(record.completedAt) ? { completedAt: text(record.completedAt) } : {}),
    ...(Array.isArray(record.timeline) ? { timeline: record.timeline as TaskDetail["timeline"] } : {}),
    ...(isRecord(record.executionSummary)
      ? { executionSummary: record.executionSummary as unknown as TaskDetail["executionSummary"] }
      : failure
        ? { description: task.description ? `${task.description} — ${failure}` : failure }
        : {}),
  };
}

export class TasksClientError extends Error {
  readonly code: "UNAUTHORIZED" | "DEGRADED" | "EMPTY" | "NOT_FOUND" | "NETWORK";
  readonly retryable: boolean;

  constructor(
    code: "UNAUTHORIZED" | "DEGRADED" | "EMPTY" | "NOT_FOUND" | "NETWORK",
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "TasksClientError";
    this.code = code;
    this.retryable = retryable;
  }
}

export async function getTasksSnapshot(accessToken?: string | null): Promise<TasksSnapshot> {
  if (import.meta.env.DEV && !import.meta.env.VITE_TASKS_PATH) {
    return getDevelopmentTasksFallback();
  }

  try {
    const payload = await apiRequest<unknown>(TASKS_PATH, {
      method: "GET",
      accessToken,
    });
    return parseTasksPayload(payload);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) {
        throw new TasksClientError(
          "UNAUTHORIZED",
          "You do not have permission to view task operational data.",
          false,
        );
      }
      if (error.status === 404 && import.meta.env.DEV) {
        return getDevelopmentTasksFallback();
      }
      if (error.status === 500 || error.status === 502 || error.status === 503) {
        throw new TasksClientError(
          "DEGRADED",
          "Task service is temporarily unavailable or degraded.",
          true,
        );
      }
    }
    if (import.meta.env.DEV) {
      return getDevelopmentTasksFallback();
    }
    throw new TasksClientError(
      "NETWORK",
      "Unable to communicate with the Control Plane task service.",
      true,
    );
  }
}

export async function getTask(
  taskId: string,
  accessToken?: string | null,
): Promise<TaskDetail> {
  if (import.meta.env.DEV && !import.meta.env.VITE_TASKS_PATH) {
    const fallback = getDevelopmentTaskDetailFallback(taskId);
    if (!fallback) {
      throw new TasksClientError("NOT_FOUND", `Task '${taskId}' was not found.`, false);
    }
    return fallback;
  }

  try {
    const payload = await apiRequest<unknown>(`${TASKS_PATH}/${encodeURIComponent(taskId)}`, {
      method: "GET",
      accessToken,
    });
    return parseTaskDetail(payload, taskId);
  } catch (error) {
    if (error instanceof TasksClientError) throw error;
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) {
        throw new TasksClientError(
          "UNAUTHORIZED",
          "You do not have permission to view this task.",
          false,
        );
      }
      if (error.status === 404) {
        if (import.meta.env.DEV) {
          const fallback = getDevelopmentTaskDetailFallback(taskId);
          if (fallback) {
            return fallback;
          }
        }
        throw new TasksClientError("NOT_FOUND", `Task '${taskId}' was not found.`, false);
      }
      if (error.status === 500 || error.status === 502 || error.status === 503) {
        throw new TasksClientError(
          "DEGRADED",
          "Task service is temporarily unavailable or degraded.",
          true,
        );
      }
    }
    if (import.meta.env.DEV) {
      const fallback = getDevelopmentTaskDetailFallback(taskId);
      if (fallback) {
        return fallback;
      }
    }
    throw new TasksClientError(
      "NETWORK",
      "Unable to communicate with the Control Plane task service.",
      true,
    );
  }
}

