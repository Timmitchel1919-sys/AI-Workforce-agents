import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../../api/queryKeys";
import { useAuth } from "../../../auth/useAuth";
import {
  getProjectExecutionPlan,
  getProjects,
  PlanClientError,
  type ProjectExecutionPlan,
} from "../api/executionPlansClient";
import type { ProjectSummary } from "../api/executionPlanTypes";

/** `forbidden` (403) and `unauthenticated` (401) are distinct from `empty`. */
export type PlanUiState =
  | "loading"
  | "ready"
  | "empty"
  | "not_found"
  | "unauthenticated"
  | "forbidden"
  | "error";

function stateForError(error: unknown): PlanUiState {
  if (!(error instanceof PlanClientError)) return "error";
  switch (error.code) {
    case "UNAUTHENTICATED":
      return "unauthenticated";
    case "FORBIDDEN":
      return "forbidden";
    case "NOT_FOUND":
      return "not_found";
    default:
      return "error";
  }
}

export function useProjects(): {
  status: PlanUiState;
  projects: readonly ProjectSummary[];
  refetch: () => Promise<unknown>;
} {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...queryKeys.projects(), accessToken ?? "anonymous"],
    queryFn: () => getProjects(accessToken),
    retry: false,
    staleTime: 30_000,
  });
  if (query.isLoading) return { status: "loading", projects: [], refetch: query.refetch };
  if (query.error) return { status: stateForError(query.error), projects: [], refetch: query.refetch };
  const projects = query.data ?? [];
  return {
    status: projects.length === 0 ? "empty" : "ready",
    projects,
    refetch: query.refetch,
  };
}

export function useProjectExecutionPlan(projectId: string | undefined): {
  status: PlanUiState;
  data?: ProjectExecutionPlan;
  refetch: () => Promise<unknown>;
} {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...queryKeys.projects(), projectId, "execution-plan", accessToken ?? "anonymous"],
    queryFn: () => getProjectExecutionPlan(projectId ?? "", accessToken),
    enabled: Boolean(projectId),
    retry: false,
    staleTime: 30_000,
  });
  if (!projectId) return { status: "not_found", refetch: query.refetch };
  if (query.isLoading) return { status: "loading", refetch: query.refetch };
  if (query.error) return { status: stateForError(query.error), refetch: query.refetch };
  if (!query.data) return { status: "loading", refetch: query.refetch };
  return {
    status: query.data.plan ? "ready" : "empty",
    data: query.data,
    refetch: query.refetch,
  };
}
