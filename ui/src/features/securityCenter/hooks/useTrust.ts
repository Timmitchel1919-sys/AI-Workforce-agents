import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../../api/queryKeys";
import { useAuth } from "../../../auth/useAuth";
import {
  getAlert, getAlerts, getApprovals, getLedger, getOverview, getPolicies, getPolicy, getProjectSecurity, getSecrets, getTrust,
  runSecurityCommand, simulate,
} from "../api/trustClient";
import { APPROVE_CAPABILITY, MANAGE_CAPABILITY, type AuditFilters, type CommandInput, type CommandResult, type SimulationRequest } from "../types";

const root = () => [...queryKeys.all, "securityCenter"] as const;

function useToken() {
  return useAuth().accessToken ?? "anonymous";
}

/** UX gating only; the Control Plane enforces every capability and role. */
export function useCanManage(): boolean {
  return Boolean(useAuth().accessDetails?.capabilities?.includes(MANAGE_CAPABILITY));
}
export function useCanApprove(): boolean {
  return Boolean(useAuth().accessDetails?.capabilities?.includes(APPROVE_CAPABILITY));
}
export function useIsAdmin(): boolean {
  return useAuth().accessDetails?.role === "admin";
}

/** Administrator-only write UI (the capability is also required). */
export function useCanAdminister(): boolean {
  const manage = useCanManage();
  const admin = useIsAdmin();
  return manage && admin;
}

const opts = { retry: false, staleTime: 5_000 } as const;
/** The overview drives the emergency banner, so it is polled to stay current. */
export const OVERVIEW_POLL_MS = 15_000;

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

export function usePolicies() {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({ queryKey: [...root(), "policies", token], queryFn: () => getPolicies(accessToken), ...opts });
}

export function usePolicy(policyId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({
    queryKey: [...root(), "policy", policyId, token],
    queryFn: () => getPolicy(policyId ?? "", accessToken),
    enabled: Boolean(policyId),
    retry: false,
    staleTime: 0,
  });
}

export function useTrustData() {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({ queryKey: [...root(), "trust", token], queryFn: () => getTrust(accessToken), ...opts });
}

export function useApprovals(states: readonly string[], projectId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({
    queryKey: [...root(), "approvals", states.join(","), projectId ?? "all", token],
    queryFn: () => getApprovals(states, projectId, accessToken),
    ...opts,
  });
}

export function useAlerts(filters: { status: string; severity: string; open: boolean }, projectId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({
    queryKey: [...root(), "alerts", filters, projectId ?? "all", token],
    queryFn: () => getAlerts(filters, projectId, accessToken),
    ...opts,
  });
}

export function useAlert(alertId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({
    queryKey: [...root(), "alert", alertId, token],
    queryFn: () => getAlert(alertId ?? "", accessToken),
    enabled: Boolean(alertId),
    retry: false,
    staleTime: 0,
  });
}

export function useLedger(projectId: string | undefined, filters: AuditFilters) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({
    queryKey: [...root(), "ledger", projectId ?? "all", filters, token],
    queryFn: () => getLedger(projectId, filters, accessToken),
    ...opts,
  });
}

/** Runs only after the operator submits the form (`request` is null until then). Nothing is executed. */
export function useSimulation(request: SimulationRequest | null) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({
    queryKey: [...root(), "simulate", request, token],
    queryFn: () => simulate(request as SimulationRequest, accessToken),
    enabled: request !== null,
    retry: false,
    staleTime: 0,
  });
}

export function useSecrets() {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({ queryKey: [...root(), "secrets", token], queryFn: () => getSecrets(accessToken), ...opts });
}

export function useProjectSecurity(projectId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({
    queryKey: [...root(), "project", projectId, token],
    queryFn: () => getProjectSecurity(projectId ?? "", accessToken),
    enabled: Boolean(projectId),
    ...opts,
  });
}

/** Every command (success or failure) refetches all trust queries so the screen reflects the server. */
export function useTrustCommand() {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return useMutation<CommandResult, unknown, CommandInput>({
    mutationFn: ({ command, body }) => runSecurityCommand(command, body, accessToken),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: root() });
    },
  });
}
