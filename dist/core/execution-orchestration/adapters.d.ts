/**
 * Adapters from the orchestration ports to EXISTING platform services:
 *   ModelRouterPort ← ModelRouter (EO-7, governance + budget aware)
 *   CostGate        ← BudgetEnforcer + UsageLedger (AI Cost Center)
 * Nothing is re-implemented; these only translate shapes.
 */
import type { ModelAssignment } from "../../contracts/execution-orchestration.js";
import type { BudgetEnforcer } from "../cost-center/budget-enforcer.js";
import type { UsageLedger } from "../cost-center/usage-ledger.js";
import type { ModelRouter } from "../routing/model-router.js";
import type { CostGate, ModelRouterPort } from "./ports.js";
export declare class ModelRouterAdapter implements ModelRouterPort {
    private readonly router;
    constructor(router: Pick<ModelRouter, "routeInternal">);
    select(input: Parameters<ModelRouterPort["select"]>[0]): Promise<ModelAssignment>;
}
export declare class CostGateAdapter implements CostGate {
    private readonly enforcer;
    private readonly usage?;
    private readonly clock;
    constructor(enforcer: Pick<BudgetEnforcer, "evaluateInternal">, usage?: Pick<UsageLedger, "totalsInternal"> | undefined, clock?: () => string);
    preflight(projectId: string, taskId: string): Promise<{
        allowed: boolean;
        status: "blocked" | "warning" | "ok" | "not_configured" | "unpriced";
        detail: string;
    }>;
    spent(projectId: string, taskId: string): Promise<number | undefined>;
}
