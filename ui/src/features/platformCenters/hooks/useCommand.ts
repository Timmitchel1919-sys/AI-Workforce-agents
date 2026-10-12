import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../../api/queryKeys";
import { useAuth } from "../../../auth/useAuth";
import { postCommand, request, qs, API, type CommandResult } from "../api/http";

export const queryRoot = () => [...queryKeys.all, "platformCenters"] as const;

export type Capability = "manage_extensions" | "manage_business" | "manage_portfolio" | "manage_autonomy" | "manage_analytics";

export function useToken() {
  return useAuth().accessToken ?? "anonymous";
}

/** UX gating only; the Control Plane enforces every capability and role. */
export function useCanManage(capability: Capability): boolean {
  return Boolean(useAuth().accessDetails?.capabilities?.includes(capability));
}
export function useIsAdmin(): boolean {
  return useAuth().accessDetails?.role === "admin";
}
export function useCanAdminister(capability: Capability): boolean {
  const manage = useCanManage(capability);
  const admin = useIsAdmin();
  return manage && admin;
}

export interface CommandInput { command: string; body: Record<string, unknown> }

/** Every command (success or failure) refetches every query of these screens so they reflect the server. */
export function useCommand() {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return useMutation<CommandResult, unknown, CommandInput>({
    mutationFn: ({ command, body }) => postCommand(command, body, accessToken),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryRoot() });
    },
  });
}

/** One typed GET against a Control Plane read route. `path` is relative to /api. */
export function useGet<T>(path: string, params: Record<string, string | number | boolean | undefined | null> = {}, options: { enabled?: boolean; refetchMs?: number } = {}) {
  const { accessToken } = useAuth();
  const token = useToken();
  const query = qs(params);
  return useQuery<T>({
    queryKey: [...queryRoot(), path, query, token],
    queryFn: () => request<T>(`${API}${path}${query}`, accessToken),
    enabled: options.enabled ?? true,
    retry: false,
    staleTime: 5_000,
    ...(options.refetchMs ? { refetchInterval: options.refetchMs } : {}),
  });
}
