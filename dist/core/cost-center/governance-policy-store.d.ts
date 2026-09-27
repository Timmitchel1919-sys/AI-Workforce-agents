/**
 * EO-6.3 — durable, project-scoped governance policy (provider/model
 * allow-list, an approval threshold, and whether unknown pre-execution cost
 * may proceed). Mirrors `BudgetPolicyStore` exactly: admin-gated write,
 * project-scoped read, durable via the same `DurableLedger` primitive.
 */
import { type ExecutionRecordStore, type GovernancePolicy, type OperatorPrincipal } from "../../contracts/index.js";
import type { AuditLog } from "../audit/audit-log.js";
export declare class GovernancePolicyStore {
    private readonly clock;
    private readonly audit?;
    private readonly ledger;
    constructor(store: ExecutionRecordStore | undefined, clock: () => string, audit?: AuditLog | undefined);
    get(principal: OperatorPrincipal, projectId: string): Promise<GovernancePolicy | undefined>;
    /** No principal: the trusted internal gate reads the policy it evaluates against directly. */
    getInternal(projectId: string): Promise<GovernancePolicy | undefined>;
    /** Admin-only. One policy per project; a later call replaces it. */
    set(principal: OperatorPrincipal, projectId: string, draft: unknown): Promise<GovernancePolicy>;
    private authorize;
}
