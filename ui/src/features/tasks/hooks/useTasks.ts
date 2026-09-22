import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../auth/useAuth";
import type { TasksSnapshot } from "../api/tasksTypes";
import { getTasksSnapshot, TasksClientError } from "../api/tasksClient";
import { queryKeys } from "../../../api/queryKeys";

export type TasksUiState = "loading" | "ready" | "empty" | "error" | "unauthorized" | "degraded";

export interface UseTasksResult {
  data?: TasksSnapshot;
  status: TasksUiState;
  error?: TasksClientError;
  refetch: () => Promise<unknown>;
}

export function useTasks(): UseTasksResult {
  const { accessToken } = useAuth();

  const query = useQuery({
    queryKey: [...queryKeys.tasks(), accessToken ?? "anonymous"],
    queryFn: () => getTasksSnapshot(accessToken),
    retry: false,
    staleTime: 30_000,
  });

  if (query.isLoading && !query.data) {
    return {
      status: "loading",
      refetch: query.refetch,
    };
  }

  if (query.error instanceof TasksClientError) {
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
    if (query.data.tasks.length === 0) {
      return {
        data: query.data,
        status: "empty",
        refetch: query.refetch,
      };
    }

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

