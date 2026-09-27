/**
 * EO-6.2 — durable, project-scoped budget policy.
 *
 * A trusted, admin-set limit distinct from onboarding's `CostPolicy` (a
 * planning document). Setting one here is what actually wires enforcement
 * for a project; recording onboarding's policy alone still enforces nothing.
 */
import { type BudgetPolicy, type ExecutionRecordStore, type OperatorPrincipal } from "../../contracts/index.js";
import type { AuditLog } from "../audit/audit-log.js";
export declare class BudgetPolicyStore {
    private readonly clock;
    private readonly audit?;
    private readonly ledger;
    constructor(store: ExecutionRecordStore | undefined, clock: () => string, audit?: AuditLog | undefined);
    get(principal: OperatorPrincipal, projectId: string): Promise<BudgetPolicy | undefined>;
    /**
     * No principal: the trusted internal gate a model call runs through before
     * it is made is not an operator viewing a project, so it never needs (or
     * fabricates) an operator identity to read the policy it enforces.
     */
    getInternal(projectId: string): Promise<BudgetPolicy | undefined>;
    /** Admin-only. One policy per project; a later call replaces it (not create-only — it is a setting, not evidence). */
    set(principal: OperatorPrincipal, projectId: string, draft: unknown): Promise<BudgetPolicy>;
    private authorize;
}
