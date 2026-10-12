import { apiRequest } from "../../api/client";
import { ApiError } from "../../api/errors";

export type SecurityPostureStatus = "secure" | "attention" | "degraded" | "critical" | "unknown";

export type SecurityDomain =
  | "identity_access"
  | "application_api"
  | "agent_security"
  | "secrets"
  | "data_integrity"
  | "destructive_actions"
  | "software_supply_chain"
  | "backup_recovery"
  | "policy_governance"
  | "integration_security"
  | "cloud_edge"
  | "email_phishing"
  | "endpoint_security";

export type SecurityAlertSeverity = "critical" | "high" | "medium" | "low" | "info";
export type SecurityAlertStatus = "open" | "acknowledged" | "investigating" | "resolved" | "dismissed";
export type SecurityIncidentSeverity = "critical" | "high" | "medium" | "low";
export type SecurityIncidentStatus = "open" | "triaged" | "investigating" | "contained" | "recovering" | "resolved" | "closed";

export interface SecurityDomainPosture {
  domain: SecurityDomain;
  status: SecurityPostureStatus;
  score?: number;
  openCritical: number;
  openHigh: number;
  openMedium: number;
  openLow: number;
  lastEvaluatedAt: string;
  summary: string;
  recommendations: readonly string[];
  configured: boolean;
}

export interface SecurityPostureSummary {
  generatedAt: string;
  overallStatus: SecurityPostureStatus;
  overallScore?: number;
  domains: readonly SecurityDomainPosture[];
  criticalAlerts: number;
  highAlerts: number;
  mediumAlerts: number;
  lowAlerts: number;
  openIncidents: number;
  unresolvedFindings: number;
  telemetryDegraded?: boolean;
  activeBanner?: {
    title: string;
    severity: "critical" | "high" | "attention";
    message: string;
    count: number;
  };
}

