/**
 * Summing many small USD amounts (e.g. per-token fractional-cent charges) with
 * plain `+=` accumulates floating-point drift — ten $0.01 charges sum to
 * 0.09999999999999999 in IEEE-754, not $0.10. Kahan compensated summation
 * carries the rounding error forward and cancels it back in, so a reported
 * total is exact for any realistic number of usage events. Used wherever a
 * ledger aggregates cost — never for a single event, which keeps whatever
 * sub-cent precision the price table actually computed.
 */
export declare function sumUsd(amounts: readonly number[]): number;
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
export declare const PRICE_TABLE_VERSION = "2026-09-27";
export declare const MODEL_PRICES: Readonly<Record<string, ModelPrice>>;
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
export declare function estimateCost(model: string, usage: {
    inputTokens?: number;
    outputTokens?: number;
} | undefined): PriceEstimate | UnpricedEstimate;
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
    /** ALWAYS the actual cost, computed from a real response's own reported tokens — never an estimate. */
    cost: PriceEstimate | UnpricedEstimate;
    /**
     * When the caller supplied one, dedupes a retried request onto the SAME record instead of
     * double-recording it: a second `record()` with the same key returns the first record unchanged.
     * Absent when the caller gave none — no idempotency key means no dedupe is possible, which is
     * reported honestly (see `UsageLedger.record`) rather than silently assumed safe.
     */
    idempotencyKey?: string;
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
    idempotencyKey?: string;
}
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
export declare function validateBudgetPolicyDraft(input: unknown): Omit<BudgetPolicy, "projectId" | "updatedAt" | "updatedBy">;
/**
 * `not_configured` is distinct from `ok`: no policy is not the same as an
 * unlimited budget, it only means nothing has been asked to enforce a limit
 * yet. `unpriced` means real usage exists but its cost cannot be computed, so
 * the budget cannot be honestly evaluated against it.
 */
export declare const BUDGET_STATUSES: readonly ["not_configured", "ok", "warning", "blocked", "unpriced"];
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
export declare function evaluateBudget(policy: BudgetPolicy | undefined, usedUsd: {
    daily: number;
    monthly: number;
    task: number;
}, uncostedUsageCount: number): BudgetEvaluation;
export interface CostCenterCapabilities {
    /** True only when at least one real model provider is registered; otherwise no call can ever be governed. */
    enforcement: boolean;
    /** Registered model-provider ids (sorted), for honest reporting — never assumed. */
    readonly providerIds: readonly string[];
}
export declare const COST_CENTER_CAPABILITY_IDS: readonly ["enforcement"];
export type CostCenterCapabilityId = (typeof COST_CENTER_CAPABILITY_IDS)[number];
/** Capability ids that exist in this deployment but currently do nothing. INERT != IDLE. */
export declare function inertCostCenterCapabilities(caps: CostCenterCapabilities): CostCenterCapabilityId[];
export declare const AUDIT_RULE_IDS: readonly ["release_without_verification", "release_without_approval", "high_risk_session_unapproved", "usage_unpriced"];
export type AuditRuleId = (typeof AUDIT_RULE_IDS)[number];
export declare const AUDIT_SEVERITIES: readonly ["info", "warning", "critical"];
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
