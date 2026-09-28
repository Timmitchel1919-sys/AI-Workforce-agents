import assert from "node:assert/strict";
import test from "node:test";

import {
  OpenAIModelProvider,
  OpenAIAgentExecutor,
  CONTROL_PLANE_ANALYSIS_AGENT_ID,
  mapOpenAIError,
  type OpenAIResponsesTransport,
} from "../api/index.js";
import {
  AuditLog,
  BudgetEnforcer,
  BudgetPolicyStore,
  GovernancePolicyEngine,
  GovernancePolicyStore,
  ModelCapabilityRegistry,
  ModelProviderRegistry,
  ModelRouter,
  UsageLedger,
} from "../core/index.js";
import {
  type Agent,
  type Task,
  AgentExecutionError,
  ProviderConfigError,
  ProviderTimeoutError,
} from "../contracts/index.js";

const agent: Agent = {
  id: CONTROL_PLANE_ANALYSIS_AGENT_ID,
  name: "Control Plane Analysis Agent",
  description: "Read-only analysis.",
  capabilities: ["control_plane_analysis"],
  allowedTools: [],
  allowedProjects: ["money-mind"],
  supportedTaskTypes: ["control-plane-analysis"],
  permissions: [],
  modelPolicy: { provider: "openai" },
};

function task(
  input: unknown = { objective: "Assess runtime readiness." },
): Task {
  return {
    id: "task_openai_test",
    type: "control-plane-analysis",
    description: "Assess runtime readiness.",
    projectId: "money-mind",
    priority: "normal",
    status: "running",
    input,
    errors: [],
    requiredPermissions: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function provider(transport: OpenAIResponsesTransport): OpenAIModelProvider {
  return new OpenAIModelProvider(
    { apiKey: "test-secret-not-real", model: "test-model", timeoutMs: 1_000 },
    { transport },
  );
}

/**
 * A real ModelRouter (no store — every profile is fresh each test). Seeds
 * "money-mind" with `allowUnknownCost: true`, mirroring what the production
 * composition root does for this SAME agent (it has no pre-call cost
 * estimate to offer yet — see ADR — so its target project explicitly allows
 * unknown cost; the real budget hard-stop still applies regardless).
 */
async function buildRouter(
  profileCapabilities: readonly ("reasoning" | "structured_output")[] = [
    "reasoning",
    "structured_output",
  ],
  registerProvider = true,
) {
  const clock = () => "2026-01-01T00:00:00.000Z";
  const profiles = new ModelCapabilityRegistry(
    profileCapabilities.length > 0
      ? [
          {
            id: "openai-default",
            providerId: "openai",
            capabilities: profileCapabilities,
          },
        ]
      : [],
  );
  const providers = new ModelProviderRegistry();
  if (registerProvider)
    providers.register("openai", () =>
      provider({
        async create() {
          throw new Error("unused");
        },
      }),
    );
  const budgetPolicies = new BudgetPolicyStore(undefined, clock);
  const usage = new UsageLedger(undefined, clock);
  const budget = new BudgetEnforcer(budgetPolicies, usage, clock);
  const governancePolicies = new GovernancePolicyStore(undefined, clock);
  await governancePolicies.setTrusted("money-mind", { allowUnknownCost: true });
  const governance = new GovernancePolicyEngine(
    governancePolicies,
    budget,
    clock,
  );
  return new ModelRouter(
    profiles,
    providers,
    governance,
    clock,
    undefined,
    undefined,
    budget,
    governancePolicies,
  );
}

test("OpenAI executor maps validated structured output and usage", async () => {
  const audit = new AuditLog();
  const executor = new OpenAIAgentExecutor({
    audit,
    clock: () => 0,
    provider: provider({
      async create(params) {
        assert.equal(params.model, "test-model");
        assert.equal(params.schema?.name, "control_plane_analysis");
        return {
          output_text: JSON.stringify({
            summary: "Runtime is ready for controlled composition.",
            findings: ["One bounded executor is configured."],
            risks: [],
            recommendations: ["Add a runtime composition root next."],
            confidence: "high",
          }),
          model: "test-model",
          usage: { input_tokens: 11, output_tokens: 22, total_tokens: 33 },
        };
      },
    }),
  });
  const result = await executor.execute(agent, task());
  assert.deepEqual(result, {
    taskId: "task_openai_test",
    agentId: CONTROL_PLANE_ANALYSIS_AGENT_ID,
    summary: "Runtime is ready for controlled composition.",
    findings: ["One bounded executor is configured."],
    risks: [],
    recommendations: ["Add a runtime composition root next."],
    confidence: "high",
    createdAt: new Date(0).toISOString(),
    metadata: {
      provider: "openai",
      model: "test-model",
      usage: { inputTokens: 11, outputTokens: 22, totalTokens: 33 },
      counters: { toolCalls: 0, modelCalls: 1, iterations: 1 },
    },
  });
  assert.equal(
    audit
      .list()
      .some(
        (event) =>
          event.agentId === CONTROL_PLANE_ANALYSIS_AGENT_ID &&
          event.data.kind === "model_result",
      ),
    true,
  );
});

test("OpenAI executor fails closed for malformed provider JSON", async () => {
  const executor = new OpenAIAgentExecutor({
    audit: new AuditLog(),
    provider: provider({
      async create() {
        return { output_text: "not-json" };
      },
    }),
  });
  await assert.rejects(
    () => executor.execute(agent, task()),
    (error: unknown) =>
      error instanceof AgentExecutionError && error.reason === "invalid_result",
  );
});

test("OpenAI executor normalizes provider timeouts and never exposes the API key", async () => {
  const executor = new OpenAIAgentExecutor({
    audit: new AuditLog(),
    provider: provider({
      async create() {
        throw new Error("APIConnectionTimeoutError test-secret-not-real");
      },
    }),
  });
  await assert.rejects(
    () => executor.execute(agent, task()),
    (error: unknown) =>
      error instanceof AgentExecutionError &&
      error.reason === "timeout" &&
      !error.message.includes("test-secret-not-real"),
  );
  const mapped = mapOpenAIError(
    new Error("test-secret-not-real unavailable"),
    "test-secret-not-real",
  );
  assert.equal(mapped.message.includes("test-secret-not-real"), false);
});

test("OpenAI provider configuration fails closed without a key or model", () => {
  assert.throws(
    () => new OpenAIModelProvider({}, { env: {} }),
    ProviderConfigError,
  );
  assert.throws(
    () => new OpenAIModelProvider({ apiKey: "safe-test" }, { env: {} }),
    ProviderConfigError,
  );
});

test("task input cannot select a tool or override the executor binding", async () => {
  const executor = new OpenAIAgentExecutor({
    audit: new AuditLog(),
    provider: provider({
      async create() {
        return {
          output_text: JSON.stringify({
            summary: "ok",
            findings: [],
            risks: [],
            recommendations: [],
            confidence: "low",
          }),
        };
      },
    }),
  });
  const result = (await executor.execute(
    agent,
    task({ objective: "Analyze", tool: "shell", executorKey: "evil" }),
  )) as { metadata: { counters: { toolCalls: number } } };
  assert.equal(result.metadata.counters.toolCalls, 0);
});

test("EO-7: with a router configured, an unavailable provider fails closed BEFORE the OpenAI transport is ever called", async () => {
  let calls = 0;
  const router = await buildRouter(["reasoning", "structured_output"], false); // provider never registered
  const executor = new OpenAIAgentExecutor({
    audit: new AuditLog(),
    router,
    provider: provider({
      async create() {
        calls += 1;
        throw new Error("must never be reached");
      },
    }),
  });
  await assert.rejects(
    () => executor.execute(agent, task()),
    (error: unknown) =>
      error instanceof AgentExecutionError &&
      error.reason === "model_unavailable",
  );
  assert.equal(
    calls,
    0,
    "the provider must never be invoked once routing finds no qualified candidate",
  );
});

test("EO-7: with a router configured and a qualified candidate, the result carries the routing decision and the requested model", async () => {
  const router = await buildRouter();
  const executor = new OpenAIAgentExecutor({
    audit: new AuditLog(),
    clock: () => 0,
    router,
    provider: provider({
      async create() {
        return {
          output_text: JSON.stringify({
            summary: "ok",
            findings: [],
            risks: [],
            recommendations: [],
            confidence: "low",
          }),
          model: "test-model",
        };
      },
    }),
  });
  const result = (await executor.execute(agent, task())) as {
    metadata: {
      routingDecisionId?: string;
      requestedModel?: string;
      model: string;
    };
  };
  assert.ok(
    result.metadata.routingDecisionId,
    "a real routing decision id is attached",
  );
  // The registered profile has no PINNED model (matches any model this provider serves), so
  // requestedModel is honestly absent — never a fabricated echo of the actual model.
  assert.equal(result.metadata.requestedModel, undefined);
  assert.equal(result.metadata.model, "test-model");
});

test("EO-7: REQUESTED MODEL != ACTUAL MODEL — a routed, pinned model that differs from what the provider actually reports is recorded as a real, auditable mismatch", async () => {
  const clock = () => "2026-01-01T00:00:00.000Z";
  const profiles = new ModelCapabilityRegistry([
    {
      id: "pinned",
      providerId: "openai",
      model: "requested-model",
      capabilities: ["reasoning", "structured_output"],
    },
  ]);
  const providers = new ModelProviderRegistry();
  providers.register("openai", () =>
    provider({
      async create() {
        throw new Error("unused");
      },
    }),
  );
  const budgetPolicies = new BudgetPolicyStore(undefined, clock);
  const usage = new UsageLedger(undefined, clock);
  const budget = new BudgetEnforcer(budgetPolicies, usage, clock);
  const governancePolicies = new GovernancePolicyStore(undefined, clock);
  await governancePolicies.setTrusted("money-mind", { allowUnknownCost: true });
  const governance = new GovernancePolicyEngine(
    governancePolicies,
    budget,
    clock,
  );
  const router = new ModelRouter(
    profiles,
    providers,
    governance,
    clock,
    undefined,
    undefined,
    budget,
    governancePolicies,
  );

  const audit = new AuditLog();
  const executor = new OpenAIAgentExecutor({
    audit,
    clock: () => 0,
    router,
    provider: provider({
      async create() {
        return {
          output_text: JSON.stringify({
            summary: "ok",
            findings: [],
            risks: [],
            recommendations: [],
            confidence: "low",
          }),
          model: "actual-model", // the provider reports something OTHER than what was requested
        };
      },
    }),
  });
  const result = (await executor.execute(agent, task())) as {
    metadata: { requestedModel?: string; model: string };
  };
  assert.equal(result.metadata.requestedModel, "requested-model");
  assert.equal(result.metadata.model, "actual-model");
  assert.ok(
    audit
      .list()
      .some(
        (event) =>
          event.data.kind === "model_mismatch" &&
          event.data.requestedModel === "requested-model" &&
          event.data.actualModel === "actual-model",
      ),
    "the mismatch itself must be recorded in the audit trail, not silently absorbed",
  );
});

test("EO-7: without a router configured, behavior is exactly as before — unrouted, backward compatible", async () => {
  const executor = new OpenAIAgentExecutor({
    audit: new AuditLog(),
    clock: () => 0,
    provider: provider({
      async create() {
        return {
          output_text: JSON.stringify({
            summary: "ok",
            findings: [],
            risks: [],
            recommendations: [],
            confidence: "low",
          }),
          model: "test-model",
        };
      },
    }),
  });
  const result = (await executor.execute(agent, task())) as {
    metadata: { routingDecisionId?: string; requestedModel?: string };
  };
  assert.equal(result.metadata.routingDecisionId, undefined);
  assert.equal(result.metadata.requestedModel, undefined);
});

test("EO-7: with a usageLedger configured, a real successful call is recorded into the Cost Center, and retrying the SAME task never double-charges it", async () => {
  const clock = () => "2026-01-01T00:00:00.000Z";
  const usageLedger = new UsageLedger(undefined, clock);
  const executor = new OpenAIAgentExecutor({
    audit: new AuditLog(),
    clock: () => 0,
    usageLedger,
    provider: provider({
      async create() {
        return {
          output_text: JSON.stringify({
            summary: "ok",
            findings: [],
            risks: [],
            recommendations: [],
            confidence: "low",
          }),
          model: "test-model",
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        };
      },
    }),
  });
  await executor.execute(agent, task());
  await executor.execute(agent, task()); // same task id — a retry, not a second real call
  const recorded = await usageLedger.listInternal("money-mind");
  assert.equal(
    recorded.length,
    1,
    "the same task id must never be billed twice",
  );
  assert.equal(recorded[0]!.provider, "openai");
  assert.equal(recorded[0]!.model, "test-model");
  assert.equal(recorded[0]!.inputTokens, 10);
});

void ProviderTimeoutError;
