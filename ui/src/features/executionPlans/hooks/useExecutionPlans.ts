import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../../api/queryKeys";
import { useAuth } from "../../../auth/useAuth";
import {
  PlanClientError,
  getAgentNames,
  getCurrentPlan,
  getPlanHistory,
  getPlanVersion,
  getProject,
  getProjects,
  getTechnologyCatalog,
  runPlanCommand,
  type PlanCommand,
} from "../api/executionPlansClient";
import type { PlanClientErrorCode } from "../api/executionPlanTypes";

/** 401, 403, 404, 409 and 5xx stay distinguishable — a 403 is never "empty". */
export type PlanUiState =
  | "loading"
  | "ready"
  | "empty"
  | "not_found"
  | "unauthenticated"
  | "forbidden"
  | "conflict"
  | "error";

export function stateForError(error: unknown): PlanUiState {
  const code: PlanClientErrorCode | undefined = error instanceof PlanClientError ? error.code : undefined;
  switch (code) {
    case "UNAUTHENTICATED":
      return "unauthenticated";
    case "FORBIDDEN":
      return "forbidden";
    case "NOT_FOUND":
      return "not_found";
    case "CONFLICT":
      return "conflict";
    default:
      return "error";
  }
}

function useToken() {
  return useAuth().accessToken ?? "anonymous";
}

const planKey = (projectId: string | undefined) => [...queryKeys.projects(), projectId, "plans"] as const;

export function useProjects() {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...queryKeys.projects(), "list", useToken()],
    queryFn: () => getProjects(accessToken),
    retry: false,
    staleTime: 30_000,
  });
  const projects = query.data ?? [];
  const status: PlanUiState = query.isLoading
    ? "loading"
    : query.error
      ? stateForError(query.error)
      : projects.length === 0
        ? "empty"
        : "ready";
  return { status, projects, refetch: query.refetch };
}

export function useProject(projectId: string | undefined) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...queryKeys.projects(), projectId, "detail", useToken()],
    queryFn: () => getProject(projectId ?? "", accessToken),
    enabled: Boolean(projectId),
    retry: false,
    staleTime: 30_000,
  });
  const status: PlanUiState = !projectId
    ? "not_found"
    : query.isLoading
      ? "loading"
      : query.error
        ? stateForError(query.error)
        : "ready";
  return { status, project: query.data, refetch: query.refetch };
}

/**
 * The plan to show: a specific historical revision when `planId`+`version`
 * are given, otherwise the project's current plan (null → empty state).
 */
export function usePlan(projectId: string | undefined, selection?: { planId: string; version: number }) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...planKey(projectId), selection?.planId ?? "current", selection?.version ?? 0, useToken()],
    queryFn: () =>
      selection
        ? getPlanVersion(projectId ?? "", selection.planId, selection.version, accessToken)
        : getCurrentPlan(projectId ?? "", accessToken),
    enabled: Boolean(projectId),
    retry: false,
    staleTime: 15_000,
  });
  const status: PlanUiState = !projectId
    ? "not_found"
    : query.isLoading
      ? "loading"
      : query.error
        ? stateForError(query.error)
        : query.data
          ? "ready"
          : "empty";
  return { status, plan: query.data ?? undefined, refetch: query.refetch };
}

/** A previous revision for comparison (only fetched when one exists). */
export function usePreviousRevision(projectId: string, planId: string | undefined, version: number | undefined) {
  const { accessToken } = useAuth();
  const previous = version && version > 1 ? version - 1 : undefined;
  const query = useQuery({
    queryKey: [...planKey(projectId), planId, previous, "previous", useToken()],
    queryFn: () => getPlanVersion(projectId, planId ?? "", previous ?? 1, accessToken),
    enabled: Boolean(planId && previous),
    retry: false,
    staleTime: 60_000,
  });
  return query.data;
}

/** Bounded, cursor-paginated revision history of one series. */
export function usePlanHistory(projectId: string, planId: string | undefined) {
  const { accessToken } = useAuth();
  const query = useInfiniteQuery({
    queryKey: [...planKey(projectId), planId, "history", useToken()],
    queryFn: ({ pageParam }) => getPlanHistory(projectId, planId ?? "", pageParam, accessToken),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(planId),
    retry: false,
    staleTime: 15_000,
  });
  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    total: query.data?.pages[0]?.total ?? 0,
    loading: query.isLoading,
    error: query.error ? stateForError(query.error) : undefined,
    hasMore: Boolean(query.hasNextPage),
    loadMore: () => void query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
  };
}

export function useTechnologyCatalog(enabled: boolean) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: ["workforce", "planning", "technologies", useToken()],
    queryFn: () => getTechnologyCatalog(accessToken),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
  return { catalog: query.data ?? [], loading: query.isLoading, failed: Boolean(query.error) };
}

export function useAgentNames() {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: ["workforce", "agent-names", useToken()],
    queryFn: () => getAgentNames(accessToken),
    retry: false,
    staleTime: 60_000,
  });
  return query.data ?? {};
}

/** Planning/governance commands; refetches the project's plans afterwards. */
export function usePlanCommand(projectId: string) {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (command: PlanCommand) => runPlanCommand(command, accessToken),
    onSettled: () => client.invalidateQueries({ queryKey: planKey(projectId) }),
  });
}
