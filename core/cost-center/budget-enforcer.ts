/**
 * EO-6.2 — combines a project's budget policy with its recorded usage into
 * one evaluation. Pure orchestration: all the judgement is the pure
 * `evaluateBudget` function in contracts/cost-center.ts; this class only
 * gathers the (already-authorized) inputs it needs.
 */
import {
  evaluateBudget,
  requireExecutionId,
  type BudgetEvaluation,
  type OperatorPrincipal,
} from "../../contracts/index.js";
import type { BudgetPolicyStore } from "./budget-policy-store.js";
import type { UsageLedger } from "./usage-ledger.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export class BudgetEnforcer {
  constructor(
    private readonly policies: BudgetPolicyStore,
    private readonly usage: UsageLedger,
    private readonly clock: () => string,
  ) {}

  /** Read-only evaluation for reporting; never throws for a normal (even blocked) result. */
  async evaluate(
    principal: OperatorPrincipal,
    projectId: string,
    taskId?: string,
  ): Promise<BudgetEvaluation> {
    const id = requireExecutionId(projectId, "projectId");
    const policy = await this.policies.get(principal, id);
    return this.evaluateWith(policy, taskId, (windows) =>
      this.usage.totals(principal, id, windows),
    );
  }

  /**
   * No principal: the internal preflight gate a model call runs through
   * before it is made, not an operator viewing a project.
   */
  async evaluateInternal(
    projectId: string,
    taskId?: string,
  ): Promise<BudgetEvaluation> {
    const id = requireExecutionId(projectId, "projectId");
    const policy = await this.policies.getInternal(id);
    return this.evaluateWith(policy, taskId, (windows) =>
      this.usage.totalsInternal(id, windows),
    );
  }

  private async evaluateWith(
    policy: Awaited<ReturnType<BudgetPolicyStore["getInternal"]>>,
    taskId: string | undefined,
    totalsOf: (windows: {
      dailySinceIso: string;
      monthlySinceIso: string;
      taskId?: string;
    }) => Promise<{
      daily: number;
      monthly: number;
      task: number;
      uncosted: number;
    }>,
  ): Promise<BudgetEvaluation> {
    if (!policy)
      return evaluateBudget(undefined, { daily: 0, monthly: 0, task: 0 }, 0);
    const nowMs = Date.parse(this.clock());
    const dailySinceIso = new Date(nowMs - DAY_MS).toISOString();
    const monthlySinceIso = new Date(nowMs - 30 * DAY_MS).toISOString();
    const totals = await totalsOf({ dailySinceIso, monthlySinceIso, taskId });
    return evaluateBudget(
      policy,
      { daily: totals.daily, monthly: totals.monthly, task: totals.task },
      totals.uncosted,
    );
  }
}
