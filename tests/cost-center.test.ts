/**
 * EO-6.2 — AI Cost Center & rule-based Auditor governance foundation.
 *
 * RECORDED != ENFORCED · PRICED != FABRICATED · CONNECTED != CAPABLE ·
 * RULE-BASED != MODEL-ASSISTED
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ExecutionDeniedError,
  ValidationError,
  estimateCost,
  evaluateBudget,
  sumUsd,
  type BudgetPolicy,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from "../contracts/index.js";
import {
  AuditedModelProvider,
  AuditLog,
  BudgetEnforcer,
  BudgetGovernedModelProvider,
  BudgetPolicyStore,
  InMemoryExecutionRecordStore,
  ModelProviderRegistry,
  RuleAuditor,
  UsageLedger,
  deriveCostCenterCapabilities,
  inertCostCenterCapabilities,
  type AuditInputs,
} from "../core/index.js";
import { ADMIN, OPERATOR, BETA_OPERATOR, VIEWER } from "./fixtures/execution.js";

class FixedClock {
  constructor(private isoMs: number) {}
  now = () => new Date(this.isoMs).toISOString();
  advanceMs(ms: number) {
    this.isoMs += ms;
  }
}

class FakeProvider implements ModelProvider {
  readonly id = "fake";
  calls = 0;
  constructor(private readonly reply: ModelResponse | Error) {}
  async generate(_request: ModelRequest): Promise<ModelResponse> {
    this.calls += 1;
    if (this.reply instanceof Error) throw this.reply;
    return this.reply;
  }
}

const PROJECT = "alpha";

/* ------------------------------------------------------------------ */
/* Price table — never fabricated                                     */
/* ------------------------------------------------------------------ */

test("PRICE: a known model prices from the tokens the provider actually reported", () => {
  const estimate = estimateCost("claude-sonnet-5", { inputTokens: 1000, outputTokens: 500 });
  assert.equal(estimate.priced, true);
  if (estimate.priced) {
    // 1000/1e6*3 + 500/1e6*15 = 0.003 + 0.0075
    assert.ok(Math.abs(estimate.amountUsd - 0.0105) < 1e-9);
    assert.equal(typeof estimate.pricingVersion, "string");
  }
});

test("PRICE: a differently-cased but identical model id still finds its real price — never wrongly 'unpriced' by case alone", () => {
  const estimate = estimateCost("Claude-Sonnet-5", { inputTokens: 1000, outputTokens: 500 });
  assert.equal(estimate.priced, true);
  if (estimate.priced) assert.ok(Math.abs(estimate.amountUsd - 0.0105) < 1e-9);
});

test("PRICE: an unlisted model is honestly unpriced, never a guessed number", () => {
  const estimate = estimateCost("some-future-model", { inputTokens: 1000, outputTokens: 500 });
  assert.equal(estimate.priced, false);
  if (!estimate.priced) assert.match(estimate.reason, /no price entry/);
});

test("PRICE: no reported usage at all is unpriced, not zero-cost", () => {
  const estimate = estimateCost("claude-sonnet-5", undefined);
  assert.equal(estimate.priced, false);
});

/* ------------------------------------------------------------------ */
/* evaluateBudget — pure                                               */
/* ------------------------------------------------------------------ */

test("BUDGET EVAL: no policy is NOT_CONFIGURED, never treated as unlimited", () => {
  const result = evaluateBudget(undefined, { daily: 999_999, monthly: 999_999, task: 999_999 }, 0);
  assert.equal(result.status, "not_configured");
});

const policy = (overrides: Partial<BudgetPolicy> = {}): BudgetPolicy => ({
  projectId: PROJECT,
  dailyLimitUsd: 10,
  warningThresholdPercent: 80,
  hardStop: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
  updatedBy: "admin-1",
  ...overrides,
});

test("BUDGET EVAL: under threshold is ok", () => {
  const result = evaluateBudget(policy(), { daily: 1, monthly: 1, task: 0 }, 0);
  assert.equal(result.status, "ok");
});

test("BUDGET EVAL: crossing the warning threshold warns without blocking", () => {
  const result = evaluateBudget(policy(), { daily: 8.5, monthly: 8.5, task: 0 }, 0);
  assert.equal(result.status, "warning");
  assert.equal(result.scope, "daily");
});

