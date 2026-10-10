import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../../api/queryKeys";
import { useAuth } from "../../../auth/useAuth";
import { getFile, getOverview, getSession, getTree, listSessions, runRuntimeCommand } from "../api/runtimeClient";
import { ORCHESTRATE_CAPABILITY, type RuntimeCommand } from "../types";

const root = () => [...queryKeys.all, "liveWorkspace"] as const;

function useToken() {
  return useAuth().accessToken ?? "anonymous";
}

/** UX gating only; the Control Plane enforces the capability. */
export function useCanOrchestrate(): boolean {
  const { accessDetails } = useAuth();
  return Boolean(accessDetails?.capabilities?.includes(ORCHESTRATE_CAPABILITY));
}

export function useOverview() {
  const { accessToken } = useAuth();
  const token = useToken();
  const query = useQuery({
    queryKey: [...root(), "overview", token],
    queryFn: () => getOverview(accessToken),
    retry: false,
    staleTime: 5_000,
  });
  return { overview: query.data, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

export function useSessions(enabled = true) {
  const { accessToken } = useAuth();
  const token = useToken();
  const query = useQuery({
    queryKey: [...root(), "sessions", token],
    queryFn: () => listSessions(accessToken),
    enabled,
    retry: false,
    staleTime: 5_000,
  });
  return { sessions: query.data ?? [], isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

/** Loaded once; refreshed by event-driven invalidation (never by a timer). */
export function useSession(executionId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  const query = useQuery({
    queryKey: [...root(), "session", executionId, token],
    queryFn: () => getSession(executionId ?? "", accessToken),
    enabled: Boolean(executionId),
    retry: false,
    staleTime: 0,
  });
  return { session: query.data, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

export function useTree(executionId: string, dir: string, enabled: boolean) {
  const { accessToken } = useAuth();
  const token = useToken();
  const query = useQuery({
    queryKey: [...root(), "tree", executionId, dir, token],
    queryFn: () => getTree(executionId, dir, accessToken),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
  return { tree: query.data, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

export function useFile(executionId: string, path: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  const query = useQuery({
    queryKey: [...root(), "file", executionId, path, token],
    queryFn: () => getFile(executionId, path ?? "", accessToken),
    enabled: Boolean(path),
    retry: false,
    staleTime: 10_000,
  });
  return { file: query.data, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

/** Invalidates everything for one execution plus the overview and list (called on live activity). */
export function useRefreshExecution(executionId: string | undefined) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: [...root(), "session", executionId] });
    void client.invalidateQueries({ queryKey: [...root(), "overview"] });
    void client.invalidateQueries({ queryKey: [...root(), "sessions"] });
  };
}

export function useRuntimeCommand(executionId: string) {
  const { accessToken } = useAuth();
  const refresh = useRefreshExecution(executionId);
  return useMutation<void, unknown, RuntimeCommand>({
    mutationFn: (command) => runRuntimeCommand(command, executionId, accessToken),
    onSettled: () => refresh(),
  });
}
