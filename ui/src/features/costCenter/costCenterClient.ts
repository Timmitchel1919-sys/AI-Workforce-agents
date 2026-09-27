/**
 * EO-6.2/6.3 AI Cost Center + rule-based Auditor — read-only Control Plane
 * client. Same-origin Control Plane only (never Firestore, never a model
 * provider directly). There is no write call here: setting a budget or
 * governance policy is a separate, explicit admin command this client does
 * not expose.
 *
 * `configured: false` means this deployment has not composed that capability
 * at all — distinct from `configured: true` with an empty list/null policy,
 * which means the capability exists but nothing has been set yet. The UI
 * must keep these honestly separate; this client never collapses them.
 */
import { apiRequest } from "../../api/client";
import { ApiError } from "../../api/errors";

/* ------------------------------------------------------------------ */
/* Cost — usage, price, budget                                        */
/* ------------------------------------------------------------------ */

export interface PricedCost {
  priced: true;
  amountUsd: number;
  pricingVersion: string;
}
export interface UnpricedCost {
  priced: false;
  reason: string;
}
export type UsageCost = PricedCost | UnpricedCost;

export interface UsageRecord {
  usageId: string;
  projectId: string;
  taskId?: string;
  agentId?: string;
  sessionId?: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** ALWAYS the actual cost — never an estimate fabricated in the UI. */
  cost: UsageCost;
  createdAt: string;
}

export interface BudgetPolicy {
  projectId: string;
  dailyLimitUsd?: number;
  monthlyLimitUsd?: number;
  taskLimitUsd?: number;
  warningThresholdPercent: number;
  hardStop: boolean;
  updatedAt: string;
  updatedBy: string;
}

export type BudgetStatus = "not_configured" | "ok" | "warning" | "blocked" | "unpriced";

export interface BudgetEvaluation {
  status: BudgetStatus;
  scope?: "daily" | "monthly" | "task";
  limitUsd?: number;
  usedUsd?: number;
  currency: "USD";
  detail: string;
}

export interface CostCenterCapabilities {
  /** True only when at least one real model provider is registered. */
  enforcement: boolean;
  providerIds: readonly string[];
}

export type ProjectCostReport =
  | { configured: false }
  | {
      configured: true;
      budgetPolicy: BudgetPolicy | null;
      evaluation: BudgetEvaluation;
      usage: readonly UsageRecord[];
      capabilities: CostCenterCapabilities;
    };

/* ------------------------------------------------------------------ */
/* Auditor — rule-based findings                                      */
/* ------------------------------------------------------------------ */

export type AuditSeverity = "info" | "warning" | "critical";

export interface AuditFinding {
  findingId: string;
  projectId: string;
  ruleId: string;
  severity: AuditSeverity;
  subjectType: "release" | "session" | "usage";
  subjectId: string;
  detail: string;
  createdAt: string;
}

export type ProjectAuditFindings =
  | { configured: false }
  | {
      configured: true;
      projectId: string;
      generatedAt: string;
      rulesRun: readonly string[];
      findings: readonly AuditFinding[];
    };

/* ------------------------------------------------------------------ */
/* Governance policy — read-only display                              */
/* ------------------------------------------------------------------ */

export interface GovernancePolicy {
  projectId: string;
  allowedProviders?: readonly string[];
  allowedModels?: readonly string[];
  requireApprovalAboveUsd?: number;
  allowUnknownCost: boolean;
  updatedAt: string;
  updatedBy: string;
}

export type ProjectGovernancePolicy =
  | { configured: false }
  | { configured: true; policy: GovernancePolicy | null };

/* ------------------------------------------------------------------ */
/* Fetch plumbing — same shape as operationsClient                    */
/* ------------------------------------------------------------------ */

export type CostCenterFailure = "unauthenticated" | "forbidden" | "not_found" | "conflict" | "invalid" | "unavailable";

export class CostCenterError extends Error {
  readonly failure: CostCenterFailure;
  constructor(failure: CostCenterFailure, message: string) {
    super(message);
    this.name = "CostCenterError";
    this.failure = failure;
  }
}

function toFailure(error: unknown): CostCenterError {
  if (error instanceof ApiError) {
    const failure: CostCenterFailure =
      error.status === 401
        ? "unauthenticated"
        : error.status === 403
          ? "forbidden"
          : error.status === 404
            ? "not_found"
            : error.status === 409
              ? "conflict"
              : error.status === 400 || error.status === 422
                ? "invalid"
                : "unavailable";
    return new CostCenterError(failure, error.message);
  }
  return new CostCenterError("unavailable", "Control Plane unreachable");
}

async function get<T>(path: string, token?: string | null): Promise<T> {
  try {
    return await apiRequest<T>(path, { method: "GET", accessToken: token });
  } catch (error) {
    throw toFailure(error);
  }
}

const project = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;

export const getProjectCostReport = (projectId: string, token?: string | null) =>
  get<ProjectCostReport>(`${project(projectId)}/cost`, token);

export const getProjectAuditFindings = (projectId: string, token?: string | null) =>
  get<ProjectAuditFindings>(`${project(projectId)}/audit-findings`, token);

export const getProjectGovernancePolicy = (projectId: string, token?: string | null) =>
  get<ProjectGovernancePolicy>(`${project(projectId)}/governance-policy`, token);
