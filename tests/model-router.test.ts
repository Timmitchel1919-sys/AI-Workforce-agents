/**
 * EO-7 — the Model Router.
 *
 * AVAILABLE != QUALIFIED · SUPPORTED != ALLOWED != SELECTED · CHEAPEST != BEST ·
 * FALLBACK != SILENT DOWNGRADE · UNKNOWN COST != ZERO COST
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { Agent } from "../contracts/index.js";
import { ValidationError } from "../contracts/index.js";
import {
  ApprovalSystem,
  BudgetEnforcer,
  BudgetPolicyStore,
  GovernancePolicyEngine,
  GovernancePolicyStore,
  InMemoryExecutionRecordStore,
  ModelCapabilityRegistry,
  ModelProviderRegistry,
  ModelRouter,
  UsageLedger,
  type RouteRequest,
} from "../core/index.js";
import { ADMIN, BETA_OPERATOR, OPERATOR } from "./fixtures/execution.js";

const PROJECT = "alpha";

class FixedClock {
  constructor(private isoMs: number) {}
  now = () => new Date(this.isoMs).toISOString();
}

const AGENT: Agent = {
  id: "analysis-agent",
  name: "Analysis Agent",
  description: "d",
  capabilities: [],
  allowedTools: [],
  allowedProjects: [],
  supportedTaskTypes: [],
  permissions: [],
  modelPolicy: { provider: "openai" },
};

function build(clock: FixedClock, options: { store?: InMemoryExecutionRecordStore; profiles?: { id: string; providerId: string; model?: string; capabilities: readonly ("reasoning" | "coding" | "vision" | "structured_output" | "large_context")[] }[]; registeredProviders?: string[] } = {}) {
  const store = options.store ?? new InMemoryExecutionRecordStore();
  const profiles = new ModelCapabilityRegistry(options.profiles ?? [{ id: "openai-default", providerId: "openai", capabilities: ["reasoning", "structured_output"] }]);
  const providers = new ModelProviderRegistry();
  for (const id of options.registeredProviders ?? ["openai"]) providers.register(id, () => ({ id, generate: async () => ({ content: "", model: id }) }));
  const budgetPolicies = new BudgetPolicyStore(store, clock.now);
  const usage = new UsageLedger(store, clock.now);
  const budget = new BudgetEnforcer(budgetPolicies, usage, clock.now);
  const governancePolicies = new GovernancePolicyStore(store, clock.now);
  const approvals = new ApprovalSystem();
  const governance = new GovernancePolicyEngine(governancePolicies, budget, clock.now, approvals);
  const router = new ModelRouter(profiles, providers, governance, clock.now, store, undefined, budget, governancePolicies);
  return { store, profiles, providers, budgetPolicies, usage, governancePolicies, governance, router };
}

// A known cost estimate by default so most tests exercise selection, not the UNKNOWN_COST gate —
// that gate has its own dedicated test below.
const req = (over: Partial<RouteRequest> = {}): RouteRequest => ({
  projectId: PROJECT,
  agentId: AGENT.id,
  agent: AGENT,
  requirement: { requiredCapabilities: ["reasoning"] },
  requestedBy: OPERATOR.id,
  requestId: "req-1",
  estimatedUsd: 1,
  ...over,
});

const reqBase = (over: Partial<RouteRequest> = {}) => {
  const { requestedBy: _requestedBy, ...base } = req(over);
  return base;
};

test("ROUTER: a qualified, available, allowed candidate is SELECTED and the decision is persisted/retrievable", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = build(clock);
  const decision = await router.route(OPERATOR, req());
  assert.equal(decision.selectedProvider, "openai");
  assert.deepEqual(decision.rejectedCandidates, []);
  assert.deepEqual(decision.reasonCodes, []);
  const fetched = await router.get(PROJECT, decision.routingDecisionId);
  assert.deepEqual(fetched, decision);
  const history = await router.listByProject(PROJECT);
  assert.equal(history.length, 1);
});

test("ROUTER: CAPABILITY_MISMATCH — a candidate missing a required capability is rejected, never selected", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = build(clock, { profiles: [{ id: "openai-basic", providerId: "openai", capabilities: ["reasoning"] }] });
  const decision = await router.route(OPERATOR, req({ requirement: { requiredCapabilities: ["vision"] } }));
  assert.equal(decision.selectedProvider, undefined);
  assert.equal(decision.rejectedCandidates.length, 1);
  assert.equal(decision.rejectedCandidates[0]!.reasonCode, "CAPABILITY_MISMATCH");
  assert.deepEqual(decision.reasonCodes, ["CAPABILITY_MISMATCH"]);
});

test("ROUTER: PROVIDER_UNAVAILABLE — a capability-eligible candidate whose provider is not registered is rejected, never selected", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = build(clock, { registeredProviders: [] });
  const decision = await router.route(OPERATOR, req());
  assert.equal(decision.selectedProvider, undefined);
  assert.equal(decision.rejectedCandidates[0]!.reasonCode, "PROVIDER_UNAVAILABLE");
});

test("ROUTER: BUDGET_EXCEEDED — an exhausted, hard-stopped budget denies the candidate; NO EXECUTION follows (nothing selected)", async () => {
  const clock = new FixedClock(Date.now());
  const { router, budgetPolicies, usage } = build(clock);
  await budgetPolicies.set(ADMIN, PROJECT, { dailyLimitUsd: 1, warningThresholdPercent: 80, hardStop: true });
  await usage.record({ projectId: PROJECT, provider: "openai", model: "x", cost: { priced: true, amountUsd: 1, pricingVersion: "t" } });
  const decision = await router.route(OPERATOR, req({ estimatedUsd: 0.01 }));
  assert.equal(decision.selectedProvider, undefined);
  assert.equal(decision.rejectedCandidates[0]!.reasonCode, "BUDGET_EXCEEDED");
});

test("ROUTER: PROJECT_POLICY_DENIED — a provider outside the project's governance allow-list is rejected", async () => {
  const clock = new FixedClock(Date.now());
  const { router, governancePolicies } = build(clock);
  await governancePolicies.set(ADMIN, PROJECT, { allowedProviders: ["anthropic"], allowUnknownCost: true });
  const decision = await router.route(OPERATOR, req());
  assert.equal(decision.selectedProvider, undefined);
  assert.equal(decision.rejectedCandidates[0]!.reasonCode, "PROJECT_POLICY_DENIED");
});

test("ROUTER: UNKNOWN COST != ZERO COST — an otherwise-qualified candidate with no cost estimate and a policy that forbids unknown cost is left unselected, not silently allowed as free", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = build(clock);
  const decision = await router.route(OPERATOR, req({ estimatedUsd: undefined }));
  assert.equal(decision.selectedProvider, undefined);
  assert.equal(decision.rejectedCandidates.length, 0, "unknown cost is not a REJECTION — it is an unresolved policy gate");
  assert.equal(decision.policyDecision?.decision, "unknown");
  assert.equal(decision.policyDecision?.reasonCode, "UNKNOWN_COST_NOT_ALLOWED");
});

test("ROUTER: NO-VALID-MODEL SCENARIO — zero candidate profiles exist at all: controlled failure, no fake model, no arbitrary execution", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = build(clock, { profiles: [] });
  const decision = await router.route(OPERATOR, req());
  assert.equal(decision.selectedProvider, undefined);
  assert.equal(decision.selectedModel, undefined);
  assert.deepEqual(decision.candidateModels, []);
  assert.deepEqual(decision.rejectedCandidates, []);
  assert.deepEqual(decision.reasonCodes, []);
});

test("ROUTER: FALLBACK SCENARIO — the primary candidate is excluded after a real failure; the router governedly re-evaluates and selects the next qualified candidate, marking fallbackUsed", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = build(clock, {
    profiles: [
      { id: "openai-primary", providerId: "openai", capabilities: ["reasoning"] },
      { id: "openai-secondary", providerId: "openai", capabilities: ["reasoning"] },
    ],
  });
  const first = await router.route(OPERATOR, req());
  assert.equal(first.selectedProvider, "openai");
  assert.equal(first.candidateModels.length, 2, "both candidates were considered the first time");
  const primaryId = first.candidateModels.find((c) => c.status === "available")!.profileId;
  const second = await router.route(OPERATOR, req({ fallbackOf: first.routingDecisionId, excludeProfileIds: [primaryId] }));
  assert.equal(second.fallbackUsed, true);
  assert.equal(second.fallbackOf, first.routingDecisionId);
  assert.ok(second.selectedProvider, "a qualified fallback candidate was selected");
  assert.equal(second.candidateModels.length, 1, "the excluded primary must not even be re-offered as a candidate");
  assert.notEqual(second.candidateModels[0]!.profileId, primaryId, "the fallback selection must be the OTHER candidate, never the excluded one again");
  assert.notEqual(second.routingDecisionId, first.routingDecisionId);
});

test("ROUTER: cost_efficient prefers the cheaper of two priced candidates — CHEAPEST != BEST is still a real, deterministic dimension when asked for", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = build(clock, {
    profiles: [
      { id: "expensive", providerId: "openai", model: "claude-opus-5-5", capabilities: ["reasoning"] },
      { id: "cheap", providerId: "openai", model: "claude-haiku-4-5-20251001", capabilities: ["reasoning"] },
    ],
  });
  const decision = await router.route(OPERATOR, req({ requirement: { requiredCapabilities: ["reasoning"], routingProfile: "cost_efficient" }, estimatedUsd: 1 }));
  assert.equal(decision.selectedModel, "claude-haiku-4-5-20251001");
});

test("ROUTER: quality_first prefers the candidate matching more PREFERRED capabilities, never fabricating a quality score", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = build(clock, {
    profiles: [
      { id: "plain", providerId: "openai", model: "model-plain", capabilities: ["reasoning"] },
      { id: "richer", providerId: "openai", model: "model-richer", capabilities: ["reasoning", "large_context", "coding"] },
    ],
  });
  const decision = await router.route(
    OPERATOR,
    req({ requirement: { requiredCapabilities: ["reasoning"], preferredCapabilities: ["large_context", "coding"], routingProfile: "quality_first" }, estimatedUsd: 1 }),
  );
  assert.equal(decision.candidateModels.length, 2);
  // "richer" satisfies BOTH preferred capabilities the requirement asked for; "plain" satisfies
  // neither — quality_first must pick the one that actually matches more, never an arbitrary one.
  assert.equal(decision.selectedModel, "model-richer");
});

test("ROUTER: a manual modelRestriction narrows candidates to a specific model even when another model of the SAME provider would otherwise qualify", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = build(clock, {
    profiles: [
      { id: "openai-a", providerId: "openai", model: "model-a", capabilities: ["reasoning"] },
      { id: "openai-b", providerId: "openai", model: "model-b", capabilities: ["reasoning"] },
    ],
  });
  const decision = await router.route(
    OPERATOR,
    req({ requirement: { requiredCapabilities: ["reasoning"], modelRestrictions: ["model-b"] }, estimatedUsd: 1 }),
  );
  assert.equal(decision.selectedModel, "model-b");
  assert.equal(decision.rejectedCandidates.length, 0, "the restricted-out candidate is simply out of scope, not a rejection");
});

test("ROUTER: modelRestrictions / providerRestrictions match case-insensitively — a mixed-case restriction must not wrongly exclude the model it names", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = build(clock, {
    profiles: [{ id: "openai-a", providerId: "openai", model: "model-a", capabilities: ["reasoning"] }],
  });
  const decision = await router.route(
    OPERATOR,
    req({ requirement: { requiredCapabilities: ["reasoning"], providerRestrictions: ["OpenAI"], modelRestrictions: ["Model-A"] }, estimatedUsd: 1 }),
  );
  assert.equal(decision.selectedModel, "model-a", "a differently-cased restriction must still match the real model");
});

test("ROUTER: MALICIOUS INPUT — a NaN cost estimate is rejected outright, never silently treated as an unbudgeted allow", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = build(clock);
  await assert.rejects(router.route(OPERATOR, req({ estimatedUsd: Number.NaN })), ValidationError);
});

test("ROUTER: PROJECT ISOLATION — a routing decision for one project never appears in another project's history", async () => {
  const clock = new FixedClock(Date.now());
  const store = new InMemoryExecutionRecordStore();
  const { router } = build(clock, { store });
  await router.route(OPERATOR, req({ projectId: "alpha" }));
  await router.route(BETA_OPERATOR, req({ projectId: "beta", requestedBy: BETA_OPERATOR.id }));
  const alphaHistory = await router.listByProject("alpha");
  const betaHistory = await router.listByProject("beta");
  assert.equal(alphaHistory.length, 1);
  assert.equal(betaHistory.length, 1);
  assert.notEqual(alphaHistory[0]!.routingDecisionId, betaHistory[0]!.routingDecisionId);
});

test("ROUTER: IDOR — get() rejects a valid decision id fetched under the WRONG project, even though the ledger indexes it only by id", async () => {
  const clock = new FixedClock(Date.now());
  const store = new InMemoryExecutionRecordStore();
  const { router } = build(clock, { store });
  const decision = await router.route(OPERATOR, req({ projectId: "alpha" }));
  assert.ok(await router.get("alpha", decision.routingDecisionId), "the owning project can fetch it");
  assert.equal(await router.get("beta", decision.routingDecisionId), undefined, "a different project must never fetch it, even with a real, valid decision id");
});

test("ROUTER: CONCURRENCY — concurrent routing requests never collide on a routingDecisionId", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = build(clock);
  const [a, b, c] = await Promise.all([router.route(OPERATOR, req({ requestId: "r1" })), router.route(OPERATOR, req({ requestId: "r2" })), router.route(OPERATOR, req({ requestId: "r3" }))]);
  const ids = new Set([a.routingDecisionId, b.routingDecisionId, c.routingDecisionId]);
  assert.equal(ids.size, 3);
});

/* ------------------------------------------------------------------ */
/* routeInternal — the trusted, principal-less path an agent's OWN     */
/* execution takes (mirrors route() without an operator principal).    */
/* ------------------------------------------------------------------ */

