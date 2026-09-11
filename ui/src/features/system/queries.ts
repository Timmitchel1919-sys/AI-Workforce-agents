import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "../../app/providers/apiContext";
import { healthApi, queryKeys, parseResponse, isApiError } from "../../api";

/** `GET /api/health` — liveness. No auth. */
export function useLiveness() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.system.liveness,
    queryFn: () => healthApi.getLiveness(client).then(parseResponse.liveness),
    staleTime: 10_000,
  });
}

/** `GET /api/system-health` — measured component health. */
export function useSystemHealth() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.system.health,
    queryFn: () =>
      healthApi.getSystemHealth(client).then(parseResponse.systemHealth),
    staleTime: 15_000,
  });
}

export type ApiReachability = "reachable" | "unreachable" | "checking";

/**
 * API availability — is the Control Plane HTTP API responding? Polls
 * `/api/health` on a modest interval; NOT aggressive. Distinct from browser
 * connectivity (`useOnlineStatus`).
 */
export function useApiStatus(): {
  reachability: ApiReachability;
  lastCheckedAt: number | undefined;
  refetch: () => void;
} {
  const client = useApiClient();
  const query = useQuery({
    queryKey: queryKeys.system.apiStatus,
    queryFn: () => healthApi.getLiveness(client),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 20_000,
  });

  const reachability: ApiReachability = query.isPending
    ? "checking"
    : query.isError
      ? "unreachable"
      : "reachable";

  return {
    reachability,
    lastCheckedAt: query.dataUpdatedAt || query.errorUpdatedAt || undefined,
    refetch: () => void query.refetch(),
  };
}

/** True only for a real auth failure from the API (not offline / network). */
export function isUnauthenticatedError(error: unknown): boolean {
  return isApiError(error) && error.category === "unauthenticated";
}