test("BUDGET EVAL: reaching a hard-stop limit blocks", () => {
  const result = evaluateBudget(policy({ hardStop: true }), { daily: 10, monthly: 10, task: 0 }, 0);
  assert.equal(result.status, "blocked");
});

test("BUDGET EVAL: reaching a non-hard-stop limit only warns, never blocks", () => {
  const result = evaluateBudget(policy({ hardStop: false }), { daily: 50, monthly: 50, task: 0 }, 0);
  assert.equal(result.status, "warning");
});

test("BUDGET EVAL: unpriced usage under a hard-stop with a real limit BLOCKS — the priced total looking fine proves nothing about the unpriced portion", () => {
  // `policy()` defaults to hardStop:true with a $10 daily limit — exactly the case where "the
  // priced total is $0, so it must be fine" would let unbounded, unverified real spend through a
  // policy whose entire purpose is to stop it. CRITICAL fix: this must be blocked, not "unpriced".
  const result = evaluateBudget(policy(), { daily: 0, monthly: 0, task: 0 }, 3);
  assert.equal(result.status, "blocked");
});

test("BUDGET EVAL: unpriced usage with NO hard-stop, or NO limit configured at all, is only advisory (\"unpriced\") — never blocked when there is nothing to enforce", () => {
  const softPolicy = policy({ hardStop: false });
  assert.equal(evaluateBudget(softPolicy, { daily: 0, monthly: 0, task: 0 }, 3).status, "unpriced");
  const noLimitPolicy = policy({ dailyLimitUsd: undefined, hardStop: true });
  assert.equal(evaluateBudget(noLimitPolicy, { daily: 0, monthly: 0, task: 0 }, 3).status, "unpriced");
});

test("BUDGET EVAL: the tightest breached scope wins even if a looser scope has room", () => {
  const p = policy({ dailyLimitUsd: 10, monthlyLimitUsd: 1000, hardStop: true });
  const result = evaluateBudget(p, { daily: 10, monthly: 20, task: 0 }, 0);
  assert.equal(result.status, "blocked");
  assert.equal(result.scope, "daily");
});

test("BUDGET EVAL: with hardStop=false, the TIGHTEST breach wins even when a looser window is breached too — never the last one scanned", () => {
  const p = policy({ taskLimitUsd: 5, dailyLimitUsd: 10, monthlyLimitUsd: 100, hardStop: false });
  // task is fully breached (100%), daily is under, monthly is also fully breached (150%) — task,
  // being tightest by priority order, must be the one reported, not monthly (scanned last).
  const result = evaluateBudget(p, { daily: 8, monthly: 150, task: 5 }, 0);
  assert.equal(result.status, "warning");
  assert.equal(result.scope, "task");
});

test("BUDGET EVAL: a full breach always outranks a mere threshold-crossing on a different window", () => {
  const p = policy({ dailyLimitUsd: 10, monthlyLimitUsd: 100, warningThresholdPercent: 80, hardStop: false });
  // daily only crosses the 80% threshold (not a full breach); monthly is fully breached.
  const result = evaluateBudget(p, { daily: 8.5, monthly: 100, task: 0 }, 0);
  assert.equal(result.scope, "monthly");
});

test("BUDGET EVAL: uncosted usage is noted in detail even when a limit is already blocked or warning — never dropped", () => {
  const blocked = evaluateBudget(policy({ hardStop: true }), { daily: 10, monthly: 10, task: 0 }, 2);
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.detail, /could not be priced/);
  const warning = evaluateBudget(policy({ hardStop: false }), { daily: 8.5, monthly: 8.5, task: 0 }, 2);
  assert.equal(warning.status, "warning");
  assert.match(warning.detail, /could not be priced/);
});

/* ------------------------------------------------------------------ */
/* UsageLedger + BudgetPolicyStore — project isolation & authorization */
/* ------------------------------------------------------------------ */

test("USAGE LEDGER: records survive a store round-trip and stay project-scoped", async () => {
  const store = new InMemoryExecutionRecordStore();
  const clock = new FixedClock(Date.parse("2026-06-01T00:00:00.000Z"));
  const ledger = new UsageLedger(store, clock.now);
  await ledger.record({ projectId: "alpha", provider: "fake", model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 0, cost: estimateCost("claude-sonnet-5", { inputTokens: 1000, outputTokens: 0 }) });
  await ledger.record({ projectId: "beta", provider: "fake", model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 0, cost: estimateCost("claude-sonnet-5", { inputTokens: 1000, outputTokens: 0 }) });

  const alphaUsage = await ledger.listByProject(OPERATOR, "alpha");
  assert.equal(alphaUsage.length, 1);
  assert.equal(alphaUsage[0]!.projectId, "alpha");

  await assert.rejects(ledger.listByProject(OPERATOR, "beta"), ExecutionDeniedError);
  const betaUsage = await ledger.listByProject(BETA_OPERATOR, "beta");
  assert.equal(betaUsage.length, 1);
});

