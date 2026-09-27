/**
 * EO-6.3 — durable, project-scoped governance policy (provider/model
 * allow-list, an approval threshold, and whether unknown pre-execution cost
 * may proceed). Mirrors `BudgetPolicyStore` exactly: admin-gated write,
 * project-scoped read, durable via the same `DurableLedger` primitive.
 */
import {
  ExecutionDeniedError,
  operatorCan,
  operatorCanAccessProject,
  requireExecutionId,
  validateGovernancePolicyDraft,
  type ExecutionRecordStore,
  type GovernancePolicy,
  type OperatorPrincipal,
} from "../../contracts/index.js";
import type { AuditLog } from "../audit/audit-log.js";
import { DurableLedger } from "../release/durable-ledger.js";

const KIND = "governance_policy";

export class GovernancePolicyStore {
  private readonly ledger: DurableLedger;

  constructor(
    store: ExecutionRecordStore | undefined,
    private readonly clock: () => string,
    private readonly audit?: AuditLog,
  ) {
    this.ledger = new DurableLedger(store, clock);
  }

  async get(principal: OperatorPrincipal, projectId: string): Promise<GovernancePolicy | undefined> {
    const id = requireExecutionId(projectId, "projectId");
    this.authorize(principal, id, "view");
    return this.getInternal(id);
  }

  /** No principal: the trusted internal gate reads the policy it evaluates against directly. */
  async getInternal(projectId: string): Promise<GovernancePolicy | undefined> {
    return this.ledger.find<GovernancePolicy>(KIND, requireExecutionId(projectId, "projectId"));
  }

  /** Admin-only. One policy per project; a later call replaces it. */
  async set(principal: OperatorPrincipal, projectId: string, draft: unknown): Promise<GovernancePolicy> {
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
  async setTrusted(projectId: string, draft: unknown): Promise<GovernancePolicy> {
    return this.write(requireExecutionId(projectId, "projectId"), draft, "system:composition-root");
  }

  private async write(id: string, draft: unknown, updatedBy: string): Promise<GovernancePolicy> {
    const validated = validateGovernancePolicyDraft(draft);
    const policy: GovernancePolicy = { projectId: id, ...validated, updatedAt: this.clock(), updatedBy };
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

  private authorize(principal: OperatorPrincipal, projectId: string, capability: "view" | "manage_governance_policy"): void {
    if (!operatorCan(principal, capability) || !operatorCanAccessProject(principal, projectId)) {
      throw new ExecutionDeniedError("AUTHORIZATION_DENIED", `not authorized to ${capability} for this project`);
    }
  }
}
