import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "../../app/providers/apiContext";
import { healthApi } from "../../api";
import type { SystemHealth } from "../../api/contracts";

export const systemQueryKeys = {
  liveness: ["system", "liveness"] as const,
  health: ["system", "health"] as const,
};

export function useLiveness() {
  const client = useApiClient();
  return useQuery({
    queryKey: systemQueryKeys.liveness,
    queryFn: () => healthApi.getLiveness(client),
  });
}

export function useSystemHealth() {
  const client = useApiClient();
  return useQuery<SystemHealth>({
    queryKey: systemQueryKeys.health,
    queryFn: () => healthApi.getSystemHealth(client),
  });
}
