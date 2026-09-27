/**
 * EO-8 — `RoutedModelProvider`: a `ModelProvider` DECORATOR that routes and
 * meters every call, reusable across every `GeneralAgent`-based agent
 * (Developer/QA/Project Manager today; Research once a real, non-fabricated
 * search/fetch provider exists to make it honest — see ADR-0030).
 *
 * This generalizes the bespoke routing/usage wiring EO-7 hand-rolled inside
 * `OpenAIAgentExecutor.run()` (which uses the richer `StructuredModelProvider`
 * interface, not this plain one) into something composable: wrap ANY real
 * `ModelProvider` once per agent at the composition root, and every existing,
 * already-tested agent class (`DeveloperAgent`, `QaAgent`,
 * `ProjectManagerAgent`) needs ZERO code changes — they already accept an
 * injected `ModelProvider` and already map `ProviderUnavailableError` to a
 * `"model_unavailable"` failure, which is exactly what a routing denial
 * throws here.
 *
 * SELECTED != EXECUTED is enforced the same way EO-7 established: routing
 * happens strictly before `inner.generate()` is ever called, and a denied /
 * unavailable / unknown routing outcome throws instead of falling through.
 */
import {
  ProviderUnavailableError,
  estimateCost,
  requireText,
  type Agent,
  type ModelProvider,
  type ModelRequest,
  type ModelRequirementProfile,
  type ModelResponse,
} from "../../contracts/index.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { ModelRouter } from "./model-router.js";
import type { UsageLedger } from "../cost-center/usage-ledger.js";

export interface RoutedModelProviderOptions {
  /** The real provider a selected candidate is actually executed against. */
  inner: ModelProvider;
  router: Pick<ModelRouter, "routeInternal">;
  /** The agent this provider instance is bound to — fixed at composition time, one instance per agent. */
  agent: Agent;
  requirement: ModelRequirementProfile;
  /** Recorded into the Cost Center after a successful call, keyed by taskId (idempotent). Optional, same as EO-7. */
  usageLedger?: Pick<UsageLedger, "record">;
  /** Records a `model_mismatch` activity when the router's selection differs from what the provider actually used. Optional. */
  audit?: AuditLog;
}

export class RoutedModelProvider implements ModelProvider {
  constructor(private readonly options: RoutedModelProviderOptions) {}

  get id(): string {
    return this.options.inner.id;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const { inner, router, agent, requirement, usageLedger, audit } = this.options;
    const metadata = (request.metadata ?? {}) as Record<string, unknown>;
    // The metadata this wraps is internally supplied by each agent's own `callModel` (trusted,
    // not attacker-controlled) — validated anyway, since a missing projectId/taskId here would
    // otherwise route (and record usage) against an empty string rather than failing loudly.
    const projectId = requireText(metadata.projectId, "request.metadata.projectId");
    const taskId = requireText(metadata.taskId, "request.metadata.taskId");

    const routing = await router.routeInternal({
      projectId,
      agentId: agent.id,
      agent,
      requirement,
      requestId: taskId,
      taskId,
    });
    if (!routing.selectedProvider) {
      throw new ProviderUnavailableError(
        inner.id,
        routing.policyDecision?.detail ?? "no qualified model is available for this task",
      );
    }

    const response = await inner.generate(request);

    if (usageLedger) {
      await usageLedger.record({
        projectId,
        taskId,
        agentId: agent.id,
        provider: inner.id,
        model: response.model,
        inputTokens: response.usage?.inputTokens,
        outputTokens: response.usage?.outputTokens,
        totalTokens: response.usage?.totalTokens,
        cost: estimateCost(response.model, response.usage),
        idempotencyKey: taskId,
      });
    }

    // REQUESTED MODEL != ACTUAL MODEL: the same invariant EO-7 established for the control-plane
    // analysis executor, replicated here at the provider layer (no AgentRun exists at this level,
    // so the audit event is written directly, in the same "agent_activity" shape AgentRun.activity
    // produces, rather than skipping the check for lack of one).
    if (audit && routing.selectedModel !== undefined && routing.selectedModel !== response.model) {
      audit.record("agent_activity", {
        taskId,
        agentId: agent.id,
        projectId,
        data: {
          kind: "model_mismatch",
          requestedModel: routing.selectedModel,
          actualModel: response.model,
          routingDecisionId: routing.routingDecisionId,
        },
      });
    }

    return response;
  }
}
