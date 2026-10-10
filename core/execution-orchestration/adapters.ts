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

export class ModelRouterAdapter implements ModelRouterPort {
  constructor(private readonly router: Pick<ModelRouter, "routeInternal">) {}

  async select(
    input: Parameters<ModelRouterPort["select"]>[0],
  ): Promise<ModelAssignment> {
    try {
      const decision = await this.router.routeInternal({
        projectId: input.projectId,
        agentId: input.agent.id,
        agent: input.agent,
        requestId: input.taskId,
        taskId: input.taskId,
        requirement: {
          requiredCapabilities: input.need.requiredCapabilities,
          routingProfile: input.need.routingProfile,
          structuredOutput: input.need.structuredOutput,
        },
      });
      if (decision.selectedProvider) {
        return {
          provider: decision.selectedProvider,
          ...(decision.selectedModel ? { model: decision.selectedModel } : {}),
          reason: input.need.rationale,
          routingDecisionId: decision.routingDecisionId,
        };
      }
      return {
        reason: `no eligible model (${decision.reasonCodes.join(", ") || "none declared"})`,
        routingDecisionId: decision.routingDecisionId,
      };
    } catch {
      return { reason: "the model router could not select a model" };
    }
  }
}

export class CostGateAdapter implements CostGate {
  constructor(
    private readonly enforcer: Pick<BudgetEnforcer, "evaluateInternal">,
    private readonly usage?: Pick<UsageLedger, "totalsInternal">,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async preflight(projectId: string, taskId: string) {
    const evaluation = await this.enforcer.evaluateInternal(projectId, taskId);
    return {
      allowed: evaluation.status !== "blocked",
      status: evaluation.status,
      detail: evaluation.detail,
    };
  }

  async spent(projectId: string, taskId: string): Promise<number | undefined> {
    if (!this.usage) return undefined;
    const now = Date.parse(this.clock());
    const totals = await this.usage.totalsInternal(projectId, {
      dailySinceIso: new Date(now - 86_400_000).toISOString(),
      monthlySinceIso: new Date(now - 31 * 86_400_000).toISOString(),
      taskId,
    });
    return totals.task;
  }
}
