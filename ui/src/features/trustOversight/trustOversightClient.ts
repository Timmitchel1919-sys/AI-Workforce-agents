/**
 * Trust, Governance & Human Oversight Center client (Layer 16).
 *
 * Thin wrapper over the authorized Control Plane `/api/trust-oversight/*`
 * routes. The server enforces role, project scope, risk evaluation and
 * audit; the browser never evaluates policy or decides approvals locally.
 */
import { apiRequest } from "../../api/client";

export type OverallTrustStatus =
  | "verified"
  | "attention"
  | "restricted"
  | "emergency_lockdown";

export type UnifiedApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "modified"
  | "cancelled"
  | "expired";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface TrustEvent {
  id: string;
  eventId: string;
  type:
    | "trust_level_changed"
    | "autonomy_policy_updated"
    | "privileged_action_intercepted"
    | "policy_violation_blocked"
    | "emergency_control_executed"
    | "approval_decided"
    | "anomaly_detected";
  severity: "info" | "low" | "medium" | "high" | "critical";
  actor: string;
  projectId?: string;
  target: string;
  summary: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface ActiveEmergencyLock {
  id: string;
  action: string;
  targetId?: string;
  lockedAt: string;
  lockedBy: string;
  reason: string;
}

export interface EmergencyControlState {
  automationLockedDown: boolean;
  activeLocks: readonly ActiveEmergencyLock[];
  updatedAt: string;
  updatedBy: string;
}

export interface TrustCenterSummary {
  generatedAt: string;
  overallTrustStatus: OverallTrustStatus;
  automationLockedDown: boolean;
  pendingApprovalsCount: number;
  criticalPendingApprovalsCount: number;
  activeEmergencyLocksCount: number;
  blockedViolations24h: number;
  entities: {
    agents: { total: number; trusted: number; untrusted: number };
    tools: { total: number; trusted: number; restricted: number };
    models: { total: number; compliant: number };
  };
  recentPrivilegedActions: readonly TrustEvent[];
  recentViolations: readonly TrustEvent[];
}

export interface UnifiedApprovalItem {
  id: string;
  approvalId: string;
  action: string;
  requester: {
    actorId: string;
    actorType: "human" | "agent" | "system";
    agentId?: string;
  };
  projectId?: string;
  riskLevel: RiskLevel;
  affectedResources: readonly string[];
  reason: string;
  rollbackAvailable: boolean;
  status: UnifiedApprovalStatus;
  decisionNotes?: string;
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export function fetchTrustOverview(projectId?: string): Promise<TrustCenterSummary> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return apiRequest<TrustCenterSummary>(`/api/trust-oversight/overview${qs}`);
}

export function fetchApprovals(options: {
  projectId?: string;
  status?: UnifiedApprovalStatus;
} = {}): Promise<{ approvals: readonly UnifiedApprovalItem[]; total: number }> {
  const params = new URLSearchParams();
  if (options.projectId) params.set("projectId", options.projectId);
  if (options.status) params.set("status", options.status);
  const qs = params.toString() ? `?${params}` : "";
  return apiRequest<{ approvals: readonly UnifiedApprovalItem[]; total: number }>(
    `/api/trust-oversight/approvals${qs}`,
  );
}

export function decideApproval(
  approvalId: string,
  decision: "approved" | "rejected" | "modified" | "cancelled",
  notes?: string,
  modifiedPayload?: Record<string, unknown>,
): Promise<UnifiedApprovalItem> {
  return apiRequest<UnifiedApprovalItem>(
    `/api/trust-oversight/approvals/${encodeURIComponent(approvalId)}/decide`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, notes, modifiedPayload }),
    },
  );
}

export function fetchEmergencyState(): Promise<EmergencyControlState> {
  return apiRequest<EmergencyControlState>(`/api/trust-oversight/emergency`);
}

export function executeEmergencyLock(input: {
  action: string;
  targetId?: string;
  reason: string;
}): Promise<EmergencyControlState> {
  return apiRequest<EmergencyControlState>(`/api/trust-oversight/emergency/lock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function releaseEmergencyLock(lockId: string): Promise<EmergencyControlState> {
  return apiRequest<EmergencyControlState>(`/api/trust-oversight/emergency/release`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lockId }),
  });
}

export function fetchTrustEvents(options: {
  projectId?: string;
  limit?: number;
} = {}): Promise<{ events: readonly TrustEvent[]; total: number }> {
  const params = new URLSearchParams();
  if (options.projectId) params.set("projectId", options.projectId);
  if (options.limit) params.set("limit", String(options.limit));
  const qs = params.toString() ? `?${params}` : "";
  return apiRequest<{ events: readonly TrustEvent[]; total: number }>(
    `/api/trust-oversight/events${qs}`,
  );
}
