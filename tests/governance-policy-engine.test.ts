/**
 * EO-6.3 — Governance Policy Engine.
 *
 * ALLOW != DENY != REQUIRE_APPROVAL != UNKNOWN · UNKNOWN COST != ZERO COST ·
 * RECOMMENDATION != COMMAND · APPROVAL != EXECUTION
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { GovernanceRequest } from "../contracts/index.js";
import {
  ApprovalSystem,
  BudgetEnforcer,
  BudgetPolicyStore,
  GovernancePolicyEngine,
  GovernancePolicyStore,
  UsageLedger,
  checkGovernanceApproval,
  requestGovernanceApproval,
} from "../core/index.js";
import { ADMIN, BETA_OPERATOR, OPERATOR } from "./fixtures/execution.js";

const PROJECT = "alpha";

class FixedClock {
  constructor(private isoMs: number) {}
  now = () => new Date(this.isoMs).toISOString();
}

function buildEngine(clock: FixedClock, approvals?: ApprovalSystem) {
  const budgetPolicies = new BudgetPolicyStore(undefined, clock.now);
  const usage = new UsageLedger(undefined, clock.now);
  const budget = new BudgetEnforcer(budgetPolicies, usage, clock.now);
  const governancePolicies = new GovernancePolicyStore(undefined, clock.now);
  const engine = new GovernancePolicyEngine(governancePolicies, budget, clock.now, approvals);
  return { budgetPolicies, usage, governancePolicies, engine };
}

const req = (over: Partial<GovernanceRequest> = {}): GovernanceRequest => ({
  projectId: PROJECT,
  requestId: "req-1",
  requestedBy: OPERATOR.id,
  ...over,
});

test("GOVERNANCE: an operator with no access to the project is DENIED, before anything else is even evaluated", async () => {
  const clock = new FixedClock(Date.now());
  const { engine } = buildEngine(clock);
  const result = await engine.evaluate(BETA_OPERATOR, req());
  assert.equal(result.decision, "deny");
  assert.equal(result.reasonCode, "PROJECT_ACCESS_DENIED");
});

test("GOVERNANCE: with no policy and no estimate, the decision is UNKNOWN — never a silent allow, never a denial nobody asked for", async () => {
  const clock = new FixedClock(Date.now());
  const { engine } = buildEngine(clock);
  const result = await engine.evaluate(OPERATOR, req());
  assert.equal(result.decision, "unknown");
  assert.equal(result.reasonCode, "UNKNOWN_COST_NOT_ALLOWED");
});

test("GOVERNANCE: with a known estimate and no policy, the decision is ALLOW", async () => {
  const clock = new FixedClock(Date.now());
  const { engine } = buildEngine(clock);
  const result = await engine.evaluate(OPERATOR, req({ estimatedUsd: 1 }));
  assert.equal(result.decision, "allow");
});

test("GOVERNANCE: a project policy that allows unknown cost lets an un-estimated request through", async () => {
  const clock = new FixedClock(Date.now());
  const { engine, governancePolicies } = buildEngine(clock);
  await governancePolicies.set(ADMIN, PROJECT, { allowUnknownCost: true });
  const result = await engine.evaluate(OPERATOR, req());
  assert.equal(result.decision, "allow");
});

test("GOVERNANCE: BUDGET_LIMIT_REACHED — a hard-stopped, already-exhausted budget DENIES, even with a known estimate", async () => {
  const clock = new FixedClock(Date.now());
  const { engine, budgetPolicies, usage } = buildEngine(clock);
  await budgetPolicies.set(ADMIN, PROJECT, { dailyLimitUsd: 1, warningThresholdPercent: 80, hardStop: true });
  await usage.record({ projectId: PROJECT, provider: "fake", model: "claude-sonnet-5", cost: { priced: true, amountUsd: 1, pricingVersion: "t" } });
  const result = await engine.evaluate(OPERATOR, req({ estimatedUsd: 0.01 }));
  assert.equal(result.decision, "deny");
  assert.equal(result.reasonCode, "BUDGET_LIMIT_REACHED");
});

test("GOVERNANCE: MODEL_NOT_ALLOWED — a configured allow-list denies an unlisted provider or model, but an unconfigured project never fabricates this denial", async () => {
  const clock = new FixedClock(Date.now());
  const { engine, governancePolicies } = buildEngine(clock);
  // Unconfigured: nothing is denied on this dimension.
  assert.equal((await engine.evaluate(OPERATOR, req({ estimatedUsd: 1, provider: "totally-unknown" }))).decision, "allow");

  await governancePolicies.set(ADMIN, PROJECT, { allowedProviders: ["anthropic"], allowUnknownCost: false });
  const deniedProvider = await engine.evaluate(OPERATOR, req({ estimatedUsd: 1, provider: "openai" }));
  assert.equal(deniedProvider.decision, "deny");
  assert.equal(deniedProvider.reasonCode, "MODEL_NOT_ALLOWED");
  const allowedProvider = await engine.evaluate(OPERATOR, req({ estimatedUsd: 1, provider: "Anthropic" }));
  assert.equal(allowedProvider.decision, "allow", "provider matching is case-insensitive");
});

test("GOVERNANCE: MODEL_NOT_ALLOWED on the MODEL allow-list is also case-insensitive — a model stored lowercase must not wrongly deny a mixed-case request", async () => {
  const clock = new FixedClock(Date.now());
  const { engine, governancePolicies } = buildEngine(clock);
  const saved = await governancePolicies.set(ADMIN, PROJECT, { allowedModels: ["Claude-Sonnet-5"], allowUnknownCost: false });
  assert.deepEqual(saved.allowedModels, ["claude-sonnet-5"], "stored lowercase, as documented");

  const deniedModel = await engine.evaluate(OPERATOR, req({ estimatedUsd: 1, model: "gpt-4" }));
  assert.equal(deniedModel.decision, "deny");
  assert.equal(deniedModel.reasonCode, "MODEL_NOT_ALLOWED");

  const mixedCase = await engine.evaluate(OPERATOR, req({ estimatedUsd: 1, model: "Claude-Sonnet-5" }));
  assert.equal(mixedCase.decision, "allow", "an allow-listed model must not be denied purely because the request's casing differs from how it was stored");

  const lowerCase = await engine.evaluate(OPERATOR, req({ estimatedUsd: 1, model: "claude-sonnet-5" }));
  assert.equal(lowerCase.decision, "allow");
});

test("GOVERNANCE: APPROVAL_REQUIRED — crossing the threshold files a REAL approval on the EXISTING ApprovalSystem, and a second call with a pending approval never files a duplicate", async () => {
  const clock = new FixedClock(Date.now());
  const approvals = new ApprovalSystem();
  const { engine, governancePolicies } = buildEngine(clock, approvals);
  await governancePolicies.set(ADMIN, PROJECT, { requireApprovalAboveUsd: 5, allowUnknownCost: false });

  const first = await engine.evaluate(OPERATOR, req({ estimatedUsd: 10 }));
  assert.equal(first.decision, "require_approval");
  assert.equal(first.reasonCode, "APPROVAL_REQUIRED");
  assert.ok(first.approvalId, "a real approval was filed");
  const filed = approvals.get(first.approvalId!);
  assert.equal(filed?.status, "requested");

  // A second evaluation of the SAME request, without the approval id, must not spam a new approval —
  // NOT because the engine deduped it (it can't see prior calls), but this documents the caller's job:
  // pass the approvalId back to avoid a new filing.
  const second = await engine.evaluate(OPERATOR, req({ estimatedUsd: 10, approvalId: first.approvalId }));
  assert.equal(second.decision, "require_approval");
  assert.equal(second.approvalId, first.approvalId, "still pending: reports the SAME approval, never files a duplicate");
});

test("GOVERNANCE: an APPROVED override authorizes exactly this request and the engine then allows it", async () => {
  const clock = new FixedClock(Date.now());
  const approvals = new ApprovalSystem();
  const { engine, governancePolicies } = buildEngine(clock, approvals);
  await governancePolicies.set(ADMIN, PROJECT, { requireApprovalAboveUsd: 5, allowUnknownCost: false });
  const first = await engine.evaluate(OPERATOR, req({ estimatedUsd: 10 }));
  approvals.decide(first.approvalId!, "approved", ADMIN.id);
  const second = await engine.evaluate(OPERATOR, req({ estimatedUsd: 10, approvalId: first.approvalId }));
  assert.equal(second.decision, "allow");
});

test("GOVERNANCE: a REJECTED approval does not authorize the request, and re-evaluating files a FRESH approval rather than reusing the dead one", async () => {
  const clock = new FixedClock(Date.now());
  const approvals = new ApprovalSystem();
  const { engine, governancePolicies } = buildEngine(clock, approvals);
  await governancePolicies.set(ADMIN, PROJECT, { requireApprovalAboveUsd: 5, allowUnknownCost: false });
  const first = await engine.evaluate(OPERATOR, req({ estimatedUsd: 10 }));
  approvals.decide(first.approvalId!, "rejected", ADMIN.id);
  const second = await engine.evaluate(OPERATOR, req({ estimatedUsd: 10, approvalId: first.approvalId }));
  assert.equal(second.decision, "require_approval");
  assert.notEqual(second.approvalId, first.approvalId, "a rejected approval is dead — a fresh one is filed");
});

test("GOVERNANCE: an approval bound to a DIFFERENT project never authorizes this one — cross-project approval reuse is impossible", async () => {
  const clock = new FixedClock(Date.now());
  const approvals = new ApprovalSystem();
  const filed = requestGovernanceApproval(approvals, { action: "governance.cost_override", projectId: "other-project", requestId: "req-1" }, OPERATOR.id, "x");
  approvals.decide(filed.id, "approved", ADMIN.id);
  const problem = checkGovernanceApproval(approvals, filed.id, { action: "governance.cost_override", projectId: PROJECT, requestId: "req-1" }, clock.now());
  assert.ok(problem, "a different project's approval must never authorize this one");
});

test("GOVERNANCE: an EXPIRED approval does not authorize the request", async () => {
  const clock = new FixedClock(Date.now());
  const approvals = new ApprovalSystem();
  const binding = { action: "governance.cost_override" as const, projectId: PROJECT, requestId: "req-1" };
  const canonical = `${binding.action}\u0000${binding.projectId}\u0000${binding.requestId}`;
  const filed = approvals.request({
    action: binding.action,
    requestedBy: OPERATOR.id,
    reason: "x",
    expiresAt: "2000-01-01T00:00:00.000Z",
    metadata: { binding: canonical, projectId: binding.projectId },
  });
  approvals.decide(filed.id, "approved", ADMIN.id);
  const problem = checkGovernanceApproval(approvals, filed.id, binding, clock.now());
  assert.ok(problem, "an approval past its expiresAt must never authorize the request");
});

test("GOVERNANCE: FAIL-SAFE — an unexpected internal failure returns UNKNOWN/GOVERNANCE_UNAVAILABLE, never ALLOW", async () => {
  const clock = new FixedClock(Date.now());
  const governancePolicies = new GovernancePolicyStore(undefined, clock.now);
  const brokenBudget = { evaluate: () => { throw new Error("boom"); } } as unknown as BudgetEnforcer;
  const engine = new GovernancePolicyEngine(governancePolicies, brokenBudget, clock.now);
  const result = await engine.evaluate(OPERATOR, req({ estimatedUsd: 1 }));
  assert.equal(result.decision, "unknown");
  assert.equal(result.reasonCode, "GOVERNANCE_UNAVAILABLE");
});

test("GOVERNANCE: NaN/Infinity estimatedUsd is rejected outright — never silently treated as 'no threshold crossed'", async () => {
  const clock = new FixedClock(Date.now());
  const { engine, governancePolicies } = buildEngine(clock);
  await governancePolicies.set(ADMIN, PROJECT, { requireApprovalAboveUsd: 5, allowUnknownCost: false });
  const { ValidationError } = await import("../contracts/index.js");
  await assert.rejects(engine.evaluate(OPERATOR, req({ estimatedUsd: Number.NaN })), ValidationError);
  await assert.rejects(engine.evaluate(OPERATOR, req({ estimatedUsd: Number.POSITIVE_INFINITY })), ValidationError);
});

test("GOVERNANCE POLICY STORE: only an admin may set the policy; an invalid draft is rejected", async () => {
  const clock = new FixedClock(Date.now());
  const store = new GovernancePolicyStore(undefined, clock.now);
  const { ExecutionDeniedError, ValidationError } = await import("../contracts/index.js");
  await assert.rejects(store.set(OPERATOR, PROJECT, { allowUnknownCost: true }), ExecutionDeniedError);
  await assert.rejects(store.set(ADMIN, PROJECT, { allowedProviders: [], allowUnknownCost: true }), ValidationError);
  await assert.rejects(store.set(ADMIN, PROJECT, { allowUnknownCost: "yes" as never }), ValidationError);
  const saved = await store.set(ADMIN, PROJECT, { allowedProviders: ["Anthropic"], allowUnknownCost: true });
  assert.deepEqual(saved.allowedProviders, ["anthropic"], "provider ids are normalized lowercase");
});
