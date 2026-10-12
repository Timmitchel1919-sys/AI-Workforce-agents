/**
 * Security Foundation V1 — Layer 3
 *
 * Contracts for the Destructive Action Approval Gate. A destructive
 * action is NEVER executed by the service that owns these contracts;
 * execution lives in the specific subsystem (project deletion, agent
 * revoke, repository drop, …). The gate's job is to make every
 * destructive attempt deterministic: who is asking, what they will
 * destroy, which safer alternatives exist, how it is recovered, and
 * whether a human has approved exactly this request against exactly
 * this target.
 */
import type { Entity } from "./persistence.js";
import type {
  SecurityPolicyDecision,
  SecurityRiskLevel,
} from "./security-policy.js";

export const DESTRUCTIVE_ACTION_TYPES = [
  "delete_data",
  "delete_record",
  "delete_module",
  "delete_agent",
  "delete_workflow",
  "delete_integration",
  "delete_repository",
  "delete_project",
  "delete_environment",
  "delete_configuration",
  "delete_secret",
  "revoke_identity",
  "remove_access",
  "permanent_purge",
  "other_destructive",
] as const;
export type DestructiveActionType = (typeof DESTRUCTIVE_ACTION_TYPES)[number];

export const DESTRUCTIVE_ACTION_STATUSES = [
  "requested",
  "under_review",
  "awaiting_approval",
  "approved",
  "rejected",
  "changes_requested",
  "cancelled",
  "executing",
  "executed",
  "failed",
  "expired",
] as const;
export type DestructiveActionStatus =
  (typeof DESTRUCTIVE_ACTION_STATUSES)[number];

export const DESTRUCTIVE_SAFER_ALTERNATIVES = [
  "archive",
  "disable",
  "quarantine",
  "deprecate",
  "unlink",
  "migrate",
  "rollback",
  "soft_delete",
  "retain",
  "none",
] as const;
export type DestructiveSaferAlternative =
  (typeof DESTRUCTIVE_SAFER_ALTERNATIVES)[number];

export interface SaferAlternativeAssessment {
  alternative: DestructiveSaferAlternative;
  feasible: boolean;
  reason: string;
  recommended: boolean;
}

/**
 * Required justification payload. The service rejects a request whose
 * justification is incomplete; see `validateDestructiveJustification`.
 * `recoveryPlan` and `backupAvailable` must describe reality — they
 * come from the trusted execution path, not from raw client claims.
 */
export interface DestructiveActionJustification {
  summary: string;
  reason: string;
  blockerOrHindrance: string;
  expectedImpact: string;
  affectedResources: readonly string[];
  affectedUsers: readonly string[];
  affectedWorkflows: readonly string[];
  affectedIntegrations: readonly string[];
  saferAlternatives: readonly SaferAlternativeAssessment[];
  selectedAlternativeReason: string;
  reversible: boolean;
  backupAvailable: boolean;
  recoveryPlan: string;
  recoveryPoint?: string;
  rollbackAvailable: boolean;
  dataRetentionImpact: string;
  complianceImpact: string;
  risk: SecurityRiskLevel;
}

/**
 * History entry appended whenever a justification is amended or an
 * approval decision is recorded. Append-only: the service never
 * overwrites previous entries.
 */
export interface DestructiveActionHistoryEntry {
  recordedAt: string;
  recordedBy: string;
  kind:
    | "requested"
    | "changes_requested"
    | "justification_updated"
    | "approval_decided"
    | "status_changed"
    | "execution_result";
  note?: string;
  previousStatus?: DestructiveActionStatus;
  nextStatus?: DestructiveActionStatus;
}

export interface DestructiveActionRequest extends Entity {
  id: string;
  actionType: DestructiveActionType;
  action: string;
  requestedBy: string;
  actorType: "human" | "agent" | "service" | "system" | "integration";
  agentId?: string;
  projectId?: string;
  targetResourceType: string;
  targetResourceId: string;
  environment: "local" | "test" | "staging" | "production";
  production: boolean;
  irreversible: boolean;
  justification: DestructiveActionJustification;
  policyDecision: SecurityPolicyDecision;
  status: DestructiveActionStatus;
  approvalId?: string;
  /**
   * When `policyDecision.requiresTwoPersonApproval` is true, this holds
   * the second approver's record. The first approver lives on the
   * primary `approvalId`. The service never collapses two-person into
   * one-person approval.
   */
  secondaryApprovalId?: string;
  history: readonly DestructiveActionHistoryEntry[];
  /** The exact context the engine evaluated — pinned for TOCTOU revalidation. */
  pinnedTargetHash: string;
  requestedAt: string;
  updatedAt: string;
  expiresAt?: string;
  correlationId: string;
  /** Only set on `executed`. The verified post-execution evidence. */
  executionEvidence?: Readonly<Record<string, unknown>>;
}

/**
 * Draft used by `DestructiveActionService.request()`. The service
 * builds the full {@link DestructiveActionRequest} from this plus the
 * authoritative execution context.
 */
export interface DestructiveActionRequestDraft {
  actionType: DestructiveActionType;
  action: string;
  targetResourceType: string;
  targetResourceId: string;
  environment: "local" | "test" | "staging" | "production";
  production: boolean;
  irreversible: boolean;
  projectId?: string;
  justification: DestructiveActionJustification;
}

export type DestructiveApprovalDecision =
  "approve" | "reject" | "request_changes" | "prefer_safer_alternative";

/**
 * Terminal statuses — any further transition is a state-machine error.
 */
export const DESTRUCTIVE_TERMINAL_STATUSES: readonly DestructiveActionStatus[] =
  ["executed", "failed", "rejected", "cancelled", "expired"];

export function isDestructiveTerminal(
  status: DestructiveActionStatus,
): boolean {
  return DESTRUCTIVE_TERMINAL_STATUSES.includes(status);
}

/**
 * Deterministic validation. Rejects an incomplete justification with a
 * list of missing fields. The service wraps this in a ValidationError.
 */
export function validateDestructiveJustification(
  justification: DestructiveActionJustification,
): string[] {
  const problems: string[] = [];
  const requireString = (value: unknown, name: string) => {
    if (typeof value !== "string" || value.trim().length === 0)
      problems.push(`justification.${name} is required`);
  };
  requireString(justification.summary, "summary");
  requireString(justification.reason, "reason");
  requireString(justification.blockerOrHindrance, "blockerOrHindrance");
  requireString(justification.expectedImpact, "expectedImpact");
  requireString(
    justification.selectedAlternativeReason,
    "selectedAlternativeReason",
  );
  requireString(justification.recoveryPlan, "recoveryPlan");
  requireString(justification.dataRetentionImpact, "dataRetentionImpact");
  requireString(justification.complianceImpact, "complianceImpact");
  if (!Array.isArray(justification.saferAlternatives))
    problems.push("justification.saferAlternatives must be an array");
  else if (justification.saferAlternatives.length === 0)
    problems.push(
      "justification.saferAlternatives must enumerate at least one alternative",
    );
  if (typeof justification.reversible !== "boolean")
    problems.push("justification.reversible must be boolean");
  if (typeof justification.backupAvailable !== "boolean")
    problems.push("justification.backupAvailable must be boolean");
  if (typeof justification.rollbackAvailable !== "boolean")
    problems.push("justification.rollbackAvailable must be boolean");
  return problems;
}