test("ROUTER INTERNAL: without budgetInternal/governancePoliciesInternal configured, it fails closed with a clear error — never silently skips governance", async () => {
  const clock = new FixedClock(Date.now());
  const { profiles, providers, governance } = build(clock);
  const bare = new ModelRouter(profiles, providers, governance, clock.now);
  await assert.rejects(bare.routeInternal(reqBase()), /routeInternal requires/);
});

test("ROUTER INTERNAL: a qualified, available candidate with no configured budget/policy is selected", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = build(clock);
  const decision = await router.routeInternal(reqBase());
  assert.equal(decision.selectedProvider, "openai");
});

test("ROUTER INTERNAL: BUDGET_EXCEEDED — an exhausted, hard-stopped budget denies the candidate through the SAME internal gate BudgetGovernedModelProvider uses", async () => {
  const clock = new FixedClock(Date.now());
  const { router, budgetPolicies, usage } = build(clock);
  await budgetPolicies.set(ADMIN, PROJECT, { dailyLimitUsd: 1, warningThresholdPercent: 80, hardStop: true });
  await usage.record({ projectId: PROJECT, provider: "openai", model: "x", cost: { priced: true, amountUsd: 1, pricingVersion: "t" } });
  const decision = await router.routeInternal(reqBase({ estimatedUsd: 0.01 }));
  assert.equal(decision.selectedProvider, undefined);
  assert.equal(decision.rejectedCandidates[0]!.reasonCode, "BUDGET_EXCEEDED");
});

