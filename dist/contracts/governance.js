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
];
export const POLICY_REASON_CODES = [
    "PROJECT_ACCESS_DENIED",
    "BUDGET_LIMIT_REACHED",
    "MODEL_NOT_ALLOWED",
    "APPROVAL_REQUIRED",
    "UNKNOWN_COST_NOT_ALLOWED",
    "GOVERNANCE_UNAVAILABLE",
];
const MAX_TEXT = 500;
function optionalText(v, field) {
    if (v === undefined)
        return undefined;
    if (typeof v !== "string" || v.length > MAX_TEXT) {
        throw new ValidationError(`governance request.${field} must be a string of at most ${MAX_TEXT} characters`);
    }
    return requireText(v, `governance request.${field}`);
}
/**
 * Untrusted input → a well-formed `GovernanceRequest`. Rejects NaN/Infinity —
 * a NaN `estimatedUsd` would silently dodge every threshold comparison
 * (`NaN > x` is always false) while still counting as "cost is known", which
 * would bypass the approval-required check entirely. Never accepted.
 */
export function validateGovernanceRequest(input) {
    if (!input || typeof input !== "object") {
        throw new ValidationError("governance request must be an object");
    }
    const draft = input;
    const estimatedUsd = draft.estimatedUsd;
    if (estimatedUsd !== undefined &&
        (typeof estimatedUsd !== "number" ||
            !Number.isFinite(estimatedUsd) ||
            estimatedUsd < 0)) {
        throw new ValidationError("governance request.estimatedUsd must be a non-negative finite number");
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
export function validateGovernancePolicyDraft(input) {
    if (!input || typeof input !== "object") {
        throw new ValidationError("governance policy must be an object");
    }
    const draft = input;
    const listField = (key) => {
        const v = draft[key];
        if (v === undefined)
            return undefined;
        if (!Array.isArray(v) ||
            v.length === 0 ||
            !v.every((x) => typeof x === "string" && x.trim())) {
            throw new ValidationError(`governance policy.${key} must be a non-empty array of non-empty strings`);
        }
        return v.map((x) => x.trim().toLowerCase());
    };
    const threshold = draft.requireApprovalAboveUsd;
    if (threshold !== undefined &&
        (typeof threshold !== "number" ||
            !Number.isFinite(threshold) ||
            threshold < 0)) {
        throw new ValidationError("governance policy.requireApprovalAboveUsd must be a non-negative number");
    }
    if (typeof draft.allowUnknownCost !== "boolean") {
        throw new ValidationError("governance policy.allowUnknownCost must be a boolean");
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
export const GOVERNANCE_APPROVAL_ACTION = "governance.cost_override";
