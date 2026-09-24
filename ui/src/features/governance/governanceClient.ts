/**
 * Approvals queue + audit trail (read) and approval decisions (write) over the
 * same-origin Control Plane API. The backend filters by project scope,
 * paginates, redacts and authorizes; the browser never reads Firestore.
 */
import { apiRequest } from "../../api/client";
import { ApiError } from "../../api/errors";

export type ApprovalStatus = "requested" | "approved" | "rejected" | "expired";
export type RiskLevel = "low" | "medium" | "high";

/** contracts/control.ts `ApprovalView`. */
export interface ApprovalItem {
  approvalId: string;
  status: ApprovalStatus;
  action: string;
  risk: RiskLevel;
  requestedBy: string;
  reason: string;
  taskId?: string;
  workflowId?: string;
  toolId?: string;
  agentId?: string;
  projectId?: string;
  executionPlanId?: string;
  planVersion?: number;
  requestedAt: string;
  expiresAt?: string;
  decidedBy?: string;
  decidedAt?: string;
}

/** contracts/control.ts `AuditEventView` (data is redacted server-side). */
export interface AuditItem {
  id: string;
  timestamp: string;
  type: string;
  actor?: string;
  taskId?: string;
  agentId?: string;
  projectId?: string;
  workflowId?: string;
  toolId?: string;
  correlationId?: string;
  outcome?: string;
  data: Record<string, unknown>;
}

export interface Page<T> {
  items: readonly T[];
  total: number;
  nextCursor: string | null;
}

export type GovernanceFailure = "unauthenticated" | "forbidden" | "not_found" | "conflict" | "invalid" | "unavailable";

export class GovernanceError extends Error {
  readonly failure: GovernanceFailure;
  constructor(failure: GovernanceFailure, message: string) {
    super(message);
    this.name = "GovernanceError";
    this.failure = failure;
  }
}

function toError(error: unknown): GovernanceError {
  if (error instanceof ApiError) {
    const failure: GovernanceFailure =
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
    return new GovernanceError(failure, error.message);
  }
  return new GovernanceError("unavailable", "Control Plane unreachable");
}

async function call<T>(path: string, token: string | null | undefined, init: RequestInit = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, { method: "GET", ...init, accessToken: token });
  } catch (error) {
    throw toError(error);
  }
}

export const PAGE_SIZE = 25;

export interface ApprovalFilter {
  status?: ApprovalStatus;
  projectId?: string;
}

export function getApprovals(filter: ApprovalFilter, cursor: string | undefined, token?: string | null) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (filter.status) params.set("status", filter.status);
  if (filter.projectId) params.set("projectId", filter.projectId);
  if (cursor) params.set("cursor", cursor);
  return call<Page<ApprovalItem>>(`/api/approvals?${params}`, token);
}

export interface AuditFilter {
  type?: string;
  outcome?: string;
  actor?: string;
  projectId?: string;
  correlationId?: string;
  since?: string;
  until?: string;
}

export function getAuditEvents(filter: AuditFilter, cursor: string | undefined, token?: string | null) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  for (const [key, value] of Object.entries(filter)) {
    if (typeof value === "string" && value.trim()) params.set(key, value.trim());
  }
  if (cursor) params.set("cursor", cursor);
  return call<Page<AuditItem>>(`/api/audit?${params}`, token);
}

export type ApprovalDecision =
  | { decision: "approve"; approvalId: string; note?: string }
  | { decision: "reject"; approvalId: string; reason: string };

/** Existing approve/reject commands — the backend authorizes and audits. */
export function decideApproval(decision: ApprovalDecision, token?: string | null) {
  const body =
    decision.decision === "approve"
      ? { approvalId: decision.approvalId, ...(decision.note ? { note: decision.note } : {}) }
      : { approvalId: decision.approvalId, reason: decision.reason };
  return call(`/api/commands/${decision.decision}`, token, { method: "POST", body: JSON.stringify(body) });
}
