import assert from "node:assert/strict";
import test from "node:test";

import {
  OpenAIModelProvider,
  OpenAIAgentExecutor,
  CONTROL_PLANE_ANALYSIS_AGENT_ID,
  mapOpenAIError,
  type OpenAIResponsesTransport,
} from "../api/index.js";
import { AuditLog } from "../core/index.js";
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

void ProviderTimeoutError;
