import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../auth/useAuth";
import type { AgentsSnapshot } from "../api/agentsTypes";
import { AgentsClientError, getAgentsSnapshot } from "../api/agentsClient";

/**
 * UI states are kept DISTINCT on purpose, because each one is a different fact
 * about the deployment:
 *
 *   loading       we have not asked yet
 *   ready         the Control Plane answered with agents
 *   empty         the Control Plane answered: this deployment has no agents
 *   notComposed   the Control Plane answered: there is no specialist layer here
 *   notConfigured this build has no route configured — we cannot know
 *   unauthorized  the operator may not see the registry
 *   degraded      the registry failed; retrying may help
 *   error         anything else
 *
 * The previous version collapsed "no route", "404", "empty" and "server error"
 * into one invented roster. Collapsing them is how an operator ends up reading
 * sample data as this deployment's real workforce.
 */
export type AgentsUiState =
  | "loading"
  | "ready"
  | "empty"
  | "notComposed"
  | "notConfigured"
  | "error"
  | "unauthorized"
  | "degraded";

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
    return { status: "loading", refetch: query.refetch };
  }

  if (query.error instanceof AgentsClientError) {
    switch (query.error.code) {
      case "UNAUTHORIZED":
        return {
          data: query.data,
          status: "unauthorized",
          error: query.error,
          refetch: query.refetch,
        };
      case "DEGRADED":
        return {
          data: query.data,
          status: "degraded",
          error: query.error,
          refetch: query.refetch,
        };
      case "NOT_COMPOSED":
        return {
          data: query.data,
          status: "notComposed",
          error: query.error,
          refetch: query.refetch,
        };
      case "NOT_CONFIGURED":
        return {
          data: query.data,
          status: "notConfigured",
          error: query.error,
          refetch: query.refetch,
        };
      default:
        return {
          data: query.data,
          status: "error",
          error: query.error,
          refetch: query.refetch,
        };
    }
  }

  if (query.data) {
    return {
      data: query.data,
      status: query.data.agents.length === 0 ? "empty" : "ready",
      refetch: query.refetch,
    };
  }

  return { status: "loading", refetch: query.refetch };
}
