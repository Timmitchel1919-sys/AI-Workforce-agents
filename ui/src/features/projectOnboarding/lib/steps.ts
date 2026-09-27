import type { OnboardingMode, OnboardingSession, OnboardingStatus } from "../types";

export const GUIDED_STEPS = [
  "identity",
  "source",
  "analyze",
  "technology",
  "environments",
  "workforce",
  "permissions",
  "integrations",
  "secrets",
  "git",
  "pipeline",
  "deployment",
  "budget",
  "audit",
  "review",
] as const;
export type WizardStep = (typeof GUIDED_STEPS)[number] | "setup" | "progress";

/** Auto = minimal input, then one analyse/plan run and a consolidated review. */
export const AUTO_STEPS: readonly WizardStep[] = ["setup", "review"];

export function stepsFor(mode: OnboardingMode): readonly WizardStep[] {
  return mode === "auto" ? AUTO_STEPS : GUIDED_STEPS;
}

export const PLAN_STEPS: readonly WizardStep[] = [
  "technology",
  "environments",
  "workforce",
  "permissions",
  "integrations",
  "secrets",
  "git",
  "pipeline",
  "deployment",
  "budget",
  "audit",
];

export const PROGRESS_STATUSES: readonly OnboardingStatus[] = [
  "approved",
  "provisioning",
  "validating",
  "ready",
  "provisioning_failed",
  "validation_failed",
];

/** Statuses in which the draft (and therefore identity/source/overrides) may change. */
export const EDITABLE: readonly OnboardingStatus[] = [
  "draft",
  "source_configured",
  "analyzed",
  "analysis_failed",
  "review_required",
];

/** Onboarding sessions that are still in progress (not READY, not cancelled). */
export function isInProgress(status: OnboardingStatus): boolean {
  return status !== "ready" && status !== "cancelled";
}

/** The step a reloaded session resumes at, derived only from server state. */
export function initialStep(session: OnboardingSession): WizardStep {
  const { status, mode } = session;
  if (status === "provisioning" || status === "validating" || status === "ready" ||
      status === "provisioning_failed" || status === "validation_failed" || status === "approved") {
    return status === "approved" ? "review" : "progress";
  }
  if (status === "review_required") return "review";
  if (mode === "auto") return "setup";
  if (status === "draft") return "identity";
  if (status === "source_configured") return "analyze";
  return "analyze";
}

export function hasBlockers(session: OnboardingSession): boolean {
  return (session.plan?.blockers.length ?? 0) > 0;
}

/** Provision is only offered for an approved plan with zero blockers. */
export function canProvision(session: OnboardingSession): boolean {
  return session.status === "approved" && Boolean(session.plan) && !hasBlockers(session);
}

export function shortHash(hash: string | undefined): string {
  return hash ? hash.slice(0, 12) : "";
}
