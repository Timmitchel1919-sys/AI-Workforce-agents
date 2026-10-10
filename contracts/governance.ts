/**
 * EO-6.3 — Governance Policy Engine.
 *
 *   ALLOW != DENY != REQUIRE_APPROVAL != UNKNOWN · RECOMMENDATION != COMMAND ·
 *   APPROVAL != EXECUTION · UNKNOWN COST != ZERO COST
 *
 * A single, structured decision point that composes project authorization,
 * budget evaluation (core/cost-center's `BudgetEnforcer`) and an optional
 * per-project provider/model allow-list into one answer with a
 * machine-readable reason. It reuses the EXISTING `ApprovalSystem` for
 * `require_approval` — this is not a second approval subsystem, just a new
 * bound action namespace on the one that already exists (the same pattern
 * `core/release/approval-binding.ts` uses for release actions).
 *
 * `unknown` is a real, first-class outcome — a pre-execution cost that
 * cannot be estimated is reported as `unknown`, never silently allowed as if
 * it were free and never silently denied as if it were forbidden.
 */
import { ValidationError, requireExecutionId, requireText } from "./index.js";

/* ------------------------------------------------------------------ */
/* Decision                                                            */
/* ------------------------------------------------------------------ */

export const POLICY_DECISIONS = [
  "allow",
  "deny",
  "require_approval",
  "unknown",
] as const;
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

export const POLICY_REASON_CODES = [
  "PROJECT_ACCESS_DENIED",
  "BUDGET_LIMIT_REACHED",
  "MODEL_NOT_ALLOWED",
  "APPROVAL_REQUIRED",
  "UNKNOWN_COST_NOT_ALLOWED",
  "GOVERNANCE_UNAVAILABLE",
] as const;
export type PolicyReasonCode = (typeof POLICY_REASON_CODES)[number];

export interface GovernanceRequest {
  projectId: string;
  /** A stable id for THIS specific decision request — binds a filed approval to exactly this request, never a different one. */
  requestId: string;
  requestedBy: string;
  taskId?: string;
  provider?: string;
  model?: string;
  /**
   * A caller-supplied pre-execution estimate, in USD. Absent (not zero) when
   * the caller has no reliable way to estimate it — this engine never
   * invents one.
   */
  estimatedUsd?: number;
  reason?: string;
  /** An approval id from a PRIOR evaluation of this same requestId, if the caller has one. */
  approvalId?: string;
}

const MAX_TEXT = 500;
function optionalText(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v.length > MAX_TEXT) {
    throw new ValidationError(
      `governance request.${field} must be a string of at most ${MAX_TEXT} characters`,
    );
  }
  return requireText(v, `governance request.${field}`);
}

/**
 * Untrusted input → a well-formed `GovernanceRequest`. Rejects NaN/Infinity —
 * a NaN `estimatedUsd` would silently dodge every threshold comparison
 * (`NaN > x` is always false) while still counting as "cost is known", which
 * would bypass the approval-required check entirely. Never accepted.
 */
export function validateGovernanceRequest(input: unknown): GovernanceRequest {
  if (!input || typeof input !== "object") {
    throw new ValidationError("governance request must be an object");
  }
  const draft = input as Record<string, unknown>;
  const estimatedUsd = draft.estimatedUsd;
  if (
    estimatedUsd !== undefined &&
    (typeof estimatedUsd !== "number" ||
      !Number.isFinite(estimatedUsd) ||
      estimatedUsd < 0)
  ) {
    throw new ValidationError(
      "governance request.estimatedUsd must be a non-negative finite number",
    );
  }
  return {
    // Same strictness the engine itself re-checks (`requireExecutionId`), validated HERE so a
    // malformed id fails at the command's own try/catch — never past it, where it would skip the
    // audit trail (a validation mismatch between this boundary and the engine's internal check
    // was a real gap: fixed by matching them, not by only catching the engine's stricter throw).
    projectId: requireExecutionId(draft.projectId, "projectId"),
    requestId: requireExecutionId(draft.requestId, "requestId"),
    requestedBy: requireText(draft.requestedBy, "requestedBy"),
    taskId: optionalText(draft.taskId, "taskId"),
    provider: optionalText(draft.provider, "provider"),
    model: optionalText(draft.model, "model"),
    estimatedUsd,
    reason: optionalText(draft.reason, "reason"),
    approvalId: optionalText(draft.approvalId, "approvalId"),
  };
}

export interface GovernanceDecision {
  decision: PolicyDecision;
  reasonCode?: PolicyReasonCode;
  /** Operator-facing, safe detail — never a stack trace or an internal error message. */
  detail: string;
  /** Present only when this decision filed a NEW approval request (require_approval + an ApprovalSystem was supplied). */
  approvalId?: string;
}

/* ------------------------------------------------------------------ */
/* Per-project governance policy                                      */
/* ------------------------------------------------------------------ */

export interface GovernancePolicy {
  projectId: string;
  /** Configured means enforced; absent means this dimension is not evaluated at all — never a fabricated denial. */
  allowedProviders?: readonly string[];
  allowedModels?: readonly string[];
  /** A caller-supplied estimate above this USD amount requires approval before proceeding. */
  requireApprovalAboveUsd?: number;
  /** Whether a request with NO cost estimate at all may still proceed. Defaults to false (fail closed). */
  allowUnknownCost: boolean;
  updatedAt: string;
  updatedBy: string;
}

export function validateGovernancePolicyDraft(
  input: unknown,
): Omit<GovernancePolicy, "projectId" | "updatedAt" | "updatedBy"> {
  if (!input || typeof input !== "object") {
    throw new ValidationError("governance policy must be an object");
  }
  const draft = input as Record<string, unknown>;
  const listField = (
    key: "allowedProviders" | "allowedModels",
  ): readonly string[] | undefined => {
    const v = draft[key];
    if (v === undefined) return undefined;
    if (
      !Array.isArray(v) ||
      v.length === 0 ||
      !v.every((x) => typeof x === "string" && x.trim())
    ) {
      throw new ValidationError(
        `governance policy.${key} must be a non-empty array of non-empty strings`,
      );
    }
    return v.map((x) => x.trim().toLowerCase());
  };
  const threshold = draft.requireApprovalAboveUsd;
  if (
    threshold !== undefined &&
    (typeof threshold !== "number" ||
      !Number.isFinite(threshold) ||
      threshold < 0)
  ) {
    throw new ValidationError(
      "governance policy.requireApprovalAboveUsd must be a non-negative number",
    );
  }
  if (typeof draft.allowUnknownCost !== "boolean") {
    throw new ValidationError(
      "governance policy.allowUnknownCost must be a boolean",
    );
  }
  return {
    allowedProviders: listField("allowedProviders"),
    allowedModels: listField("allowedModels"),
    requireApprovalAboveUsd: threshold,
    allowUnknownCost: draft.allowUnknownCost,
  };
}

/* ------------------------------------------------------------------ */
/* Approval binding — governance's own bound-action namespace          */
/* ------------------------------------------------------------------ */

export const GOVERNANCE_APPROVAL_ACTION = "governance.cost_override" as const;

export interface GovernanceApprovalBinding {
  action: typeof GOVERNANCE_APPROVAL_ACTION;
  projectId: string;
  requestId: string;
}
