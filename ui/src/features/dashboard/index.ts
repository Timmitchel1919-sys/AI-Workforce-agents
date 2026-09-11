import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "../../app/providers/apiContext";
import { dashboardApi, queryKeys, parseResponse } from "../../api";

/** `GET /api/dashboard` — the full bounded snapshot the Overview renders from. */
export function useDashboardSnapshot() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.dashboard.snapshot,
    queryFn: () =>
      dashboardApi.getDashboard(client).then(parseResponse.dashboard),
    staleTime: 15_000,
  });
}

/** `GET /api/status` — headline counts + overall health. */
export function useWorkforceStatus() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.dashboard.status,
    queryFn: () =>
      dashboardApi.getStatus(client).then(parseResponse.workforceStatus),
    staleTime: 15_000,
  });
}
