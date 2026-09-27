/**
 * EO-7 Model Router — read-only Control Plane client for routing-decision
 * history. Same-origin Control Plane only (never Firestore, never a model
 * provider directly). There is no write call here: there is no backend
 * command yet for a manual model override — see `docs/adr/0029-model-routing.md`.
 *
 * `configured: false` means this deployment has not composed the Model
 * Router at all — distinct from `configured: true` with an empty `decisions`
 * list, which means the Router exists but nothing has been routed yet. The
 * UI must keep these honestly separate; this client never collapses them.
 *
 * Types below are a hand-kept MIRROR of `contracts/routing.ts` — the UI
 * boundary never imports from `contracts/` directly (same rule as
 * `features/costCenter`).
 */
import { apiRequest } from "../../api/client";
import { ApiError } from "../../api/errors";

/* ------------------------------------------------------------------ */
/* Mirrored enums                                                      */
/* ------------------------------------------------------------------ */

export const MODEL_STATUSES = ["available", "unavailable", "degraded", "disabled", "unknown"] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];

export const ROUTING_PROFILES = ["balanced", "cost_efficient", "quality_first", "low_latency", "high_assurance"] as const;
export type RoutingProfile = (typeof ROUTING_PROFILES)[number];

export const MODEL_CAPABILITIES = ["reasoning", "coding", "vision", "structured_output", "large_context"] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

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
] as const;
export type CandidateRejectionReason = (typeof CANDIDATE_REJECTION_REASONS)[number];

/* ------------------------------------------------------------------ */
/* Mirrored shapes                                                     */
/* ------------------------------------------------------------------ */

export interface ModelRequirementProfile {
  requiredCapabilities: readonly ModelCapability[];
  preferredCapabilities?: readonly ModelCapability[];
  toolRequirements?: boolean;
  structuredOutput?: boolean;
  vision?: boolean;
  routingProfile?: RoutingProfile;
  providerRestrictions?: readonly string[];
  modelRestrictions?: readonly string[];
}

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

export type RoutingCostEstimate = { priced: true; amountUsd: number } | { priced: false; reason: string };

export interface RoutingPolicyDecision {
  decision: string;
  reasonCode?: string;
  detail: string;
}

export interface RoutingDecision {
  routingDecisionId: string;
  projectId: string;
  taskId?: string;
  executionSessionId?: string;
  agentId: string;
  requirements: ModelRequirementProfile;
  candidateModels: readonly RoutingCandidate[];
  rejectedCandidates: readonly RejectedCandidate[];
  /** Undefined together with `selectedModel` means NO candidate was selected — a real, honest outcome. */
  selectedProvider?: string;
  selectedModel?: string;
  /** Empty when a candidate was selected; non-empty explains a "no valid model" outcome. */
  reasonCodes: readonly CandidateRejectionReason[];
  costEstimate?: RoutingCostEstimate;
  policyDecision?: RoutingPolicyDecision;
  fallbackPolicy: "none" | "governed";
  /** Set only when this decision is itself a fallback of an earlier one. */
  fallbackOf?: string;
  fallbackUsed: boolean;
  createdAt: string;
  correlationId?: string;
}

export type ProjectRoutingDecisions =
  | { configured: false }
  | { configured: true; decisions: readonly RoutingDecision[] };

/** The single-decision endpoint has no `configured: false` response — a missing/unconfigured decision is a 404. */
export interface ProjectRoutingDecision {
  configured: true;
  decision: RoutingDecision;
}

/* ------------------------------------------------------------------ */
/* Fetch plumbing — same shape as costCenterClient/operationsClient   */
/* ------------------------------------------------------------------ */

export type ModelRoutingFailure = "unauthenticated" | "forbidden" | "not_found" | "conflict" | "invalid" | "unavailable";

export class ModelRoutingError extends Error {
  readonly failure: ModelRoutingFailure;
  constructor(failure: ModelRoutingFailure, message: string) {
    super(message);
    this.name = "ModelRoutingError";
    this.failure = failure;
  }
}

function toFailure(error: unknown): ModelRoutingError {
  if (error instanceof ApiError) {
    const failure: ModelRoutingFailure =
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
    return new ModelRoutingError(failure, error.message);
  }
  return new ModelRoutingError("unavailable", "Control Plane unreachable");
}

async function get<T>(path: string, token?: string | null): Promise<T> {
  try {
    return await apiRequest<T>(path, { method: "GET", accessToken: token });
  } catch (error) {
    throw toFailure(error);
  }
}

const project = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;

export const getProjectRoutingDecisions = (projectId: string, token?: string | null) =>
  get<ProjectRoutingDecisions>(`${project(projectId)}/routing-decisions`, token);

export const getProjectRoutingDecision = (projectId: string, decisionId: string, token?: string | null) =>
  get<ProjectRoutingDecision>(`${project(projectId)}/routing-decisions/${encodeURIComponent(decisionId)}`, token);
