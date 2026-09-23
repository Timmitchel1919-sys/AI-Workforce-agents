import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../auth/useAuth";
import { queryKeys } from "../../../api/queryKeys";
import type { WorkflowsPage } from "../api/workflowsTypes";
import { getWorkflows, WorkflowsClientError } from "../api/workflowsClient";

export type WorkflowsUiState =
  | "loading"
  | "ready"
  | "empty"
  | "error"
  | "unauthorized"
  | "degraded";

export interface UseWorkflowsResult {
  data?: WorkflowsPage;
  status: WorkflowsUiState;
  error?: WorkflowsClientError;
  refetch: () => Promise<unknown>;
}

export function useWorkflows(): UseWorkflowsResult {
  const { accessToken } = useAuth();

  const query = useQuery({
    queryKey: [...queryKeys.workflows(), accessToken ?? "anonymous"],
    queryFn: () => getWorkflows(accessToken),
    retry: false,
    staleTime: 30_000,
  });

  const base = { data: query.data, refetch: query.refetch };

  if (query.isLoading && !query.data) {
    return { status: "loading", refetch: query.refetch };
  }

  if (query.error instanceof WorkflowsClientError) {
    const status: WorkflowsUiState =
      query.error.code === "UNAUTHORIZED"
        ? "unauthorized"
        : query.error.code === "DEGRADED"
          ? "degraded"
          : "error";
    return { ...base, status, error: query.error };
  }

  if (query.data) {
    return { ...base, status: query.data.items.length === 0 ? "empty" : "ready" };
  }

  return { status: "loading", refetch: query.refetch };
}