test("USAGE LEDGER: daily/monthly totals only include usage inside the window; task totals ignore time", async () => {
  const clock = new FixedClock(Date.parse("2026-06-10T00:00:00.000Z"));
  const ledger = new UsageLedger(undefined, clock.now);
  const priced = (usd: number) => ({ priced: true as const, amountUsd: usd, pricingVersion: "t" });
  await ledger.record({ projectId: PROJECT, provider: "fake", model: "x", taskId: "task-1", cost: priced(1) });
  clock.advanceMs(2 * 24 * 60 * 60 * 1000); // +2 days, now outside the 1-day window
  await ledger.record({ projectId: PROJECT, provider: "fake", model: "x", taskId: "task-1", cost: priced(2) });
  const nowMs = Date.parse(clock.now());
  const totals = await ledger.totals(OPERATOR, PROJECT, {
    dailySinceIso: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(),
    monthlySinceIso: new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString(),
    taskId: "task-1",
  });
  assert.equal(totals.daily, 2); // only the second record is within the last day
  assert.equal(totals.monthly, 3); // both are within 30 days
  assert.equal(totals.task, 3); // task total ignores time entirely
});

test("USAGE LEDGER: unpriced records are counted, never silently dropped from totals", async () => {
  const clock = new FixedClock(Date.parse("2026-06-10T00:00:00.000Z"));
  const ledger = new UsageLedger(undefined, clock.now);
  await ledger.record({ projectId: PROJECT, provider: "fake", model: "unknown-model", cost: estimateCost("unknown-model", { inputTokens: 1 }) });
  const totals = await ledger.totals(OPERATOR, PROJECT, {
    dailySinceIso: new Date(0).toISOString(),
    monthlySinceIso: new Date(0).toISOString(),
  });
  assert.equal(totals.uncosted, 1);
  assert.equal(totals.monthly, 0);
});

test("USAGE LEDGER: IDEMPOTENCY — a retried record with the same key never double-charges the project", async () => {
  const store = new InMemoryExecutionRecordStore();
  const clock = new FixedClock(Date.now());
  const ledger = new UsageLedger(store, clock.now);
  const draft = { projectId: PROJECT, provider: "fake", model: "claude-sonnet-5", cost: { priced: true as const, amountUsd: 1, pricingVersion: "t" }, idempotencyKey: "retry-1" };
  const first = await ledger.record(draft);
  const second = await ledger.record(draft);
  assert.equal(first.usageId, second.usageId, "the retry returns the SAME record, not a new one");
  const all = await ledger.listInternal(PROJECT);
  assert.equal(all.length, 1, "exactly one record exists despite two record() calls");
});

test("USAGE LEDGER: CONCURRENCY — two racing retries with the same idempotency key still only record once", async () => {
  const store = new InMemoryExecutionRecordStore();
  const clock = new FixedClock(Date.now());
  const ledger = new UsageLedger(store, clock.now);
  const draft = { projectId: PROJECT, provider: "fake", model: "claude-sonnet-5", cost: { priced: true as const, amountUsd: 1, pricingVersion: "t" }, idempotencyKey: "race-1" };
  const [a, b] = await Promise.all([ledger.record(draft), ledger.record(draft)]);
  assert.equal(a.usageId, b.usageId);
  const all = await ledger.listInternal(PROJECT);
  assert.equal(all.length, 1, "a race between two concurrent calls with the same key still yields exactly one record");
});

