/**
 * EO-6.2 — combines a project's budget policy with its recorded usage into
 * one evaluation. Pure orchestration: all the judgement is the pure
 * `evaluateBudget` function in contracts/cost-center.ts; this class only
 * gathers the (already-authorized) inputs it needs.
 */
import { type BudgetEvaluation, type OperatorPrincipal } from "../../contracts/index.js";
import type { BudgetPolicyStore } from "./budget-policy-store.js";
import type { UsageLedger } from "./usage-ledger.js";
export declare class BudgetEnforcer {
    private readonly policies;
    private readonly usage;
    private readonly clock;
    constructor(policies: BudgetPolicyStore, usage: UsageLedger, clock: () => string);
    /** Read-only evaluation for reporting; never throws for a normal (even blocked) result. */
    evaluate(principal: OperatorPrincipal, projectId: string, taskId?: string): Promise<BudgetEvaluation>;
    /**
     * No principal: the internal preflight gate a model call runs through
     * before it is made, not an operator viewing a project.
     */
    evaluateInternal(projectId: string, taskId?: string): Promise<BudgetEvaluation>;
    private evaluateWith;
}
