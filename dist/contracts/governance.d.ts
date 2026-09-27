export declare const POLICY_DECISIONS: readonly ["allow", "deny", "require_approval", "unknown"];
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];
export declare const POLICY_REASON_CODES: readonly ["PROJECT_ACCESS_DENIED", "BUDGET_LIMIT_REACHED", "MODEL_NOT_ALLOWED", "APPROVAL_REQUIRED", "UNKNOWN_COST_NOT_ALLOWED", "GOVERNANCE_UNAVAILABLE"];
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
/**
 * Untrusted input → a well-formed `GovernanceRequest`. Rejects NaN/Infinity —
 * a NaN `estimatedUsd` would silently dodge every threshold comparison
 * (`NaN > x` is always false) while still counting as "cost is known", which
 * would bypass the approval-required check entirely. Never accepted.
 */
export declare function validateGovernanceRequest(input: unknown): GovernanceRequest;
export interface GovernanceDecision {
    decision: PolicyDecision;
    reasonCode?: PolicyReasonCode;
    /** Operator-facing, safe detail — never a stack trace or an internal error message. */
    detail: string;
    /** Present only when this decision filed a NEW approval request (require_approval + an ApprovalSystem was supplied). */
    approvalId?: string;
}
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
export declare function validateGovernancePolicyDraft(input: unknown): Omit<GovernancePolicy, "projectId" | "updatedAt" | "updatedBy">;
export declare const GOVERNANCE_APPROVAL_ACTION: "governance.cost_override";
export interface GovernanceApprovalBinding {
    action: typeof GOVERNANCE_APPROVAL_ACTION;
    projectId: string;
    requestId: string;
}
