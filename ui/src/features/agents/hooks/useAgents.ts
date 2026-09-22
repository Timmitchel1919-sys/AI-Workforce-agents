import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../auth/useAuth";
import type { AgentsSnapshot } from "../api/agentsTypes";
import { AgentsClientError, getAgentsSnapshot } from "../api/agentsClient";

export type AgentsUiState = "loading" | "ready" | "empty" | "error" | "unauthorized" | "degraded";

export interface UseAgentsResult {
  data?: AgentsSnapshot;
  status: AgentsUiState;
  error?: AgentsClientError;
  refetch: () => Promise<unknown>;
}

export function useAgents(): UseAgentsResult {
  const { accessToken } = useAuth();

  const query = useQuery({
    queryKey: ["agents", accessToken ?? "anonymous"],
    queryFn: () => getAgentsSnapshot(accessToken),
    retry: false,
    staleTime: 30_000,
  });

  if (query.isLoading && !query.data) {
    return {
      status: "loading",
      refetch: query.refetch,
    };
  }

  if (query.error instanceof AgentsClientError) {
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
    if (query.data.agents.length === 0) {
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
