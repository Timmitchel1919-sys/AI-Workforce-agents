import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth/useAuth";
import {
  InfrastructureError,
  getEnvironmentDescriptors,
  getEnvironmentInstances,
  getHosts,
  getTools,
  type InfrastructureFailure,
} from "./infrastructureClient";

export type InfrastructureState = "loading" | "ready" | "empty" | InfrastructureFailure;

const KEY = ["workforce", "infrastructure"] as const;

function useList<T>(name: string, fetcher: (token?: string | null) => Promise<T[]>) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...KEY, name, accessToken ?? "anonymous"],
    queryFn: () => fetcher(accessToken),
    retry: false,
    staleTime: 30_000,
  });
  const items = query.data ?? [];
  const state: InfrastructureState = query.isLoading
    ? "loading"
    : query.error
      ? query.error instanceof InfrastructureError
        ? query.error.failure
        : "unavailable"
      : items.length === 0
        ? "empty"
        : "ready";
  return { state, items, refetch: () => void query.refetch() };
}

export const useEnvironmentDescriptors = () => useList("descriptors", getEnvironmentDescriptors);
export const useEnvironmentInstances = () => useList("instances", getEnvironmentInstances);
export const useHosts = () => useList("hosts", getHosts);
export const useTools = () => useList("tools", getTools);