test("ROUTER INTERNAL: CRITICAL FIX — a hard-stopped budget with a real limit actually blocks a real, UNPRICED model (e.g. an OpenAI model with no price-table entry), not just a priced one", async () => {
  const clock = new FixedClock(Date.now());
  const { router, budgetPolicies, usage } = build(clock);
  await budgetPolicies.set(ADMIN, PROJECT, { dailyLimitUsd: 0.01, warningThresholdPercent: 80, hardStop: true });
  // Fifty large, real, UNPRICED (no MODEL_PRICES entry) usage records — a genuinely enormous
  // amount of real spend at any real market price, none of which the priced $-total can see.
  for (let i = 0; i < 50; i += 1) {
    await usage.record({
      projectId: PROJECT,
      taskId: `t${i}`,
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cost: { priced: false, reason: 'no price entry for model "gpt-4o"' },
      idempotencyKey: `t${i}`,
    });
  }
  const decision = await router.routeInternal(reqBase({ estimatedUsd: undefined }));
  assert.equal(decision.selectedProvider, undefined, "a $0.01/day hard-stop must not let 50 x 2M-token real calls through just because none of them could be priced");
  assert.equal(decision.rejectedCandidates[0]!.reasonCode, "BUDGET_EXCEEDED");
});

test("ROUTER INTERNAL: PROJECT_POLICY_DENIED — a provider outside the project's governance allow-list is rejected", async () => {
  const clock = new FixedClock(Date.now());
  const { router, governancePolicies } = build(clock);
  await governancePolicies.set(ADMIN, PROJECT, { allowedProviders: ["anthropic"], allowUnknownCost: true });
  const decision = await router.routeInternal(reqBase());
  assert.equal(decision.selectedProvider, undefined);
  assert.equal(decision.rejectedCandidates[0]!.reasonCode, "PROJECT_POLICY_DENIED");
});

