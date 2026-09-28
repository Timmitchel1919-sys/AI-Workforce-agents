/**
 * EO-6.2 — decorator that gates a `ModelProvider` call on the project's
 * budget BEFORE the inner call is made, and records real usage (from the
 * response's own reported tokens) after a successful one.
 *
 * Compose it INSIDE `AuditedModelProvider` (`new AuditedModelProvider(new
 * BudgetGovernedModelProvider(inner, ...), audit)`) so a denial is still
 * captured as a `model_execution_failed` audit event, and this decorator
 * stays focused on budget + usage, not the audit trail.
 *
 * A request with no `projectId` in its metadata cannot be evaluated against
 * any project's budget and is refused — never silently ungoverned.
 */
import {
  ExecutionDeniedError,
  ValidationError,
  estimateCost,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from "../../contracts/index.js";
import type { AuditLog } from "../audit/audit-log.js";
import {
  extractCorrelation,
  extractIdempotencyKey,
} from "../providers/request-correlation.js";
import type { BudgetEnforcer } from "./budget-enforcer.js";
import type { UsageLedger } from "./usage-ledger.js";

export class BudgetGovernedModelProvider implements ModelProvider {
  readonly id: string;

  constructor(
    private readonly inner: ModelProvider,
    private readonly enforcer: BudgetEnforcer,
    private readonly ledger: UsageLedger,
    private readonly audit?: AuditLog,
  ) {
    this.id = inner.id;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const correlation = extractCorrelation(request);
    if (!correlation.projectId) {
      throw new ValidationError(
        "model request metadata.projectId is required for a budget-governed provider",
      );
    }
    const evaluation = await this.enforcer.evaluateInternal(
      correlation.projectId,
      correlation.taskId,
    );
    if (evaluation.status === "blocked") {
      this.audit?.record("budget_blocked", {
        ...correlation,
        data: {
          provider: this.inner.id,
          model: request.model ?? null,
          scope: evaluation.scope,
          detail: evaluation.detail,
        },
      });
      throw new ExecutionDeniedError("RESOURCE_LIMIT", evaluation.detail);
    }

    const response = await this.inner.generate(request);

    const cost = estimateCost(response.model, response.usage);
    const usage = await this.ledger.record({
      projectId: correlation.projectId,
      taskId: correlation.taskId,
      agentId: correlation.agentId,
      provider: this.inner.id,
      model: response.model,
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
      totalTokens: response.usage?.totalTokens,
      cost,
      idempotencyKey: extractIdempotencyKey(request),
    });
    this.audit?.record("usage_recorded", {
      ...correlation,
      data: {
        usageId: usage.usageId,
        provider: usage.provider,
        model: usage.model,
        cost: usage.cost,
      },
    });
    return response;
  }
}
