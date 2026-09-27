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
    /**
     * No principal: TRUSTED STATIC CONFIGURATION, set only by the composition
     * root at startup — mirrors `SourceControlOrchestrator.setRepositoryPolicy`
     * (EO-6.1), never a bypass of the admin-gated `set` above. There is no
     * request path to this method; it exists for a deployment to declare a
     * project's default policy (e.g. "this agent has no pre-call cost
     * estimate yet, so unknown cost is explicitly allowed here") the same way
     * repository/branch policy is declared, not asked for.
     */
    setTrusted(projectId: string, draft: unknown): Promise<GovernancePolicy>;
    private write;
    private authorize;
}
