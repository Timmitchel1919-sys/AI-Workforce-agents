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
  /**
   * Monotonic version of the authoritative request state. Starts at 1
   * and increments every time a MATERIAL field (see
   * {@link MATERIAL_JUSTIFICATION_FIELDS} and the material-identity
   * fields on the request itself) changes. Every approval binds to a
   * specific `(destructiveActionId, revision)`. On revision bump,
   * previous approvals are RETAINED in history but never again count
   * toward execution authorization.
   */
  revision: number;
  approvalId?: string;
  /**
   * When `policyDecision.requiresTwoPersonApproval` is true, this holds
   * the second approver's record. The first approver lives on the
   * primary `approvalId`. The service never collapses two-person into
   * one-person approval.
   */
  secondaryApprovalId?: string;
  /**
   * Append-only register of (revision → [primary approvalId, secondary
   * approvalId]). Previous revisions' entries are preserved so audit
   * can replay who approved which revision, but the executor only
   * trusts the entry whose revision matches the current `revision`.
   */
  approvalHistory: readonly RevisionApprovalEntry[];
  history: readonly DestructiveActionHistoryEntry[];
  /** SHA-256 hex digest pinning the material target + revision. */
  pinnedTargetHash: string;
  /** SHA-256 hex digest over the policy decision bound at (re)approval. */
  pinnedPolicyFingerprint: string;
  requestedAt: string;
  updatedAt: string;
  expiresAt?: string;
  correlationId: string;
  /** Only set on `executed`. The verified post-execution evidence. */
  executionEvidence?: Readonly<Record<string, unknown>>;
}

/**
 * One row of the per-revision approval register. The entry is only
 * authoritative while `revision === request.revision`; older rows stay
 * for audit replay.
 */
export interface RevisionApprovalEntry {
  revision: number;
  primaryApprovalId?: string;
  secondaryApprovalId?: string;
  invalidatedAt?: string;
  invalidatedReason?: string;
}

/**
 * The complete set of justification fields that count as MATERIAL. A
 * change to any of them triggers a revision bump and invalidates all
 * approvals already attached. A change to a non-material field (e.g.
 * a trailing note the service may add in future) does not.
 */
export const MATERIAL_JUSTIFICATION_FIELDS = [
  "summary",
  "reason",
  "expectedImpact",
  "affectedResources",
  "affectedUsers",
  "affectedWorkflows",
  "affectedIntegrations",
  "saferAlternatives",
  "reversible",
  "backupAvailable",
  "recoveryPlan",
  "recoveryPoint",
  "rollbackAvailable",
  "dataRetentionImpact",
  "complianceImpact",
  "risk",
] as const;

/**
 * The complete set of request-level fields that count as MATERIAL
 * (orthogonal to the justification material fields above). Any change
 * forces a revision bump.
 */
export const MATERIAL_REQUEST_FIELDS = [
  "action",
  "actionType",
  "projectId",
  "targetResourceType",
  "targetResourceId",
  "environment",
  "production",
  "irreversible",
] as const;

/**
 * Trusted boundary evidence that the executor passes to
 * `assertDestructiveActionApproved(...)`. Layer 3 **validates** the
 * shape and freshness but does NOT itself verify MFA or reauth — the
 * authoritative verification lives in Layer 5 middleware. Raw client
 * input must never flow into this field: the API layer constructs the
 * evidence from a trusted verifier and hands the result to the
 * executor.
 */
export interface SecurityReauthenticationEvidence {
  verified: boolean;
  verifiedAt: string;
  method: string;
}

export interface SecurityMfaEvidence {
  verified: boolean;
  verifiedAt: string;
  method: string;
}

/**
 * Freshness window applied to MFA / reauth evidence at execution
 * time. Values older than the window are rejected as stale. The
 * window is intentionally short — long-lived evidence weakens the
 * TOCTOU guarantee.
 */
export const SECURITY_EVIDENCE_FRESHNESS = {
  reauthWindowMs: 10 * 60 * 1000,
  mfaWindowMs: 10 * 60 * 1000,
} as const;

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
 * Partial update applied to an existing destructive request. Only
 * fields the caller explicitly provides are considered — unset fields
 * keep their current value. The service runs material-change
 * detection and bumps `revision` when any of
 * {@link MATERIAL_REQUEST_FIELDS} or
 * {@link MATERIAL_JUSTIFICATION_FIELDS} changed, invalidating any
 * approvals already attached to the OLD revision.
 */
export interface DestructiveActionRequestRevision {
  action?: string;
  actionType?: DestructiveActionType;
  targetResourceType?: string;
  targetResourceId?: string;
  environment?: "local" | "test" | "staging" | "production";
  production?: boolean;
  irreversible?: boolean;
  projectId?: string;
  justification?: DestructiveActionJustification;
}

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