test("ROUTER: MAJOR FIX — route() and routeInternal() report the SAME reasonCode for the SAME simultaneous violation (budget exhausted AND provider off the allow-list at once); check order is not a leak into the reported reason", async () => {
  const clock = new FixedClock(Date.now());
  const { router, budgetPolicies, usage, governancePolicies } = build(clock);
  // Exhaust the budget AND put the candidate's provider off the allow-list at the same time —
  // before the fix, `route()` (via GovernancePolicyEngine.decide, budget-first) reported
  // BUDGET_EXCEEDED while `routeInternal()` (allow-list-first) reported PROJECT_POLICY_DENIED for
  // this identical real-world state, purely as an artifact of which entry point ran, not anything
  // true about the request itself.
  await budgetPolicies.set(ADMIN, PROJECT, { dailyLimitUsd: 1, warningThresholdPercent: 80, hardStop: true });
  await usage.record({ projectId: PROJECT, provider: "openai", model: "x", cost: { priced: true, amountUsd: 1, pricingVersion: "t" } });
  await governancePolicies.set(ADMIN, PROJECT, { allowedProviders: ["anthropic"], allowUnknownCost: true });

  const viaOperator = await router.route(OPERATOR, req({ estimatedUsd: 0.01 }));
  const viaInternal = await router.routeInternal(reqBase({ estimatedUsd: 0.01 }));

  assert.equal(viaOperator.selectedProvider, undefined);
  assert.equal(viaInternal.selectedProvider, undefined);
  assert.equal(viaOperator.rejectedCandidates[0]!.reasonCode, "BUDGET_EXCEEDED");
  assert.equal(viaInternal.rejectedCandidates[0]!.reasonCode, "BUDGET_EXCEEDED");
  assert.equal(viaOperator.rejectedCandidates[0]!.reasonCode, viaInternal.rejectedCandidates[0]!.reasonCode);
});

test("ROUTER INTERNAL: UNKNOWN COST != ZERO COST holds on the internal path too", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = build(clock);
  const decision = await router.routeInternal(reqBase({ estimatedUsd: undefined }));
  assert.equal(decision.selectedProvider, undefined);
  assert.equal(decision.policyDecision?.decision, "unknown");
});

test("ROUTER INTERNAL: MALICIOUS INPUT — a NaN cost estimate is rejected outright on the internal path too, never silently bypassing the approval threshold", async () => {
  const clock = new FixedClock(Date.now());
  const { router, governancePolicies } = build(clock);
  await governancePolicies.set(ADMIN, PROJECT, { requireApprovalAboveUsd: 5, allowUnknownCost: false });
  await assert.rejects(router.routeInternal(reqBase({ estimatedUsd: Number.NaN })), ValidationError);
});
