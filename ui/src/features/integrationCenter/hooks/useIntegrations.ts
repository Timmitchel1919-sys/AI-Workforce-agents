import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../../api/queryKeys";
import { useAuth } from "../../../auth/useAuth";
import {
  getActivity, getAudit, getCapabilities, getConnector, getEvents, getHealth, getMcp, getOverview, runIntegrationCommand,
} from "../api/integrationClient";
import { MANAGE_CAPABILITY, type ActivityFilters, type CommandInput, type CommandResult, type EventFilters, type IntegrationCommandName } from "../types";

const root = () => [...queryKeys.all, "integrationCenter"] as const;

function useToken() {
  return useAuth().accessToken ?? "anonymous";
}

/** UX gating only; the Control Plane enforces every capability and role. */
export function useCanManage(): boolean {
  return Boolean(useAuth().accessDetails?.capabilities?.includes(MANAGE_CAPABILITY));
}
export function useIsAdmin(): boolean {
  return useAuth().accessDetails?.role === "admin";
}
/** Administrator-only write UI (the manage capability is also required). */
export function useCanAdminister(): boolean {
  const manage = useCanManage();
  const admin = useIsAdmin();
  return manage && admin;
}

const opts = { retry: false, staleTime: 5_000 } as const;
/** Connector health moves, so the overview is polled to stay current. */
export const OVERVIEW_POLL_MS = 20_000;

export function useOverview(projectId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({
    queryKey: [...root(), "overview", projectId ?? "all", token],
    queryFn: () => getOverview(projectId, accessToken),
    refetchInterval: OVERVIEW_POLL_MS,
    ...opts,
  });
}

export function useConnector(connectorId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({
    queryKey: [...root(), "connector", connectorId, token],
    queryFn: () => getConnector(connectorId ?? "", accessToken),
    enabled: Boolean(connectorId),
    retry: false,
    staleTime: 0,
  });
}

export function useCapabilities(q: string, projectId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({
    queryKey: [...root(), "capabilities", q, projectId ?? "all", token],
    queryFn: () => getCapabilities(q, projectId, accessToken),
    ...opts,
  });
}

export function useEvents(filters: EventFilters, projectId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({
    queryKey: [...root(), "events", filters, projectId ?? "all", token],
    queryFn: () => getEvents(filters, projectId, accessToken),
    ...opts,
  });
}

export function useActivity(filters: ActivityFilters, projectId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({
    queryKey: [...root(), "activity", filters, projectId ?? "all", token],
    queryFn: () => getActivity(filters, projectId, accessToken),
    ...opts,
  });
}

export function useHealth() {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({ queryKey: [...root(), "health", token], queryFn: () => getHealth(accessToken), ...opts });
}

export function useMcp() {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({ queryKey: [...root(), "mcp", token], queryFn: () => getMcp(accessToken), ...opts });
}

export function useAudit(projectId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({
    queryKey: [...root(), "audit", projectId ?? "all", token],
    queryFn: () => getAudit(projectId, accessToken),
    ...opts,
  });
}

/** Every command (success or failure) refetches all integration queries so the screen reflects the server. */
export function useIntegrationCommand() {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return useMutation<CommandResult, unknown, CommandInput>({
    mutationFn: ({ command, body }) => runIntegrationCommand(command, body, accessToken),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: root() });
    },
  });
}

/**
 * Sends one command WITHOUT keeping its body in any cache. Used for credential values: a react-query mutation would
 * retain the variables (and so the secret) in its cache, so the credential dialog calls this instead.
 */
export function useUncachedCommand() {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return useCallback(
    async (command: IntegrationCommandName, body: Record<string, unknown>): Promise<CommandResult> => {
      try {
        return await runIntegrationCommand(command, body, accessToken);
      } finally {
        void client.invalidateQueries({ queryKey: root() });
      }
    },
    [accessToken, client],
  );
}