test("USAGE LEDGER: CONCURRENCY without a durable store — two racing calls with the same key and DIFFERENT content still resolve to exactly one, SHARED record", async () => {
  // No store at all (the in-memory fallback): DurableLedger's no-store path has no create-only
  // protection of its own, so this proves UsageLedger's own in-process coalescing (not the store's)
  // is what keeps two truly concurrent callers from both "winning" with different content.
  const clock = new FixedClock(Date.now());
  const ledger = new UsageLedger(undefined, clock.now);
  const draftA = { projectId: PROJECT, provider: "fake", model: "claude-sonnet-5", cost: { priced: true as const, amountUsd: 1, pricingVersion: "t" }, idempotencyKey: "race-no-store" };
  const draftB = { projectId: PROJECT, provider: "fake", model: "claude-sonnet-5", cost: { priced: true as const, amountUsd: 999, pricingVersion: "t" }, idempotencyKey: "race-no-store" };
  const [a, b] = await Promise.all([ledger.record(draftA), ledger.record(draftB)]);
  assert.equal(a.usageId, b.usageId);
  assert.equal(a.cost.priced && a.cost.amountUsd, b.cost.priced && b.cost.amountUsd, "both callers must observe the SAME winning record, never two different amounts");
  const all = await ledger.listInternal(PROJECT);
  assert.equal(all.length, 1, "exactly one record exists even with no durable store to enforce it");
});

test("USAGE LEDGER: without an idempotency key, no dedupe is attempted — every call records a new entry", async () => {
  const clock = new FixedClock(Date.now());
  const ledger = new UsageLedger(undefined, clock.now);
  const draft = { projectId: PROJECT, provider: "fake", model: "claude-sonnet-5", cost: { priced: true as const, amountUsd: 1, pricingVersion: "t" } };
  await ledger.record(draft);
  await ledger.record(draft);
  const all = await ledger.listInternal(PROJECT);
  assert.equal(all.length, 2, "with no key, dedupe is impossible by design — never silently assumed");
});

test("MONEY CORRECTNESS: plain += drifts on repeated $0.01 charges — this is a real bug class, not a hypothetical", () => {
  let naive = 0;
  for (let i = 0; i < 10; i += 1) naive += 0.01;
  assert.notEqual(naive, 0.1, "demonstrates the float-drift bug sumUsd exists to fix");
});

test("MONEY CORRECTNESS: sumUsd is exact for accumulated drift where plain += is not", () => {
  assert.equal(sumUsd(Array(10).fill(0.01)), 0.1);
  assert.equal(sumUsd(Array(100).fill(0.01)), 1);
  assert.equal(sumUsd([]), 0);
  assert.equal(sumUsd([5]), 5);
});

test("MONEY CORRECTNESS: repeated $0.01 charges through the real ledger sum to EXACTLY $0.10, not a rounded-away approximation", async () => {
  const clock = new FixedClock(Date.now());
  const ledger = new UsageLedger(undefined, clock.now);
  for (let i = 0; i < 10; i += 1) {
    await ledger.record({ projectId: PROJECT, provider: "fake", model: "claude-sonnet-5", cost: { priced: true, amountUsd: 0.01, pricingVersion: "t" } });
  }
  const totals = await ledger.totals(OPERATOR, PROJECT, { dailySinceIso: new Date(0).toISOString(), monthlySinceIso: new Date(0).toISOString() });
  assert.equal(totals.monthly, 0.1, "exact equality, not a rounded comparison");
});

test("BUDGET POLICY STORE: only an admin may set a policy; view is project-scoped", async () => {
  const clock = new FixedClock(Date.now());
  const audit = new AuditLog();
  const store = new BudgetPolicyStore(undefined, clock.now, audit);
  await assert.rejects(
    store.set(OPERATOR, PROJECT, { warningThresholdPercent: 80, hardStop: true }),
    ExecutionDeniedError,
  );
  const saved = await store.set(ADMIN, PROJECT, { dailyLimitUsd: 5, warningThresholdPercent: 80, hardStop: true });
  assert.equal(saved.dailyLimitUsd, 5);
  assert.equal(saved.updatedBy, ADMIN.id);
  assert.ok(audit.query({ type: "budget_policy_set", projectId: PROJECT }).length >= 1);

  await assert.rejects(store.get(BETA_OPERATOR, PROJECT), ExecutionDeniedError);
  const viewed = await store.get(VIEWER, PROJECT);
  assert.equal(viewed?.dailyLimitUsd, 5);
});

test("BUDGET POLICY STORE: an invalid draft is rejected before anything is saved", async () => {
  const clock = new FixedClock(Date.now());
  const store = new BudgetPolicyStore(undefined, clock.now);
  await assert.rejects(store.set(ADMIN, PROJECT, { warningThresholdPercent: 0, hardStop: true }), ValidationError);
  await assert.rejects(store.set(ADMIN, PROJECT, { dailyLimitUsd: -1, warningThresholdPercent: 80, hardStop: true }), ValidationError);
  assert.equal(await store.getInternal(PROJECT), undefined);
});

