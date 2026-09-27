/**
 * EO-6.3 — durable, project-scoped governance policy (provider/model
 * allow-list, an approval threshold, and whether unknown pre-execution cost
 * may proceed). Mirrors `BudgetPolicyStore` exactly: admin-gated write,
 * project-scoped read, durable via the same `DurableLedger` primitive.
 */
import { ExecutionDeniedError, operatorCan, operatorCanAccessProject, requireExecutionId, validateGovernancePolicyDraft, } from "../../contracts/index.js";
import { DurableLedger } from "../release/durable-ledger.js";
const KIND = "governance_policy";
export class GovernancePolicyStore {
    clock;
    audit;
    ledger;
    constructor(store, clock, audit) {
        this.clock = clock;
        this.audit = audit;
        this.ledger = new DurableLedger(store, clock);
    }
    async get(principal, projectId) {
        const id = requireExecutionId(projectId, "projectId");
        this.authorize(principal, id, "view");
        return this.getInternal(id);
    }
    /** No principal: the trusted internal gate reads the policy it evaluates against directly. */
    async getInternal(projectId) {
        return this.ledger.find(KIND, requireExecutionId(projectId, "projectId"));
    }
    /** Admin-only. One policy per project; a later call replaces it. */
    async set(principal, projectId, draft) {
        const id = requireExecutionId(projectId, "projectId");
        this.authorize(principal, id, "manage_governance_policy");
        return this.write(id, draft, principal.id);
    }
    /**
     * No principal: TRUSTED STATIC CONFIGURATION, set only by the composition
     * root at startup — mirrors `SourceControlOrchestrator.setRepositoryPolicy`
     * (EO-6.1), never a bypass of the admin-gated `set` above. There is no
     * request path to this method; it exists for a deployment to declare a
     * project's default policy (e.g. "this agent has no pre-call cost
     * estimate yet, so unknown cost is explicitly allowed here") the same way
     * repository/branch policy is declared, not asked for.
     */
    async setTrusted(projectId, draft) {
        return this.write(requireExecutionId(projectId, "projectId"), draft, "system:composition-root");
    }
    async write(id, draft, updatedBy) {
        const validated = validateGovernancePolicyDraft(draft);
        const policy = { projectId: id, ...validated, updatedAt: this.clock(), updatedBy };
        const saved = await this.ledger.save(KIND, id, id, policy.updatedAt, policy, "put");
        this.audit?.record("governance_policy_set", {
            projectId: id,
            data: {
                allowedProviders: saved.allowedProviders,
                allowedModels: saved.allowedModels,
                requireApprovalAboveUsd: saved.requireApprovalAboveUsd,
                allowUnknownCost: saved.allowUnknownCost,
                updatedBy: saved.updatedBy,
            },
        });
        return saved;
    }
    authorize(principal, projectId, capability) {
        if (!operatorCan(principal, capability) || !operatorCanAccessProject(principal, projectId)) {
            throw new ExecutionDeniedError("AUTHORIZATION_DENIED", `not authorized to ${capability} for this project`);
        }
    }
}
