import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth/useAuth";
import {
  CostCenterError,
  getProjectAuditFindings,
  getProjectCostReport,
  getProjectGovernancePolicy,
  type CostCenterFailure,
} from "./costCenterClient";

const KEY = ["workforce", "costCenter"] as const;

export type CostCenterState = "loading" | "ready" | CostCenterFailure;

function stateOf(query: { isLoading: boolean; error: unknown }): CostCenterState {
  if (query.isLoading) return "loading";
  if (query.error) return query.error instanceof CostCenterError ? query.error.failure : "unavailable";
  return "ready";
}

export function useProjectCostReport(projectId: string) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...KEY, projectId, "cost", accessToken ?? "anonymous"],
    queryFn: () => getProjectCostReport(projectId, accessToken),
    retry: false,
    staleTime: 15_000,
  });
  return { state: stateOf(query), data: query.data, refetch: () => void query.refetch() };
}

export function useProjectAuditFindings(projectId: string) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...KEY, projectId, "audit-findings", accessToken ?? "anonymous"],
    queryFn: () => getProjectAuditFindings(projectId, accessToken),
    retry: false,
    staleTime: 15_000,
  });
  return { state: stateOf(query), data: query.data, refetch: () => void query.refetch() };
}

export function useProjectGovernancePolicy(projectId: string) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...KEY, projectId, "governance-policy", accessToken ?? "anonymous"],
    queryFn: () => getProjectGovernancePolicy(projectId, accessToken),
    retry: false,
    staleTime: 15_000,
  });
  return { state: stateOf(query), data: query.data, refetch: () => void query.refetch() };
}
