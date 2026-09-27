/**
 * EO-7 — Model Routing & Intelligent Execution Selection.
 *
 *   AGENT != MODEL != PROVIDER != ENVIRONMENT · AVAILABLE != QUALIFIED ·
 *   SUPPORTED != ALLOWED != SELECTED != EXECUTED · MODEL POLICY != ROUTER ·
 *   REQUESTED MODEL != ACTUAL MODEL · FALLBACK != SILENT DOWNGRADE ·
 *   CHEAPEST != BEST · UNKNOWN COST != ZERO COST
 *
 * The Model Router is a RUNTIME decision point, one level below planning-time
 * eligibility (`core/planning/model-capability-registry.ts`'s
 * `ModelCapabilityRegistry.eligibility`, which only asks "does SOME profile
 * exist that could serve this agent's declared model policy"). Routing asks
 * the sharper question: "of the candidates that exist RIGHT NOW, which one is
 * actually capable, available, permitted and affordable enough to select for
 * THIS execution" — and records the answer, including every rejected
 * candidate and why, so the decision is reconstructable afterward.
 *
 * Reuses the EXISTING model-capability taxonomy (`ModelCapability`,
 * `ModelCapabilityProfile` from ./planning.js) rather than inventing a
 * parallel one, and the EXISTING Governance Policy Engine
 * (core/cost-center/governance-policy-engine.ts) for policy/budget — this is
 * not a second policy or cost system.
 */
import { ValidationError, requireExecutionId, requireText } from "./index.js";
/* ------------------------------------------------------------------ */
/* Model status — never a fabricated live health signal                */
/* ------------------------------------------------------------------ */
/**
 * `available`/`unavailable` are derived from whether a real provider factory
 * is actually registered — a fact we genuinely know. `degraded`/`disabled`
 * require an explicit signal this layer does not yet produce (no code path
 * sets them); they exist so a future real health probe has a stable name to
 * report into, never as a placeholder guess. `unknown` is for when even
 * availability cannot be determined, not a softer way to say "unavailable".
 */
export const MODEL_STATUSES = ["available", "unavailable", "degraded", "disabled", "unknown"];
/* ------------------------------------------------------------------ */
/* Routing profiles — policies, never hardcoded model aliases          */
/* ------------------------------------------------------------------ */
export const ROUTING_PROFILES = ["balanced", "cost_efficient", "quality_first", "low_latency", "high_assurance"];
/* ------------------------------------------------------------------ */
/* Candidate rejection — explainable, machine-readable                 */
/* ------------------------------------------------------------------ */
export const CANDIDATE_REJECTION_REASONS = [
    "CAPABILITY_MISMATCH",
    "MODEL_UNAVAILABLE",
    "PROVIDER_UNAVAILABLE",
    "PROJECT_POLICY_DENIED",
    "BUDGET_EXCEEDED",
    "SECURITY_POLICY_DENIED",
    "TOOL_SUPPORT_REQUIRED",
    "CONTEXT_REQUIREMENT_NOT_MET",
    "ENVIRONMENT_INCOMPATIBLE",
    "MODEL_DISABLED",
];
const MAX_TEXT = 200;
function optionalText(v, field) {
    if (v === undefined)
        return undefined;
    if (typeof v !== "string" || v.length > MAX_TEXT) {
        throw new ValidationError(`routing request.${field} must be a string of at most ${MAX_TEXT} characters`);
    }
    return requireText(v, `routing request.${field}`);
}
/** Untrusted input → a well-formed override REQUEST. Validating it is not authorizing it. */
export function validateManualModelOverride(input) {
    if (!input || typeof input !== "object") {
        throw new ValidationError("manual model override request must be an object");
    }
    const draft = input;
    return {
        projectId: requireExecutionId(draft.projectId, "projectId"),
        requestId: requireExecutionId(draft.requestId, "requestId"),
        requestedBy: requireText(draft.requestedBy, "requestedBy"),
        provider: requireText(draft.provider, "provider"),
        model: optionalText(draft.model, "model"),
        reason: optionalText(draft.reason, "reason"),
    };
}
