/**
 * EO-8 — `RoutedModelProvider`: the `ModelProvider` decorator generalizing
 * EO-7's routing/metering pipeline to any plain-`ModelProvider`-based agent.
 *
 * SELECTED != EXECUTED · REQUESTED MODEL != ACTUAL MODEL · UNKNOWN COST != ZERO COST
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ProviderUnavailableError,
  ValidationError,
  type Agent,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from "../contracts/index.js";
import {
  ApprovalSystem,
  AuditLog,
  BudgetEnforcer,
  BudgetPolicyStore,
  GovernancePolicyEngine,
  GovernancePolicyStore,
  InMemoryExecutionRecordStore,
  ModelCapabilityRegistry,
  ModelProviderRegistry,
  ModelRouter,
  RoutedModelProvider,
  UsageLedger,
} from "../core/index.js";
import { ADMIN } from "./fixtures/execution.js";

const PROJECT = "alpha";

class FixedClock {
  constructor(private isoMs: number) {}
  now = () => new Date(this.isoMs).toISOString();
}

const AGENT: Agent = {
  id: "test-specialist",
  name: "Test Specialist",
  description: "d",
  capabilities: [],
  allowedTools: [],
  allowedProjects: [],
  supportedTaskTypes: [],
  permissions: [],
  modelPolicy: { provider: "openai" },
};

async function build(
  clock: FixedClock,
  options: { registeredProviders?: string[] } = {},
) {
  const store = new InMemoryExecutionRecordStore();
  const profiles = new ModelCapabilityRegistry([
    {
      id: "openai-default",
      providerId: "openai",
      capabilities: ["reasoning", "structured_output"],
    },
  ]);
  const providers = new ModelProviderRegistry();
  for (const id of options.registeredProviders ?? ["openai"])
    providers.register(id, () => ({
      id,
      generate: async () => ({ content: "", model: id }),
    }));
  const budgetPolicies = new BudgetPolicyStore(store, clock.now);
  const usage = new UsageLedger(store, clock.now);
  const budget = new BudgetEnforcer(budgetPolicies, usage, clock.now);
  const governancePolicies = new GovernancePolicyStore(store, clock.now);
  // RoutedModelProvider never supplies estimatedUsd (no per-call cost estimator exists — same
  // ADR-0029 rationale as OpenAIAgentExecutor), so the default fail-closed unknown-cost policy is
  // pre-relaxed for THIS project here, mirroring production's `setTrusted("money-mind", ...)`.
  await governancePolicies.setTrusted(PROJECT, { allowUnknownCost: true });
  const approvals = new ApprovalSystem();
  const governance = new GovernancePolicyEngine(
    governancePolicies,
    budget,
    clock.now,
    approvals,
  );
  const router = new ModelRouter(
    profiles,
    providers,
    governance,
    clock.now,
    store,
    undefined,
    budget,
    governancePolicies,
  );
  return { store, usage, governancePolicies, router };
}

class CountingProvider implements ModelProvider {
  calls = 0;
  constructor(
    readonly id: string,
    private readonly model: string = "gpt-x",
  ) {}
  async generate(_request: ModelRequest): Promise<ModelResponse> {
    this.calls += 1;
    return {
      content: "{}",
      model: this.model,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };
  }
}

const requestFor = (taskId: string, projectId = PROJECT): ModelRequest => ({
  messages: [{ role: "user", content: "hi" }],
  metadata: { taskId, agentId: AGENT.id, projectId },
});

test("ROUTED PROVIDER: a denied routing outcome throws ProviderUnavailableError BEFORE the inner provider is ever called — SELECTED != EXECUTED", async () => {
  const clock = new FixedClock(Date.now());
  const { router, governancePolicies } = await build(clock);
  await governancePolicies.set(ADMIN, PROJECT, {
    allowedProviders: ["anthropic"],
    allowUnknownCost: true,
  });
  const inner = new CountingProvider("openai");
  const provider = new RoutedModelProvider({
    inner,
    router,
    agent: AGENT,
    requirement: { requiredCapabilities: ["reasoning"] },
  });
  await assert.rejects(
    provider.generate(requestFor("t1")),
    ProviderUnavailableError,
  );
  assert.equal(
    inner.calls,
    0,
    "the inner provider must never be called once routing has denied the request",
  );
});

test("ROUTED PROVIDER: PROVIDER_UNAVAILABLE (no real provider registered) also throws before any call", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = await build(clock, { registeredProviders: [] });
  const inner = new CountingProvider("openai");
  const provider = new RoutedModelProvider({
    inner,
    router,
    agent: AGENT,
    requirement: { requiredCapabilities: ["reasoning"] },
  });
  await assert.rejects(
    provider.generate(requestFor("t1")),
    ProviderUnavailableError,
  );
  assert.equal(inner.calls, 0);
});

test("ROUTED PROVIDER: a qualified, routed request reaches the inner provider exactly once and returns its response unchanged", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = await build(clock);
  const inner = new CountingProvider("openai", "gpt-real");
  const provider = new RoutedModelProvider({
    inner,
    router,
    agent: AGENT,
    requirement: { requiredCapabilities: ["reasoning"] },
  });
  const response = await provider.generate(requestFor("t1"));
  assert.equal(inner.calls, 1);
  assert.equal(response.model, "gpt-real");
  assert.equal(provider.id, "openai");
});

test("ROUTED PROVIDER: missing projectId/taskId metadata fails closed with ValidationError, never routes on an empty string", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = await build(clock);
  const inner = new CountingProvider("openai");
  const provider = new RoutedModelProvider({
    inner,
    router,
    agent: AGENT,
    requirement: { requiredCapabilities: ["reasoning"] },
  });
  await assert.rejects(
    provider.generate({ messages: [], metadata: { taskId: "t1" } }),
    ValidationError,
  );
  await assert.rejects(
    provider.generate({ messages: [], metadata: { projectId: PROJECT } }),
    ValidationError,
  );
  assert.equal(inner.calls, 0);
});

test("ROUTED PROVIDER: a successful call records real usage, keyed by taskId (idempotent across a retried task)", async () => {
  const clock = new FixedClock(Date.now());
  const { router, usage } = await build(clock);
  const inner = new CountingProvider("openai", "gpt-real");
  const provider = new RoutedModelProvider({
    inner,
    router,
    agent: AGENT,
    requirement: { requiredCapabilities: ["reasoning"] },
    usageLedger: usage,
  });
  await provider.generate(requestFor("t1"));
  await provider.generate(requestFor("t1")); // a retry of the SAME task
  const recorded = await usage.listInternal(PROJECT);
  assert.equal(
    recorded.length,
    1,
    "the same taskId must never double-record usage",
  );
  assert.equal(recorded[0]!.inputTokens, 10);
});

test("ROUTED PROVIDER: two DIFFERENT tasks record two separate usage entries", async () => {
  const clock = new FixedClock(Date.now());
  const { router, usage } = await build(clock);
  const inner = new CountingProvider("openai", "gpt-real");
  const provider = new RoutedModelProvider({
    inner,
    router,
    agent: AGENT,
    requirement: { requiredCapabilities: ["reasoning"] },
    usageLedger: usage,
  });
  await provider.generate(requestFor("t1"));
  await provider.generate(requestFor("t2"));
  const recorded = await usage.listInternal(PROJECT);
  assert.equal(recorded.length, 2);
});

test("ROUTED PROVIDER: no usageLedger supplied — the call still succeeds, nothing is recorded (backward-compatible, additive)", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = await build(clock);
  const inner = new CountingProvider("openai", "gpt-real");
  const provider = new RoutedModelProvider({
    inner,
    router,
    agent: AGENT,
    requirement: { requiredCapabilities: ["reasoning"] },
  });
  const response = await provider.generate(requestFor("t1"));
  assert.equal(response.model, "gpt-real");
});

test("ROUTED PROVIDER: REQUESTED MODEL != ACTUAL MODEL — a mismatch between the router's selection and what the provider actually returned is audited", async () => {
  const clock = new FixedClock(Date.now());
  const store = new InMemoryExecutionRecordStore();
  const profiles = new ModelCapabilityRegistry([
    {
      id: "openai-pinned",
      providerId: "openai",
      model: "gpt-pinned",
      capabilities: ["reasoning"],
    },
  ]);
  const providers = new ModelProviderRegistry();
  providers.register("openai", () => ({
    id: "openai",
    generate: async () => ({ content: "", model: "openai" }),
  }));
  const budgetPolicies = new BudgetPolicyStore(store, clock.now);
  const usage = new UsageLedger(store, clock.now);
  const budget = new BudgetEnforcer(budgetPolicies, usage, clock.now);
  const governancePolicies = new GovernancePolicyStore(store, clock.now);
  await governancePolicies.setTrusted(PROJECT, { allowUnknownCost: true });
  const governance = new GovernancePolicyEngine(
    governancePolicies,
    budget,
    clock.now,
    new ApprovalSystem(),
  );
  const router = new ModelRouter(
    profiles,
    providers,
    governance,
    clock.now,
    store,
    undefined,
    budget,
    governancePolicies,
  );
  const audit = new AuditLog();
  const inner = new CountingProvider("openai", "gpt-actually-served"); // != "gpt-pinned"
  const provider = new RoutedModelProvider({
    inner,
    router,
    agent: AGENT,
    requirement: { requiredCapabilities: ["reasoning"] },
    audit,
  });
  await provider.generate(requestFor("t1"));
  const mismatches = audit
    .query({ type: "agent_activity", taskId: "t1" })
    .filter((e) => (e.data as { kind?: string }).kind === "model_mismatch");
  assert.equal(mismatches.length, 1);
  assert.equal(
    (mismatches[0]!.data as { requestedModel?: string }).requestedModel,
    "gpt-pinned",
  );
  assert.equal(
    (mismatches[0]!.data as { actualModel?: string }).actualModel,
    "gpt-actually-served",
  );
});

test("ROUTED PROVIDER: no mismatch is recorded when the router selected no SPECIFIC model (an unpinned profile accepts whatever the provider serves)", async () => {
  const clock = new FixedClock(Date.now());
  const { router } = await build(clock); // "openai-default" profile has no `model` pinned
  const audit = new AuditLog();
  const inner = new CountingProvider("openai", "whatever-the-provider-served");
  const provider = new RoutedModelProvider({
    inner,
    router,
    agent: AGENT,
    requirement: { requiredCapabilities: ["reasoning"] },
    audit,
  });
  await provider.generate(requestFor("t1"));
  const mismatches = audit
    .query({ type: "agent_activity", taskId: "t1" })
    .filter((e) => (e.data as { kind?: string }).kind === "model_mismatch");
  assert.equal(mismatches.length, 0);
});
