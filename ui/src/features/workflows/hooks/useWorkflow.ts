import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../auth/useAuth";
import { queryKeys } from "../../../api/queryKeys";
import type { WorkflowView } from "../api/workflowsTypes";
import { getWorkflow, WorkflowsClientError } from "../api/workflowsClient";

export type WorkflowDetailUiState =
  | "loading"
  | "ready"
  | "not_found"
  | "error"
  | "unauthorized"
  | "degraded";

export interface UseWorkflowResult {
  data?: WorkflowView;
  status: WorkflowDetailUiState;
  error?: WorkflowsClientError;
  refetch: () => Promise<unknown>;
}

export function useWorkflow(workflowId?: string): UseWorkflowResult {
  const { accessToken } = useAuth();

  const query = useQuery({
    queryKey: [...queryKeys.workflows(), workflowId, accessToken ?? "anonymous"],
    queryFn: () => {
      if (!workflowId) {
        throw new WorkflowsClientError("NOT_FOUND", "Workflow ID is required.", false);
      }
      return getWorkflow(workflowId, accessToken);
    },
    enabled: Boolean(workflowId),
    retry: false,
    staleTime: 30_000,
  });

  if (!workflowId) {
    return { status: "not_found", refetch: query.refetch };
  }

  if (query.isLoading && !query.data) {
    return { status: "loading", refetch: query.refetch };
  }

  if (query.error instanceof WorkflowsClientError) {
    const status: WorkflowDetailUiState =
      query.error.code === "NOT_FOUND"
        ? "not_found"
        : query.error.code === "UNAUTHORIZED"
          ? "unauthorized"
          : query.error.code === "DEGRADED"
            ? "degraded"
            : "error";
    return { data: query.data, status, error: query.error, refetch: query.refetch };
  }

  if (query.data) {
    return { data: query.data, status: "ready", refetch: query.refetch };
  }

  return { status: "loading", refetch: query.refetch };
}
