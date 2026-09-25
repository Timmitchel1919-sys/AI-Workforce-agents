import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/useAuth";
import {
  OperationsError,
  TERMINAL_SESSION_STATUSES,
  getExecutionEnvironments,
  getExecutionOverview,
  getExecutionSessionDetail,
  getExecutionSessions,
  getProjectReleases,
  getProjectVerifications,
  stopExecution,
  type OperationsFailure,
} from "./operationsClient";

const KEY = ["workforce", "operations"] as const;
/** Bounded polling only while something is live; never aggressive. */
const LIVE_POLL_MS = 15_000;

export type OperationsState = "loading" | "ready" | OperationsFailure;

function stateOf(query: { isLoading: boolean; error: unknown }): OperationsState {
  if (query.isLoading) return "loading";
  if (query.error) return query.error instanceof OperationsError ? query.error.failure : "unavailable";
  return "ready";
}

export function useExecutionOverview(projectId: string) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...KEY, projectId, "overview", accessToken ?? "anonymous"],
    queryFn: () => getExecutionOverview(projectId, accessToken),
    retry: false,
    staleTime: 10_000,
  });
  return { state: stateOf(query), data: query.data, refetch: () => void query.refetch() };
}

export function useExecutionSessions(projectId: string, filter: { status?: string; offset: number; limit: number }) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...KEY, projectId, "sessions", filter, accessToken ?? "anonymous"],
    queryFn: () => getExecutionSessions(projectId, filter, accessToken),
    retry: false,
    staleTime: 10_000,
    refetchInterval: (q) =>
      q.state.data?.items.some((s) => !TERMINAL_SESSION_STATUSES.includes(s.status)) ? LIVE_POLL_MS : false,
  });
  return { state: stateOf(query), data: query.data, refetch: () => void query.refetch() };
}

export function useExecutionSession(projectId: string, sessionId: string, timelineLimit: number) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...KEY, projectId, "session", sessionId, timelineLimit, accessToken ?? "anonymous"],
    queryFn: () => getExecutionSessionDetail(projectId, sessionId, timelineLimit, accessToken),
    retry: false,
    staleTime: 5_000,
    refetchInterval: (q) =>
      q.state.data && !TERMINAL_SESSION_STATUSES.includes(q.state.data.session.status) ? LIVE_POLL_MS : false,
  });
  return { state: stateOf(query), data: query.data, refetch: () => void query.refetch() };
}

export function useProjectVerifications(projectId: string) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...KEY, projectId, "verifications", accessToken ?? "anonymous"],
    queryFn: () => getProjectVerifications(projectId, accessToken),
    retry: false,
    staleTime: 15_000,
  });
  return { state: stateOf(query), data: query.data, refetch: () => void query.refetch() };
}

export function useProjectReleases(projectId: string) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...KEY, projectId, "releases", accessToken ?? "anonymous"],
    queryFn: () => getProjectReleases(projectId, accessToken),
    retry: false,
    staleTime: 15_000,
  });
  return { state: stateOf(query), data: query.data, refetch: () => void query.refetch() };
}

export function useExecutionEnvironments() {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...KEY, "environments", accessToken ?? "anonymous"],
    queryFn: () => getExecutionEnvironments(accessToken),
    retry: false,
    staleTime: 30_000,
  });
  return { state: stateOf(query), data: query.data, refetch: () => void query.refetch() };
}

export function useStopExecution(projectId: string) {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: "cancel" | "kill"; sessionId: string; reason: string }) =>
      stopExecution(input.kind, input.sessionId, input.reason, accessToken),
    // Always re-read authoritative state; never assume the outcome.
    onSettled: () => client.invalidateQueries({ queryKey: [...KEY, projectId] }),
  });
}
