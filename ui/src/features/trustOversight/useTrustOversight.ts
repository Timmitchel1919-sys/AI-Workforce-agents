import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  decideApproval,
  executeEmergencyLock,
  fetchApprovals,
  fetchEmergencyState,
  fetchTrustEvents,
  fetchTrustOverview,
  releaseEmergencyLock,
  type UnifiedApprovalStatus,
} from "./trustOversightClient";

const TRUST_KEY = ["trust-oversight"] as const;

export function useTrustOverview(projectId?: string) {
  return useQuery({
    queryKey: [...TRUST_KEY, "overview", projectId ?? null] as const,
    queryFn: () => fetchTrustOverview(projectId),
    refetchInterval: 30_000,
  });
}

export function useTrustApprovals(options: {
  projectId?: string;
  status?: UnifiedApprovalStatus;
} = {}) {
  return useQuery({
    queryKey: [
      ...TRUST_KEY,
      "approvals",
      options.projectId ?? null,
      options.status ?? null,
    ] as const,
    queryFn: () => fetchApprovals(options),
  });
}

export function useEmergencyState() {
  return useQuery({
    queryKey: [...TRUST_KEY, "emergency"] as const,
    queryFn: fetchEmergencyState,
    refetchInterval: 15_000,
  });
}

export function useTrustEvents(options: {
  projectId?: string;
  limit?: number;
} = {}) {
  return useQuery({
    queryKey: [
      ...TRUST_KEY,
      "events",
      options.projectId ?? null,
      options.limit ?? 50,
    ] as const,
    queryFn: () => fetchTrustEvents(options),
  });
}

export function useDecideApproval() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      approvalId: string;
      decision: "approved" | "rejected" | "modified" | "cancelled";
      notes?: string;
      modifiedPayload?: Record<string, unknown>;
    }) =>
      decideApproval(
        input.approvalId,
        input.decision,
        input.notes,
        input.modifiedPayload,
      ),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: TRUST_KEY });
    },
  });
}

export function useExecuteEmergencyLock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: executeEmergencyLock,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: TRUST_KEY });
    },
  });
}

export function useReleaseEmergencyLock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: releaseEmergencyLock,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: TRUST_KEY });
    },
  });
}
