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
/* Money — exact summation                                            */
/* ------------------------------------------------------------------ */
/**
 * Summing many small USD amounts (e.g. per-token fractional-cent charges) with
 * plain `+=` accumulates floating-point drift — ten $0.01 charges sum to
 * 0.09999999999999999 in IEEE-754, not $0.10. Kahan compensated summation
 * carries the rounding error forward and cancels it back in, so a reported
 * total is exact for any realistic number of usage events. Used wherever a
 * ledger aggregates cost — never for a single event, which keeps whatever
 * sub-cent precision the price table actually computed.
 */
export function sumUsd(amounts) {
    let sum = 0;
    let compensation = 0;
    for (const amount of amounts) {
        const y = amount - compensation;
        const t = sum + y;
        compensation = t - sum - y;
        sum = t;
    }
    return sum;
}
/**
 * Published list prices as of this table's version. Adding a model here is a
 * deliberate, reviewed change — never inferred, never guessed from a model
 * name pattern.
 */
export const PRICE_TABLE_VERSION = "2026-09-27";
export const MODEL_PRICES = Object.freeze({
    "claude-sonnet-5": { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
    "claude-opus-5-5": { inputPerMillionUsd: 15, outputPerMillionUsd: 75 },
    "claude-haiku-4-5-20251001": {
        inputPerMillionUsd: 0.8,
        outputPerMillionUsd: 4,
    },
});
/**
 * Cost from tokens actually reported by the provider's response — never from
 * an assumed token count. No price entry for the model => honestly unpriced,
 * never a guess.
 */
export function estimateCost(model, usage) {
    // MODEL_PRICES keys are lowercase by convention; a provider reporting a differently-cased but
    // identical model id (e.g. "GPT-4o" vs "gpt-4o") must still find its real price, not silently
    // come back "unpriced" (the same bug class fixed in the Model Router's own price lookup).
    const price = MODEL_PRICES[model.toLowerCase()];
    if (!price)
        return { priced: false, reason: `no price entry for model "${model}"` };
    if (!usage ||
        (usage.inputTokens === undefined && usage.outputTokens === undefined)) {
        return { priced: false, reason: "provider reported no token usage" };
    }
    const inputUsd = ((usage.inputTokens ?? 0) / 1_000_000) * price.inputPerMillionUsd;
    const outputUsd = ((usage.outputTokens ?? 0) / 1_000_000) * price.outputPerMillionUsd;
    return {
        priced: true,
        amountUsd: inputUsd + outputUsd,
        pricingVersion: PRICE_TABLE_VERSION,
    };
}
export function validateBudgetPolicyDraft(input) {
    if (!input || typeof input !== "object") {
        throw new ValidationError("budget policy must be an object");
    }
    const draft = input;
    for (const key of [
        "dailyLimitUsd",
        "monthlyLimitUsd",
        "taskLimitUsd",
    ]) {
        const v = draft[key];
        if (v !== undefined &&
            (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
            throw new ValidationError(`budget policy.${key} must be a non-negative number`);
        }
    }
    const warn = draft.warningThresholdPercent;
    if (typeof warn !== "number" ||
        !Number.isInteger(warn) ||
        warn < 1 ||
        warn > 100) {
        throw new ValidationError("budget policy.warningThresholdPercent must be an integer 1-100");
    }
    if (typeof draft.hardStop !== "boolean") {
        throw new ValidationError("budget policy.hardStop must be a boolean");
    }
    return {
        dailyLimitUsd: draft.dailyLimitUsd,
        monthlyLimitUsd: draft.monthlyLimitUsd,
        taskLimitUsd: draft.taskLimitUsd,
        warningThresholdPercent: warn,
        hardStop: draft.hardStop,
    };
}
/**
 * `not_configured` is distinct from `ok`: no policy is not the same as an
 * unlimited budget, it only means nothing has been asked to enforce a limit
 * yet. `unpriced` means real usage exists but its cost cannot be computed, so
 * the budget cannot be honestly evaluated against it — EXCEPT under a
 * hard-stop policy with a real limit configured, where unpriced usage
 * escalates to `blocked` instead (see `evaluateBudget`): a hard-stop's whole
 * purpose is to guarantee spend never passes the limit unverified, so
 * "cannot verify" must never be treated as "assumed fine".
 */
export const BUDGET_STATUSES = [
    "not_configured",
    "ok",
    "warning",
    "blocked",
    "unpriced",
];
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
export function evaluateBudget(policy, usedUsd, uncostedUsageCount) {
    if (!policy) {
        return {
            status: "not_configured",
            currency: "USD",
            detail: "no budget policy is configured for this project",
        };
    }
    const windows = [
        { scope: "task", limit: policy.taskLimitUsd, used: usedUsd.task },
        { scope: "daily", limit: policy.dailyLimitUsd, used: usedUsd.daily },
        { scope: "monthly", limit: policy.monthlyLimitUsd, used: usedUsd.monthly },
    ];
    const uncostedNote = uncostedUsageCount > 0
        ? ` (${uncostedUsageCount} usage event(s) in scope could not be priced)`
        : "";
    // Pass 1: any window actually at or over its limit — tightest (first in priority order) wins.
    let breached;
    for (const w of windows) {
        if (w.limit !== undefined && w.used >= w.limit) {
            breached = { scope: w.scope, limit: w.limit, used: w.used };
            break;
        }
    }
    if (breached) {
        const status = policy.hardStop ? "blocked" : "warning";
        const detail = `${breached.scope} spend $${breached.used.toFixed(2)} has reached the $${breached.limit.toFixed(2)} limit${policy.hardStop ? "" : " (not hard-stopped)"}${uncostedNote}`;
        return {
            status,
            scope: breached.scope,
            limitUsd: breached.limit,
            usedUsd: breached.used,
            currency: "USD",
            detail,
        };
    }
    // Pass 2: no full breach — the tightest window merely crossing the warning threshold, if any.
    for (const w of windows) {
        if (w.limit === undefined || w.limit <= 0)
            continue;
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
        // A hard-stop policy with a real dollar limit exists specifically to guarantee spend never
        // passes that limit unverified. Unpriced usage means the TRUE spend cannot be checked against
        // it — the priced total staying under the limit proves nothing about the unpriced portion, so
        // reporting "ok"/"unpriced" here would let real, unbounded spend continue past a policy whose
        // entire point is to stop it. Fails closed to `blocked`, never silently `allow`ed as a lesser
        // "advisory" state, whenever hardStop is actually configured with something to enforce.
        const hasLimit = policy.taskLimitUsd !== undefined ||
            policy.dailyLimitUsd !== undefined ||
            policy.monthlyLimitUsd !== undefined;
        if (policy.hardStop && hasLimit) {
            return {
                status: "blocked",
                currency: "USD",
                detail: `${uncostedUsageCount} usage event(s) could not be priced and this project's budget is hard-stopped — spend cannot be verified against the configured limit, so it is treated as blocked rather than assumed safe`,
            };
        }
        return {
            status: "unpriced",
            currency: "USD",
            detail: `${uncostedUsageCount} usage event(s) could not be priced; the budget cannot be fully evaluated`,
        };
    }
    return {
        status: "ok",
        currency: "USD",
        detail: "within all configured limits",
    };
}
export const COST_CENTER_CAPABILITY_IDS = ["enforcement"];
/** Capability ids that exist in this deployment but currently do nothing. INERT != IDLE. */
export function inertCostCenterCapabilities(caps) {
    const inert = [];
    if (!caps.enforcement)
        inert.push("enforcement");
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
];
export const AUDIT_SEVERITIES = ["info", "warning", "critical"];
