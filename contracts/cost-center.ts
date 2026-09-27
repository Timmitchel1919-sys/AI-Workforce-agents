/**
 * EO-6.2 — AI Cost Center & rule-based Auditor governance foundation.
 *
 *   RECORDED != ENFORCED · PRICED != ESTIMATED != FABRICATED ·
 *   CONNECTED != CAPABLE · RULE-BASED != MODEL-ASSISTED
 *
 * Onboarding already lets an operator record a per-project budget
 * (`CostPolicy` in ./onboarding.js), and says so honestly: "Budget policies
 * are recorded but not enforced: no AI Cost Center is wired." This module is
 * that Cost Center — a project-scoped usage ledger, an explicit (never
 * fabricated) price table, and a budget gate a model-provider decorator can
 * consult before a call is made. It does NOT automatically adopt onboarding's
 * recorded policy; a project's enforced `BudgetPolicy` here is set through
 * its own governed, admin-only write, so onboarding's gap note stays true
 * until a later layer explicitly bridges the two.
 *
 * The Auditor here is RULE-BASED: a fixed table of deterministic checks over
 * already-authorised project records (verifications, releases, sessions,
 * usage). No model call is ever made to produce a finding. A future
 * model-assisted auditor is a distinct, clearly-labelled capability this
 * module does not claim.
 */
import { ValidationError } from "./index.js";

/* ------------------------------------------------------------------ */
/* Price table — explicit, versioned, never fabricated                */
/* ------------------------------------------------------------------ */

export interface ModelPrice {
  /** USD per 1,000,000 input tokens. */
  inputPerMillionUsd: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillionUsd: number;
}

/**
 * Published list prices as of this table's version. Adding a model here is a
 * deliberate, reviewed change — never inferred, never guessed from a model
 * name pattern.
 */
export const PRICE_TABLE_VERSION = "2026-09-27";
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  "claude-sonnet-5": { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  "claude-opus-5-5": { inputPerMillionUsd: 15, outputPerMillionUsd: 75 },
  "claude-haiku-4-5-20251001": { inputPerMillionUsd: 0.8, outputPerMillionUsd: 4 },
});

export interface PriceEstimate {
  priced: true;
  amountUsd: number;
  pricingVersion: string;
}
export interface UnpricedEstimate {
  priced: false;
  reason: string;
}

/**
 * Cost from tokens actually reported by the provider's response — never from
 * an assumed token count. No price entry for the model => honestly unpriced,
 * never a guess.
 */
export function estimateCost(
  model: string,
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
): PriceEstimate | UnpricedEstimate {
  const price = MODEL_PRICES[model];
  if (!price) return { priced: false, reason: `no price entry for model "${model}"` };
  if (!usage || (usage.inputTokens === undefined && usage.outputTokens === undefined)) {
    return { priced: false, reason: "provider reported no token usage" };
  }
  const inputUsd = ((usage.inputTokens ?? 0) / 1_000_000) * price.inputPerMillionUsd;
  const outputUsd = ((usage.outputTokens ?? 0) / 1_000_000) * price.outputPerMillionUsd;
  return { priced: true, amountUsd: inputUsd + outputUsd, pricingVersion: PRICE_TABLE_VERSION };
}

/* ------------------------------------------------------------------ */
/* Usage records                                                      */
/* ------------------------------------------------------------------ */

export interface UsageRecord {
  usageId: string;
  projectId: string;
  taskId?: string;
  agentId?: string;
  sessionId?: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cost: PriceEstimate | UnpricedEstimate;
  createdAt: string;
}

/** What the governed provider decorator supplies; the ledger assigns the id/time. */
export interface UsageDraft {
  projectId: string;
  taskId?: string;
  agentId?: string;
  sessionId?: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cost: PriceEstimate | UnpricedEstimate;
}

/* ------------------------------------------------------------------ */
/* Budget policy & evaluation                                         */
/* ------------------------------------------------------------------ */

