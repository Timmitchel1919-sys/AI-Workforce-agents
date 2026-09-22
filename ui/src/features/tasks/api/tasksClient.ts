import { apiRequest } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import type { TaskDetail, TasksSnapshot } from "./tasksTypes";
import {
  getDevelopmentTaskDetailFallback,
  getDevelopmentTasksFallback,
} from "./tasksDevelopmentData";

const TASKS_PATH = import.meta.env.VITE_TASKS_PATH || "/api/tasks";

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
    const data = await apiRequest<TasksSnapshot>(TASKS_PATH, {
      method: "GET",
      accessToken,
    });
    return data;
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
    const data = await apiRequest<TaskDetail>(`${TASKS_PATH}/${taskId}`, {
      method: "GET",
      accessToken,
    });
    return data;
  } catch (error) {
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