/* ------------------------------------------------------------------ */
/* BudgetGovernedModelProvider — the real preflight gate                */
/* ------------------------------------------------------------------ */

function buildGoverned(clock: FixedClock, reply: ModelResponse | Error) {
  const policies = new BudgetPolicyStore(undefined, clock.now);
  const usage = new UsageLedger(undefined, clock.now);
  const enforcer = new BudgetEnforcer(policies, usage, clock.now);
  const inner = new FakeProvider(reply);
  const audit = new AuditLog();
  const governed = new BudgetGovernedModelProvider(inner, enforcer, usage, audit);
  return { policies, usage, enforcer, inner, audit, governed };
}

const REPLY: ModelResponse = { content: "ok", model: "claude-sonnet-5", usage: { inputTokens: 1000, outputTokens: 500 } };

test("GOVERNED PROVIDER: a request with no projectId is refused before any call is made", async () => {
  const clock = new FixedClock(Date.now());
  const { governed, inner } = buildGoverned(clock, REPLY);
  await assert.rejects(governed.generate({ messages: [{ role: "user", content: "hi" }] }), ValidationError);
  assert.equal(inner.calls, 0);
});

test("GOVERNED PROVIDER: no budget policy configured never blocks (NOT_CONFIGURED != unlimited, but also != blocked)", async () => {
  const clock = new FixedClock(Date.now());
  const { governed, inner, usage } = buildGoverned(clock, REPLY);
  const response = await governed.generate({ messages: [{ role: "user", content: "hi" }], metadata: { projectId: PROJECT } });
  assert.equal(response, REPLY);
  assert.equal(inner.calls, 1);
  const recorded = await usage.listInternal(PROJECT);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]!.cost.priced, true);
});

test("GOVERNED PROVIDER: a hard-stopped daily limit already reached blocks the call BEFORE the inner provider runs, and records no usage", async () => {
  const clock = new FixedClock(Date.now());
  const { governed, inner, usage, policies, audit } = buildGoverned(clock, REPLY);
  await policies.set(ADMIN, PROJECT, { dailyLimitUsd: 1, warningThresholdPercent: 80, hardStop: true });
  await usage.record({ projectId: PROJECT, provider: "fake", model: "claude-sonnet-5", cost: { priced: true, amountUsd: 1, pricingVersion: "t" } });

  await assert.rejects(
    governed.generate({ messages: [{ role: "user", content: "hi" }], metadata: { projectId: PROJECT } }),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionDeniedError);
      assert.equal((error as ExecutionDeniedError).code, "RESOURCE_LIMIT");
      return true;
    },
  );
  assert.equal(inner.calls, 0, "the inner provider must never be called once the gate blocks");
  const recorded = await usage.listInternal(PROJECT);
  assert.equal(recorded.length, 1, "only the seeded usage record exists — the blocked attempt recorded nothing");
  assert.equal(audit.query({ type: "budget_blocked", projectId: PROJECT }).length, 1);
});

test("GOVERNED PROVIDER: a non-hard-stop limit lets the call through and still records usage", async () => {
  const clock = new FixedClock(Date.now());
  const { governed, inner, usage, policies } = buildGoverned(clock, REPLY);
  await policies.set(ADMIN, PROJECT, { dailyLimitUsd: 1, warningThresholdPercent: 80, hardStop: false });
  await usage.record({ projectId: PROJECT, provider: "fake", model: "claude-sonnet-5", cost: { priced: true, amountUsd: 5, pricingVersion: "t" } });
  await governed.generate({ messages: [{ role: "user", content: "hi" }], metadata: { projectId: PROJECT } });
  assert.equal(inner.calls, 1);
});

test("GOVERNED PROVIDER: an unpriced model's usage is still recorded, honestly unpriced — never a fabricated cost", async () => {
  const clock = new FixedClock(Date.now());
  const { governed, usage } = buildGoverned(clock, { content: "ok", model: "totally-unlisted-model" });
  await governed.generate({ messages: [{ role: "user", content: "hi" }], metadata: { projectId: PROJECT } });
  const recorded = await usage.listInternal(PROJECT);
  assert.equal(recorded[0]!.cost.priced, false);
});