export interface BudgetPolicy {
  projectId: string;
  dailyLimitUsd?: number;
  monthlyLimitUsd?: number;
  taskLimitUsd?: number;
  /** Percent of whichever limit is closest, 1–100. */
  warningThresholdPercent: number;
  /** A limit crossed with hardStop=false is reported as a warning, never blocked. */
  hardStop: boolean;
  updatedAt: string;
  updatedBy: string;
}

export function validateBudgetPolicyDraft(input: unknown): Omit<BudgetPolicy, "projectId" | "updatedAt" | "updatedBy"> {
  if (!input || typeof input !== "object") {
    throw new ValidationError("budget policy must be an object");
  }
  const draft = input as Record<string, unknown>;
  for (const key of ["dailyLimitUsd", "monthlyLimitUsd", "taskLimitUsd"] as const) {
    const v = draft[key];
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
      throw new ValidationError(`budget policy.${key} must be a non-negative number`);
    }
  }
  const warn = draft.warningThresholdPercent;
  if (typeof warn !== "number" || !Number.isInteger(warn) || warn < 1 || warn > 100) {
    throw new ValidationError("budget policy.warningThresholdPercent must be an integer 1-100");
  }
  if (typeof draft.hardStop !== "boolean") {
    throw new ValidationError("budget policy.hardStop must be a boolean");
  }
  return {
    dailyLimitUsd: draft.dailyLimitUsd as number | undefined,
    monthlyLimitUsd: draft.monthlyLimitUsd as number | undefined,
    taskLimitUsd: draft.taskLimitUsd as number | undefined,
    warningThresholdPercent: warn,
    hardStop: draft.hardStop,
  };
}

/**
 * `not_configured` is distinct from `ok`: no policy is not the same as an
 * unlimited budget, it only means nothing has been asked to enforce a limit
 * yet. `unpriced` means real usage exists but its cost cannot be computed, so
 * the budget cannot be honestly evaluated against it.
 */
export const BUDGET_STATUSES = ["not_configured", "ok", "warning", "blocked", "unpriced"] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export interface BudgetEvaluation {
  status: BudgetStatus;
  /** Which window (if any) drove the status. */
  scope?: "daily" | "monthly" | "task";
  limitUsd?: number;
  usedUsd?: number;
  currency: "USD";
  detail: string;
}

/**
 * Pure: no I/O, no clock read (the caller supplies already-windowed totals).
 *
 * Fails closed toward the TIGHTEST applicable limit. `hardStop` is one flag
 * for the whole policy (not per-window), so at most one severity is ever in
 * play at a time: any window actually AT or OVER its limit is either
 * `blocked` (hardStop) or `warning` (not hard-stopped) — the specific window
 * reported is the first one breached in priority order (task, then daily,
 * then monthly), never the last one scanned. Only when NO window is fully
 * breached does a window merely crossing the warning threshold get reported.
 * Uncosted usage in scope is noted in `detail` regardless of the status that
 * wins — it is never silently dropped just because something else was also
 * wrong.
 */
