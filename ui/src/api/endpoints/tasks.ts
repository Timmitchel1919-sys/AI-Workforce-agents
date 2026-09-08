import type { ApiClient } from "../client";
import type {
  ControlCommandResult,
  PageResult,
  TaskQuery,
  TaskView,
} from "../contracts";
import type { ApiQuery } from "../types";

/** Filters accepted by `GET /api/tasks` (a subset of the backend `TaskQuery`). */
export type TaskListFilters = Pick<
  TaskQuery,
  | "taskId"
  | "workflowId"
  | "projectId"
  | "agentId"
  | "status"
  | "priority"
  | "since"
  | "until"
  | "createdAfter"
  | "createdBefore"
  | "failedOnly"
  | "limit"
  | "cursor"
>;

export function listTasks(client: ApiClient, filters: TaskListFilters = {}) {
  return client
    .get<PageResult<TaskView>>("/tasks", { query: filters as ApiQuery })
    .then((r) => r.data);
}

export function getTask(client: ApiClient, taskId: string) {
  return client
    .get<TaskView>(`/tasks/${encodeURIComponent(taskId)}`)
    .then((r) => r.data);
}

export interface TaskCommandInput {
  taskId: string;
  reason?: string;
}

export function retryTask(client: ApiClient, input: TaskCommandInput) {
  return client
    .post<ControlCommandResult>("/commands/retry-task", input)
    .then((r) => r.data);
}

export function cancelTask(client: ApiClient, input: TaskCommandInput) {
  return client
    .post<ControlCommandResult>("/commands/cancel-task", input)
    .then((r) => r.data);
}