test("GOVERNED PROVIDER composed inside AuditedModelProvider: a budget denial still surfaces as model_execution_failed", async () => {
  const clock = new FixedClock(Date.now());
  const policies = new BudgetPolicyStore(undefined, clock.now);
  const usage = new UsageLedger(undefined, clock.now);
  const enforcer = new BudgetEnforcer(policies, usage, clock.now);
  const inner = new FakeProvider(REPLY);
  const audit = new AuditLog();
  await policies.set(ADMIN, PROJECT, { dailyLimitUsd: 0.0001, warningThresholdPercent: 80, hardStop: true });
  await usage.record({ projectId: PROJECT, provider: "fake", model: "claude-sonnet-5", cost: { priced: true, amountUsd: 1, pricingVersion: "t" } });
  const composed = new AuditedModelProvider(new BudgetGovernedModelProvider(inner, enforcer, usage, audit), audit);
  await assert.rejects(composed.generate({ messages: [{ role: "user", content: "hi" }], metadata: { projectId: PROJECT } }));
  assert.equal(audit.query({ type: "model_execution_failed", projectId: PROJECT }).length, 1);
  assert.equal(inner.calls, 0);
});

/* ------------------------------------------------------------------ */
/* Capabilities — connected vs capable, derived live                   */
/* ------------------------------------------------------------------ */

test("CAPABILITIES: enforcement is INERT with no registered provider, and flips live once one registers (no re-derivation)", () => {
  const registry = new ModelProviderRegistry();
  const caps = deriveCostCenterCapabilities({ providers: registry });
  assert.equal(caps.enforcement, false);
  assert.deepEqual(inertCostCenterCapabilities(caps), ["enforcement"]);

  registry.register("anthropic", () => new FakeProvider(REPLY));
  assert.equal(caps.enforcement, true, "the SAME caps object must read the registry live");
  assert.deepEqual(inertCostCenterCapabilities(caps), []);
  assert.deepEqual(caps.providerIds, ["anthropic"]);
});

/* ------------------------------------------------------------------ */
/* RuleAuditor — deterministic, rule-based, never model-assisted       */
/* ------------------------------------------------------------------ */

const EMPTY_INPUTS: AuditInputs = {
  releases: [],
  commits: [],
  verifications: [],
  sessions: [],
  usage: [],
  sourcesConnected: { verification: true, sourceControl: true },
};

test("AUDITOR: a clean project (nothing wired yet) raises no findings", () => {
  const clock = new FixedClock(Date.now());
  const auditor = new RuleAuditor(clock.now);
  const result = auditor.run(PROJECT, EMPTY_INPUTS);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.rulesRun.slice().sort(), [
    "high_risk_session_unapproved",
    "release_without_approval",
    "release_without_verification",
    "usage_unpriced",
  ]);
});

test("AUDITOR: UNKNOWN != VIOLATION — a release with no matching verification raises NOTHING when verification/source control is not even connected in this deployment", () => {
  const clock = new FixedClock(Date.now());
  const auditor = new RuleAuditor(clock.now);
  const release = {
    releaseId: "rel-1", projectId: PROJECT, candidateId: "c1", commitSha: "abc123", artifactDigests: [], targetId: "t1",
    targetClass: "production" as const, adapterId: "a1", adapterVersion: "1", approvalIds: ["ap-1"], releasePolicyVersion: 1,
    status: "deployed" as const, reasons: [], simulated: false, actor: "op-1", startedAt: clock.now(),
  };
  const notConnected = auditor.run(PROJECT, {
    ...EMPTY_INPUTS,
    releases: [release],
    sourcesConnected: { verification: false, sourceControl: false },
  });
  assert.deepEqual(
    notConnected.findings.filter((f) => f.ruleId === "release_without_verification"),
    [],
    "not connected must never be reported as a proven bypass",
  );
  // The SAME release, with sources connected, IS a real finding — proves the guard isn't just
  // silencing the rule outright.
  const connected = auditor.run(PROJECT, { ...EMPTY_INPUTS, releases: [release] });
  assert.equal(connected.findings.filter((f) => f.ruleId === "release_without_verification").length, 1);
});

