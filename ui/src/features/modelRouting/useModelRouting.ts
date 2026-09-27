import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth/useAuth";
import {
  ModelRoutingError,
  getProjectRoutingDecision,
  getProjectRoutingDecisions,
  type ModelRoutingFailure,
} from "./modelRoutingClient";

const KEY = ["workforce", "modelRouting"] as const;

export type ModelRoutingState = "loading" | "ready" | ModelRoutingFailure;

function stateOf(query: { isLoading: boolean; error: unknown }): ModelRoutingState {
  if (query.isLoading) return "loading";
  if (query.error) return query.error instanceof ModelRoutingError ? query.error.failure : "unavailable";
  return "ready";
}

export function useProjectRoutingDecisions(projectId: string) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...KEY, projectId, "list", accessToken ?? "anonymous"],
    queryFn: () => getProjectRoutingDecisions(projectId, accessToken),
    retry: false,
    staleTime: 15_000,
  });
  return { state: stateOf(query), data: query.data, refetch: () => void query.refetch() };
}

export function useRoutingDecision(projectId: string, routingDecisionId: string) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...KEY, projectId, "decision", routingDecisionId, accessToken ?? "anonymous"],
    queryFn: () => getProjectRoutingDecision(projectId, routingDecisionId, accessToken),
    retry: false,
    staleTime: 15_000,
  });
  return { state: stateOf(query), data: query.data, refetch: () => void query.refetch() };
}
