import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../auth/useAuth";
import type { TaskDetail } from "../api/tasksTypes";
import { getTask, TasksClientError } from "../api/tasksClient";
import { queryKeys } from "../../../api/queryKeys";

export type TaskDetailUiState =
  | "loading"
  | "ready"
  | "not_found"
  | "error"
  | "unauthorized"
  | "degraded";

export interface UseTaskResult {
  data?: TaskDetail;
  status: TaskDetailUiState;
  error?: TasksClientError;
  refetch: () => Promise<unknown>;
}

export function useTask(taskId?: string): UseTaskResult {
  const { accessToken } = useAuth();

  const query = useQuery({
    queryKey: [...queryKeys.tasks(), taskId, accessToken ?? "anonymous"],
    queryFn: () => {
      if (!taskId) {
        throw new TasksClientError("NOT_FOUND", "Task ID is required.", false);
      }
      return getTask(taskId, accessToken);
    },
    enabled: Boolean(taskId),
    retry: false,
    staleTime: 30_000,
  });

  if (!taskId) {
    return {
      status: "not_found",
      refetch: query.refetch,
    };
  }

  if (query.isLoading && !query.data) {
    return {
      status: "loading",
      refetch: query.refetch,
    };
  }

  if (query.error instanceof TasksClientError) {
    if (query.error.code === "NOT_FOUND") {
      return {
        status: "not_found",
        error: query.error,
        refetch: query.refetch,
      };
    }

    if (query.error.code === "UNAUTHORIZED") {
      return {
        data: query.data,
        status: "unauthorized",
        error: query.error,
        refetch: query.refetch,
      };
    }

    if (query.error.code === "DEGRADED") {
      return {
        data: query.data,
        status: "degraded",
        error: query.error,
        refetch: query.refetch,
      };
    }

    return {
      data: query.data,
      status: "error",
      error: query.error,
      refetch: query.refetch,
    };
  }

  if (query.data) {
    return {
      data: query.data,
      status: "ready",
      refetch: query.refetch,
    };
  }

  return {
    status: "loading",
    refetch: query.refetch,
  };
}