export interface SecurityAlert {
  id: string;
  title: string;
  description: string;
  severity: SecurityAlertSeverity;
  domain: SecurityDomain;
  status: SecurityAlertStatus;
  sourceEventIds: readonly string[];
  eventCount: number;
  projectId?: string;
  environment?: string;
  target?: string;
  detectedAt: string;
  lastObservedAt: string;
  correlationId?: string;
  recommendedAction?: string;
  incidentId?: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  dismissedBy?: string;
  dismissedAt?: string;
  dismissReason?: string;
  evidenceSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface SecurityIncidentTimelineEntry {
  id: string;
  timestamp: string;
  type: string;
  actor: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface SecurityIncident {
  id: string;
  title: string;
  description: string;
  severity: SecurityIncidentSeverity;
  status: SecurityIncidentStatus;
  projectId?: string;
  environment?: string;
  domain: SecurityDomain;
  alertIds: readonly string[];
  sourceEventIds: readonly string[];
  affectedResources: readonly string[];
  affectedActors: readonly string[];
  owner?: string;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt?: string;
  containmentStartedAt?: string;
  resolvedAt?: string;
  resolutionSummary?: string;
  resolvedBy?: string;
  reopenedAt?: string;
  reopenedBy?: string;
  reopenReason?: string;
  rootCause?: string;
  recoveryRequestId?: string;
  correlationIds: readonly string[];
  investigationNotes: readonly { note: string; author: string; timestamp: string }[];
  timeline: readonly SecurityIncidentTimelineEntry[];
}

export interface SecurityRecommendation {
  id: string;
  domain: SecurityDomain;
  title: string;
  description: string;
  severity: SecurityAlertSeverity;
  remediationAction: string;
  ruleId: string;
  status: "active" | "dismissed";
}

export type SecurityCenterFailure =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid"
  | "unavailable";

export class SecurityCenterError extends Error {
  readonly failure: SecurityCenterFailure;
  constructor(failure: SecurityCenterFailure, message: string) {
    super(message);
    this.name = "SecurityCenterError";
    this.failure = failure;
  }
}

function toError(error: unknown): SecurityCenterError {
  if (error instanceof ApiError) {
    const failure: SecurityCenterFailure =
      error.status === 401
        ? "unauthenticated"
        : error.status === 403
          ? "forbidden"
          : error.status === 404
            ? "not_found"
            : error.status === 409
              ? "conflict"
              : error.status === 400
                ? "invalid"
                : "unavailable";
    return new SecurityCenterError(failure, error.message);
  }
  return new SecurityCenterError("unavailable", "Security Center API unreachable");
}

async function call<T>(
  path: string,
  token: string | null | undefined,
  init: RequestInit = {},
): Promise<T> {
  try {
    return await apiRequest<T>(path, {
      method: "GET",
      ...init,
      accessToken: token,
    });
  } catch (error) {
    throw toError(error);
  }
}

export async function getSecuritySummary(token?: string | null): Promise<SecurityPostureSummary> {
  return call<SecurityPostureSummary>("/api/security/summary", token);
}

export async function getSecurityDomains(token?: string | null): Promise<SecurityDomainPosture[]> {
  return call<SecurityDomainPosture[]>("/api/security/domains", token);
}

export async function getSecurityRecommendations(token?: string | null): Promise<SecurityRecommendation[]> {
  return call<SecurityRecommendation[]>("/api/security/recommendations", token);
}

export interface AlertFilter {
  severity?: SecurityAlertSeverity;
  status?: SecurityAlertStatus;
  domain?: SecurityDomain;
  projectId?: string;
}

export async function getSecurityAlerts(filter: AlertFilter = {}, token?: string | null): Promise<SecurityAlert[]> {
  const params = new URLSearchParams();
  if (filter.severity) params.set("severity", filter.severity);
  if (filter.status) params.set("status", filter.status);
  if (filter.domain) params.set("domain", filter.domain);
  if (filter.projectId) params.set("projectId", filter.projectId);
  return call<SecurityAlert[]>(`/api/security/alerts?${params}`, token);
}

export async function getSecurityAlert(id: string, token?: string | null): Promise<SecurityAlert> {
  return call<SecurityAlert>(`/api/security/alerts/${encodeURIComponent(id)}`, token);
}

export async function acknowledgeAlert(id: string, token?: string | null): Promise<SecurityAlert> {
  return call<SecurityAlert>(`/api/security/alerts/${encodeURIComponent(id)}/acknowledge`, token, {
    method: "POST",
  });
}

export async function dismissAlert(id: string, reason: string, token?: string | null): Promise<SecurityAlert> {
  return call<SecurityAlert>(`/api/security/alerts/${encodeURIComponent(id)}/dismiss`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

export interface IncidentFilter {
  severity?: SecurityIncidentSeverity;
  status?: SecurityIncidentStatus;
  domain?: SecurityDomain;
  projectId?: string;
}

export async function getSecurityIncidents(filter: IncidentFilter = {}, token?: string | null): Promise<SecurityIncident[]> {
  const params = new URLSearchParams();
  if (filter.severity) params.set("severity", filter.severity);
  if (filter.status) params.set("status", filter.status);
  if (filter.domain) params.set("domain", filter.domain);
  if (filter.projectId) params.set("projectId", filter.projectId);
  return call<SecurityIncident[]>(`/api/security/incidents?${params}`, token);
}

export async function getSecurityIncident(id: string, token?: string | null): Promise<SecurityIncident> {
  return call<SecurityIncident>(`/api/security/incidents/${encodeURIComponent(id)}`, token);
}

export async function assignIncident(id: string, owner: string, token?: string | null): Promise<SecurityIncident> {
  return call<SecurityIncident>(`/api/security/incidents/${encodeURIComponent(id)}/assign`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner }),
  });
}

export async function updateIncidentStatus(
  id: string,
  status: SecurityIncidentStatus,
  note?: string,
  token?: string | null,
): Promise<SecurityIncident> {
  return call<SecurityIncident>(`/api/security/incidents/${encodeURIComponent(id)}/status`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, note }),
  });
}

export async function resolveIncident(
  id: string,
  summary: string,
  rootCause?: string,
  token?: string | null,
): Promise<SecurityIncident> {
  return call<SecurityIncident>(`/api/security/incidents/${encodeURIComponent(id)}/resolve`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ summary, rootCause }),
  });
}

export async function reopenIncident(
  id: string,
  reason: string,
  token?: string | null,
): Promise<SecurityIncident> {
  return call<SecurityIncident>(`/api/security/incidents/${encodeURIComponent(id)}/reopen`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

export async function addIncidentNote(
  id: string,
  note: string,
  token?: string | null,
): Promise<SecurityIncident> {
  return call<SecurityIncident>(`/api/security/incidents/${encodeURIComponent(id)}/notes`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
}
