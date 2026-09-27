import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../../api/queryKeys";
import { useAuth } from "../../../auth/useAuth";
import {
  OnboardingClientError,
  getCapabilities,
  getSession,
  listSessions,
  runOnboardingCommand,
  type OnboardingCommandInput,
} from "../api/onboardingClient";
import type { OnboardingSession, OnboardingStatus } from "../types";

const root = () => [...queryKeys.all, "onboarding"] as const;
const sessionKey = (id: string | undefined, token: string) => [...root(), "session", id, token] as const;

export const ACTIVE_POLL_STATUSES: readonly OnboardingStatus[] = ["provisioning", "validating", "analyzing", "planning"];
const POLL_MS = 2_000;

function useToken() {
  return useAuth().accessToken ?? "anonymous";
}

export function errorCodeOf(error: unknown) {
  return error instanceof OnboardingClientError ? error.code : error ? "NETWORK" : undefined;
}

export function useOnboardingCapabilities() {
  const { accessToken } = useAuth();
  const token = useToken();
  const query = useQuery({
    queryKey: [...root(), "capabilities", token],
    queryFn: () => getCapabilities(accessToken),
    retry: false,
    staleTime: 60_000,
  });
  return { capabilities: query.data, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

export function useOnboardingSessions() {
  const { accessToken } = useAuth();
  const token = useToken();
  const query = useQuery({
    queryKey: [...root(), "list", token],
    queryFn: () => listSessions(accessToken),
    retry: false,
    staleTime: 10_000,
  });
  return { sessions: query.data ?? [], isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

export function useOnboardingSession(id: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  const query = useQuery({
    queryKey: sessionKey(id, token),
    queryFn: () => getSession(id ?? "", accessToken),
    enabled: Boolean(id),
    retry: false,
    // Real refetch while the server is doing work: no timed or fake progress.
    refetchInterval: (q) => {
      const status = (q.state.data as OnboardingSession | undefined)?.status;
      return status && ACTIVE_POLL_STATUSES.includes(status) ? POLL_MS : false;
    },
  });
  return { session: query.data, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

/**
 * One mutation for every command. The returned session replaces the cached
 * copy, so every step always renders the latest server revision.
 */
export function useOnboardingCommand() {
  const { accessToken } = useAuth();
  const token = useToken();
  const client = useQueryClient();
  return useMutation<OnboardingSession, unknown, OnboardingCommandInput>({
    mutationFn: (input) => runOnboardingCommand(input, accessToken),
    onSuccess: (session) => {
      client.setQueryData(sessionKey(session.id, token), session);
      void client.invalidateQueries({ queryKey: [...root(), "list"] });
    },
    onError: (_error, input) => {
      // A conflict means our copy is stale: reload it.
      if ("id" in input) void client.invalidateQueries({ queryKey: [...root(), "session", input.id] });
    },
  });
}
