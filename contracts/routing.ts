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
import {
  ValidationError,
  requireExecutionId,
  requireText,
  type ModelCapability,
} from "./index.js";

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
export const MODEL_STATUSES = [
  "available",
  "unavailable",
  "degraded",
  "disabled",
  "unknown",
] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];

/* ------------------------------------------------------------------ */
/* Routing profiles — policies, never hardcoded model aliases          */
/* ------------------------------------------------------------------ */

export const ROUTING_PROFILES = [
  "balanced",
  "cost_efficient",
  "quality_first",
  "low_latency",
  "high_assurance",
] as const;
export type RoutingProfile = (typeof ROUTING_PROFILES)[number];

/* ------------------------------------------------------------------ */
/* Requirement profile — the input to routing, not a model name        */
/* ------------------------------------------------------------------ */

export interface ModelRequirementProfile {
  requiredCapabilities: readonly ModelCapability[];
  preferredCapabilities?: readonly ModelCapability[];
  toolRequirements?: boolean;
  structuredOutput?: boolean;
  vision?: boolean;
  routingProfile?: RoutingProfile;
  /** Trusted, server-derived only — never a raw frontend-supplied provider/model id without server validation (see `validateManualModelOverride`). */
  providerRestrictions?: readonly string[];
  modelRestrictions?: readonly string[];
}

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
  /**
   * The agent's own `modelPolicy` scoped in no declared profile at all — it
   * named no provider, or a provider this deployment has no profile for. This
   * is a defect in the agent definition, not a capability shortfall, and is
   * reported separately so the diagnostic names the actual cause.
   */
  "AGENT_MODEL_POLICY_UNSCOPED",
] as const;
export type CandidateRejectionReason =
  (typeof CANDIDATE_REJECTION_REASONS)[number];

export interface RejectedCandidate {
  profileId: string;
  providerId: string;
  model?: string;
  reasonCode: CandidateRejectionReason;
  /** Operator-facing, safe — never a policy internal or a stack trace. */
  detail: string;
}

export interface RoutingCandidate {
  profileId: string;
  providerId: string;
  model?: string;
  status: ModelStatus;
}

/* ------------------------------------------------------------------ */
/* Routing decision — reconstructable                                  */
/* ------------------------------------------------------------------ */

export interface RoutingDecision {
  routingDecisionId: string;
  projectId: string;
  taskId?: string;
  executionSessionId?: string;
  agentId: string;
  requirements: ModelRequirementProfile;
  candidateModels: readonly RoutingCandidate[];
  rejectedCandidates: readonly RejectedCandidate[];
  selectedProvider?: string;
  selectedModel?: string;
  /** Empty when a candidate was selected; non-empty explains a "no valid model" outcome. */
  reasonCodes: readonly CandidateRejectionReason[];
  costEstimate?:
    { priced: true; amountUsd: number } | { priced: false; reason: string };
  policyDecision?: { decision: string; reasonCode?: string; detail: string };
  fallbackPolicy: "none" | "governed";
  /** Set only when this decision is itself a fallback of an earlier one. */
  fallbackOf?: string;
  fallbackUsed: boolean;
  createdAt: string;
  correlationId?: string;
}

/* ------------------------------------------------------------------ */
/* Manual override — a REQUEST, never automatic authorization          */
/* ------------------------------------------------------------------ */

export interface ManualModelOverrideRequest {
  projectId: string;
  requestId: string;
  requestedBy: string;
  provider: string;
  model?: string;
  reason?: string;
}

const MAX_TEXT = 200;
function optionalText(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v.length > MAX_TEXT) {
    throw new ValidationError(
      `routing request.${field} must be a string of at most ${MAX_TEXT} characters`,
    );
  }
  return requireText(v, `routing request.${field}`);
}

/** Untrusted input → a well-formed override REQUEST. Validating it is not authorizing it. */
export function validateManualModelOverride(
  input: unknown,
): ManualModelOverrideRequest {
  if (!input || typeof input !== "object") {
    throw new ValidationError(
      "manual model override request must be an object",
    );
  }
  const draft = input as Record<string, unknown>;
  return {
    projectId: requireExecutionId(draft.projectId, "projectId"),
    requestId: requireExecutionId(draft.requestId, "requestId"),
    requestedBy: requireText(draft.requestedBy, "requestedBy"),
    provider: requireText(draft.provider, "provider"),
    model: optionalText(draft.model, "model"),
    reason: optionalText(draft.reason, "reason"),
  };
}
