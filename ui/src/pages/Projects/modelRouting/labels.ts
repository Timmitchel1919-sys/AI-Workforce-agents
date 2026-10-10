import type { MessageKey } from "../../../i18n";
import type { CandidateRejectionReason, ModelCapability, ModelStatus, RoutingProfile } from "../../../features/modelRouting";

const REASON: Record<CandidateRejectionReason, MessageKey> = {
  CAPABILITY_MISMATCH: "modelRouting.reasonCapabilityMismatch",
  MODEL_UNAVAILABLE: "modelRouting.reasonModelUnavailable",
  PROVIDER_UNAVAILABLE: "modelRouting.reasonProviderUnavailable",
  PROJECT_POLICY_DENIED: "modelRouting.reasonProjectPolicyDenied",
  BUDGET_EXCEEDED: "modelRouting.reasonBudgetExceeded",
  SECURITY_POLICY_DENIED: "modelRouting.reasonSecurityPolicyDenied",
  TOOL_SUPPORT_REQUIRED: "modelRouting.reasonToolSupportRequired",
  CONTEXT_REQUIREMENT_NOT_MET: "modelRouting.reasonContextRequirementNotMet",
  ENVIRONMENT_INCOMPATIBLE: "modelRouting.reasonEnvironmentIncompatible",
  MODEL_DISABLED: "modelRouting.reasonModelDisabled",
};

const STATUS: Record<ModelStatus, MessageKey> = {
  available: "modelRouting.statusAvailable",
  unavailable: "modelRouting.statusUnavailable",
  degraded: "modelRouting.statusDegraded",
  disabled: "modelRouting.statusDisabled",
  unknown: "modelRouting.statusUnknown",
};

const STATUS_TONE: Record<ModelStatus, "ok" | "warn" | "bad" | "neutral"> = {
  available: "ok",
  unavailable: "bad",
  degraded: "warn",
  disabled: "bad",
  unknown: "neutral",
};

const PROFILE: Record<RoutingProfile, MessageKey> = {
  balanced: "modelRouting.profileBalanced",
  cost_efficient: "modelRouting.profileCostEfficient",
  quality_first: "modelRouting.profileQualityFirst",
  low_latency: "modelRouting.profileLowLatency",
  high_assurance: "modelRouting.profileHighAssurance",
};

const CAPABILITY: Record<ModelCapability, MessageKey> = {
  reasoning: "modelRouting.capabilityReasoning",
  coding: "modelRouting.capabilityCoding",
  vision: "modelRouting.capabilityVision",
  structured_output: "modelRouting.capabilityStructuredOutput",
  large_context: "modelRouting.capabilityLargeContext",
};

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export const rejectionReasonLabel = (t: Translate, reason: CandidateRejectionReason) => t(REASON[reason]);
export const modelStatusLabel = (t: Translate, status: ModelStatus) => t(STATUS[status]);
export const modelStatusTone = (status: ModelStatus) => STATUS_TONE[status];
export const routingProfileLabel = (t: Translate, profile: RoutingProfile) => t(PROFILE[profile]);
export const capabilityLabel = (t: Translate, capability: ModelCapability) => (CAPABILITY[capability] ? t(CAPABILITY[capability]) : capability);
export const capabilityListLabel = (t: Translate, capabilities: readonly ModelCapability[]) =>
  capabilities.length ? capabilities.map((c) => capabilityLabel(t, c)).join(", ") : t("modelRouting.notSpecified");

/**
 * USD formatter that never rounds a real, non-zero priced amount down to
 * "$0.00" — matches the Cost Center formatter's behaviour for the same
 * reason (fractional-cent per-token charges are common here).
 */
export function formatUsd(amountUsd: number): string {
  if (amountUsd === 0) return "$0.00";
  if (Math.abs(amountUsd) < 0.01) return `$${amountUsd.toFixed(4)}`;
  return `$${amountUsd.toFixed(2)}`;
}

export const shortId = (id: string, n = 10) => (id.length > n ? `${id.slice(0, n)}…` : id);