export function evaluateBudget(
  policy: BudgetPolicy | undefined,
  usedUsd: { daily: number; monthly: number; task: number },
  uncostedUsageCount: number,
): BudgetEvaluation {
  if (!policy) {
    return { status: "not_configured", currency: "USD", detail: "no budget policy is configured for this project" };
  }
  const windows: readonly { scope: "daily" | "monthly" | "task"; limit?: number; used: number }[] = [
    { scope: "task", limit: policy.taskLimitUsd, used: usedUsd.task },
    { scope: "daily", limit: policy.dailyLimitUsd, used: usedUsd.daily },
    { scope: "monthly", limit: policy.monthlyLimitUsd, used: usedUsd.monthly },
  ];
  const uncostedNote = uncostedUsageCount > 0 ? ` (${uncostedUsageCount} usage event(s) in scope could not be priced)` : "";

  // Pass 1: any window actually at or over its limit — tightest (first in priority order) wins.
  let breached: { scope: "daily" | "monthly" | "task"; limit: number; used: number } | undefined;
  for (const w of windows) {
    if (w.limit !== undefined && w.used >= w.limit) {
      breached = { scope: w.scope, limit: w.limit, used: w.used };
      break;
    }
  }
  if (breached) {
    const status: BudgetStatus = policy.hardStop ? "blocked" : "warning";
    const detail = `${breached.scope} spend $${breached.used.toFixed(2)} has reached the $${breached.limit.toFixed(2)} limit${policy.hardStop ? "" : " (not hard-stopped)"}${uncostedNote}`;
    return { status, scope: breached.scope, limitUsd: breached.limit, usedUsd: breached.used, currency: "USD", detail };
  }

  // Pass 2: no full breach — the tightest window merely crossing the warning threshold, if any.
  for (const w of windows) {
    if (w.limit === undefined || w.limit <= 0) continue;
    const ratioPercent = (w.used / w.limit) * 100;
    if (ratioPercent >= policy.warningThresholdPercent) {
      return {
        status: "warning",
        scope: w.scope,
        limitUsd: w.limit,
        usedUsd: w.used,
        currency: "USD",
        detail: `${w.scope} spend $${w.used.toFixed(2)} has reached ${ratioPercent.toFixed(0)}% of the $${w.limit.toFixed(2)} limit${uncostedNote}`,
      };
    }
  }

  if (uncostedUsageCount > 0) {
    return {
      status: "unpriced",
      currency: "USD",
      detail: `${uncostedUsageCount} usage event(s) could not be priced; the budget cannot be fully evaluated`,
    };
  }
  return { status: "ok", currency: "USD", detail: "within all configured limits" };
}

/* ------------------------------------------------------------------ */
/* Capabilities — connected vs capable, same shape as ReleaseCapabilities */
/* ------------------------------------------------------------------ */

export interface CostCenterCapabilities {
  /** True only when at least one real model provider is registered; otherwise no call can ever be governed. */
  enforcement: boolean;
  /** Registered model-provider ids (sorted), for honest reporting — never assumed. */
  readonly providerIds: readonly string[];
}

export const COST_CENTER_CAPABILITY_IDS = ["enforcement"] as const;
export type CostCenterCapabilityId = (typeof COST_CENTER_CAPABILITY_IDS)[number];

/** Capability ids that exist in this deployment but currently do nothing. INERT != IDLE. */
export function inertCostCenterCapabilities(caps: CostCenterCapabilities): CostCenterCapabilityId[] {
  const inert: CostCenterCapabilityId[] = [];
  if (!caps.enforcement) inert.push("enforcement");
  return inert;
}

/* ------------------------------------------------------------------ */
/* Rule-based Auditor findings                                        */
/* ------------------------------------------------------------------ */

export const AUDIT_RULE_IDS = [
  "release_without_verification",
  "release_without_approval",
  "high_risk_session_unapproved",
  "usage_unpriced",
] as const;
export type AuditRuleId = (typeof AUDIT_RULE_IDS)[number];

export const AUDIT_SEVERITIES = ["info", "warning", "critical"] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export interface AuditFinding {
  findingId: string;
  projectId: string;
  ruleId: AuditRuleId;
  severity: AuditSeverity;
  subjectType: "release" | "session" | "usage";
  subjectId: string;
  detail: string;
  createdAt: string;
}

/**
 * One project's audit run, recomputed fresh from already-authorized inputs
 * on every read — never stored separately, so a fixed problem's finding
 * cannot linger as stale evidence the way a persisted-and-forgotten record
 * would.
 */
export interface AuditRunResult {
  projectId: string;
  generatedAt: string;
  rulesRun: readonly AuditRuleId[];
  findings: readonly AuditFinding[];
}
