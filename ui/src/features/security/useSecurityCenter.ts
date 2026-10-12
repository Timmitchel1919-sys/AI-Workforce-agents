import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/useAuth";
import {
  getSecuritySummary,
  getSecurityDomains,
  getSecurityRecommendations,
  getSecurityAlerts,
  getSecurityAlert,
  acknowledgeAlert,
  dismissAlert,
  getSecurityIncidents,
  getSecurityIncident,
  assignIncident,
  updateIncidentStatus,
  resolveIncident,
  reopenIncident,
  addIncidentNote,
  type AlertFilter,
  type IncidentFilter,
  type SecurityIncidentStatus,
} from "./securityCenterClient";

const SECURITY_KEY = ["workforce", "security_center"] as const;

export function useSecuritySummary() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: [...SECURITY_KEY, "summary", accessToken ?? "anonymous"],
    queryFn: () => getSecuritySummary(accessToken),
    staleTime: 10_000,
    refetchInterval: 30_000, // Safe periodic refresh (Step 27)
  });
}

export function useSecurityDomains() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: [...SECURITY_KEY, "domains", accessToken ?? "anonymous"],
    queryFn: () => getSecurityDomains(accessToken),
    staleTime: 10_000,
  });
}

export function useSecurityRecommendations() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: [...SECURITY_KEY, "recommendations", accessToken ?? "anonymous"],
    queryFn: () => getSecurityRecommendations(accessToken),
    staleTime: 15_000,
  });
}

export function useSecurityAlerts(filter: AlertFilter = {}) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: [...SECURITY_KEY, "alerts", filter, accessToken ?? "anonymous"],
    queryFn: () => getSecurityAlerts(filter, accessToken),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useSecurityAlert(id?: string) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: [...SECURITY_KEY, "alert", id, accessToken ?? "anonymous"],
    queryFn: () => (id ? getSecurityAlert(id, accessToken) : Promise.reject("No id")),
    enabled: Boolean(id),
  });
}

export function useSecurityIncidents(filter: IncidentFilter = {}) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: [...SECURITY_KEY, "incidents", filter, accessToken ?? "anonymous"],
    queryFn: () => getSecurityIncidents(filter, accessToken),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useSecurityIncident(id?: string) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: [...SECURITY_KEY, "incident", id, accessToken ?? "anonymous"],
    queryFn: () => (id ? getSecurityIncident(id, accessToken) : Promise.reject("No id")),
    enabled: Boolean(id),
  });
}

export function useAcknowledgeAlert() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (alertId: string) => acknowledgeAlert(alertId, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...SECURITY_KEY] });
    },
  });
}

export function useDismissAlert() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ alertId, reason }: { alertId: string; reason: string }) =>
      dismissAlert(alertId, reason, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...SECURITY_KEY] });
    },
  });
}

export function useAssignIncident() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ incidentId, owner }: { incidentId: string; owner: string }) =>
      assignIncident(incidentId, owner, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...SECURITY_KEY] });
    },
  });
}

export function useUpdateIncidentStatus() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      incidentId,
      status,
      note,
    }: {
      incidentId: string;
      status: SecurityIncidentStatus;
      note?: string;
    }) => updateIncidentStatus(incidentId, status, note, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...SECURITY_KEY] });
    },
  });
}

export function useResolveIncident() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      incidentId,
      summary,
      rootCause,
    }: {
      incidentId: string;
      summary: string;
      rootCause?: string;
    }) => resolveIncident(incidentId, summary, rootCause, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...SECURITY_KEY] });
    },
  });
}

export function useReopenIncident() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ incidentId, reason }: { incidentId: string; reason: string }) =>
      reopenIncident(incidentId, reason, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...SECURITY_KEY] });
    },
  });
}

export function useAddIncidentNote() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ incidentId, note }: { incidentId: string; note: string }) =>
      addIncidentNote(incidentId, note, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...SECURITY_KEY] });
    },
  });
}