test("AUDITOR: a real (non-simulated) release with no matching passed verification is a critical finding", () => {
  const clock = new FixedClock(Date.now());
  const auditor = new RuleAuditor(clock.now);
  const release = {
    releaseId: "rel-1", projectId: PROJECT, candidateId: "c1", commitSha: "abc123", artifactDigests: [], targetId: "t1",
    targetClass: "production" as const, adapterId: "a1", adapterVersion: "1", approvalIds: ["ap-1"], releasePolicyVersion: 1,
    status: "deployed" as const, reasons: [], simulated: false, actor: "op-1", startedAt: clock.now(),
  };
  const result = auditor.run(PROJECT, { ...EMPTY_INPUTS, releases: [release] });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.ruleId, "release_without_verification");
  assert.equal(result.findings[0]!.severity, "critical");
});

test("AUDITOR: a simulated release is never flagged — VISUALIZATION != EXECUTION", () => {
  const clock = new FixedClock(Date.now());
  const auditor = new RuleAuditor(clock.now);
  const release = {
    releaseId: "rel-1", projectId: PROJECT, candidateId: "c1", commitSha: "abc123", artifactDigests: [], targetId: "t1",
    targetClass: "production" as const, adapterId: "a1", adapterVersion: "1", approvalIds: [], releasePolicyVersion: 1,
    status: "deployed" as const, reasons: [], simulated: true, actor: "op-1", startedAt: clock.now(),
  };
  const result = auditor.run(PROJECT, { ...EMPTY_INPUTS, releases: [release] });
  assert.deepEqual(result.findings, []);
});

test("AUDITOR: a release with a passed verification for its own commit raises nothing", () => {
  const clock = new FixedClock(Date.now());
  const auditor = new RuleAuditor(clock.now);
  const commit = {
    receiptId: "c1", projectId: PROJECT, repositoryId: "r1", branch: "main", commitSha: "abc123", message: "m",
    stageSetId: "s1", changeSetId: "cs1", sourceFingerprint: "f1", verificationId: "v1", approvalIds: [], policyVersion: 1,
    actor: "op-1", createdAt: clock.now(),
  };
  const verification = {
    verificationId: "v1", projectId: PROJECT, plan: { planId: "p1", version: 1, executionPlanId: "p1@v1" }, sourceFingerprint: "f1",
    toolchains: [], isolation: "none_ran" as const, stages: [], artifactIds: [], status: "passed" as const, reasons: [],
    unverifiedStageIds: [], requestedBy: "op-1", createdAt: clock.now(),
  };
  const release = {
    releaseId: "rel-1", projectId: PROJECT, candidateId: "c1", commitSha: "abc123", artifactDigests: [], targetId: "t1",
    targetClass: "production" as const, adapterId: "a1", adapterVersion: "1", approvalIds: ["ap-1"], releasePolicyVersion: 1,
    status: "deployed" as const, reasons: [], simulated: false, actor: "op-1", startedAt: clock.now(),
  };
  const result = auditor.run(PROJECT, { ...EMPTY_INPUTS, releases: [release], commits: [commit], verifications: [verification] });
  assert.deepEqual(result.findings, []);
});

test("AUDITOR: a high-risk session with no recorded approval is a warning; low risk is never flagged", () => {
  const clock = new FixedClock(Date.now());
  const auditor = new RuleAuditor(clock.now);
  const base = {
    projectId: PROJECT, plan: { planId: "p1", planVersion: 1 }, stageId: "s1", stageKind: "build" as const,
    approvalIds: [], createdAt: clock.now(), attempts: [], limits: { sessionTimeoutMs: 1, operationTimeoutMs: 1, maxOutputBytes: 1, maxArtifactBytes: 1, maxToolCalls: 1 },
  };
  const high = { ...base, sessionId: "sess-high", risk: "high" as const };
  const low = { ...base, sessionId: "sess-low", risk: "low" as const };
  const result = auditor.run(PROJECT, { ...EMPTY_INPUTS, sessions: [high, low] as never });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.subjectId, "sess-high");
});

test("AUDITOR: unpriced usage raises one informational finding naming the affected model(s)", () => {
  const clock = new FixedClock(Date.now());
  const auditor = new RuleAuditor(clock.now);
  const usage = [{ usageId: "u1", projectId: PROJECT, provider: "fake", model: "mystery", cost: { priced: false as const, reason: "x" }, createdAt: clock.now() }];
  const result = auditor.run(PROJECT, { ...EMPTY_INPUTS, usage });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.ruleId, "usage_unpriced");
  assert.match(result.findings[0]!.detail, /mystery/);
});
