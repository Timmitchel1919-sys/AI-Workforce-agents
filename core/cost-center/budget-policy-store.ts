/**
 * EO-6.2 — durable, project-scoped budget policy.
 *
 * A trusted, admin-set limit distinct from onboarding's `CostPolicy` (a
 * planning document). Setting one here is what actually wires enforcement
 * for a project; recording onboarding's policy alone still enforces nothing.
 */
import {
  ExecutionDeniedError,
  operatorCan,
  operatorCanAccessProject,
  requireExecutionId,
  validateBudgetPolicyDraft,
  type BudgetPolicy,
  type ExecutionRecordStore,
  type OperatorPrincipal,
} from "../../contracts/index.js";
import type { AuditLog } from "../audit/audit-log.js";
import { DurableLedger } from "../release/durable-ledger.js";

const KIND = "budget_policy";

export class BudgetPolicyStore {
  private readonly ledger: DurableLedger;

  constructor(
    store: ExecutionRecordStore | undefined,
    private readonly clock: () => string,
    private readonly audit?: AuditLog,
  ) {
    this.ledger = new DurableLedger(store, clock);
  }

  async get(
    principal: OperatorPrincipal,
    projectId: string,
  ): Promise<BudgetPolicy | undefined> {
    const id = requireExecutionId(projectId, "projectId");
    this.authorize(principal, id, "view");
    return this.getInternal(id);
  }

  /**
   * No principal: the trusted internal gate a model call runs through before
   * it is made is not an operator viewing a project, so it never needs (or
   * fabricates) an operator identity to read the policy it enforces.
   */
  async getInternal(projectId: string): Promise<BudgetPolicy | undefined> {
    return this.ledger.find<BudgetPolicy>(
      KIND,
      requireExecutionId(projectId, "projectId"),
    );
  }

  /** Admin-only. One policy per project; a later call replaces it (not create-only — it is a setting, not evidence). */
  async set(
    principal: OperatorPrincipal,
    projectId: string,
    draft: unknown,
  ): Promise<BudgetPolicy> {
    const id = requireExecutionId(projectId, "projectId");
    this.authorize(principal, id, "manage_budget_policy");
    const validated = validateBudgetPolicyDraft(draft);
    const policy: BudgetPolicy = {
      projectId: id,
      ...validated,
      updatedAt: this.clock(),
      updatedBy: principal.id,
    };
    const saved = await this.ledger.save(
      KIND,
      id,
      id,
      policy.updatedAt,
      policy,
      "put",
    );
    this.audit?.record("budget_policy_set", {
      projectId: id,
      data: {
        dailyLimitUsd: saved.dailyLimitUsd,
        monthlyLimitUsd: saved.monthlyLimitUsd,
        taskLimitUsd: saved.taskLimitUsd,
        hardStop: saved.hardStop,
        updatedBy: saved.updatedBy,
      },
    });
    return saved;
  }

  private authorize(
    principal: OperatorPrincipal,
    projectId: string,
    capability: "view" | "manage_budget_policy",
  ): void {
    if (
      !operatorCan(principal, capability) ||
      !operatorCanAccessProject(principal, projectId)
    ) {
      throw new ExecutionDeniedError(
        "AUTHORIZATION_DENIED",
        `not authorized to ${capability} for this project`,
      );
    }
  }
}
