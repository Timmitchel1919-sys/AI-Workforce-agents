import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductionWorkforceBootstrap,
  PRODUCTION_WORKFORCE_CONFIGURATION,
  createMoneyMindProductionBinding,
  type ProductionWorkforceConfiguration,
} from "../api/index.js";
import { UnavailableMoneyMindRepo } from "../adapters/projects/money-mind/index.js";
import type { Agent, ToolDefinition } from "../contracts/index.js";

const agent: Agent = {
  id: "runtime-agent",
  name: "Runtime agent",
  description: "A controlled test executor binding.",
  capabilities: ["runtime_test"],
  allowedTools: ["runtime-tool"],
  allowedProjects: ["runtime-project"],
  supportedTaskTypes: ["runtime-task"],
  permissions: [],
};

const tool: ToolDefinition = {
  id: "runtime-tool",
  name: "Runtime tool",
  description: "A controlled test tool handler.",
  version: "1.0.0",
  capabilities: ["runtime_test"],
  requiredPermission: { action: "read" },
  allowedAgents: ["runtime-agent"],
  allowedProjects: ["runtime-project"],
  allowedEnvironments: ["local"],
  timeoutMs: 1_000,
  limits: {
    maxCallsPerTask: 1,
    maxCallsPerAgent: 1,
    maxDurationMs: 1_000,
    maxInputBytes: 1_000,
    maxOutputBytes: 1_000,
  },
  metadata: {},
};

function configuration(
  overrides: Partial<ProductionWorkforceConfiguration> = {},
): ProductionWorkforceConfiguration {
  return {
    agents: [{ definition: agent, executorKey: "runtime-executor" }],
    executorBindings: {
      "runtime-executor": { execute: async () => ({ ok: true }) },
    },
    tools: [{ definition: tool, handlerKey: "runtime-handler" }],
    toolHandlerBindings: { "runtime-handler": async () => ({ ok: true }) },
    projectAdapters: [],
    permissionGrants: [],
    ...overrides,
  };
}

test("production bootstrap validates and materializes trusted bindings", () => {
  const bootstrap = createProductionWorkforceBootstrap(configuration());
  assert.equal(bootstrap.agents.require(agent.id).id, agent.id);
  assert.equal(bootstrap.agentExecutors.has(agent.id), true);
  assert.equal(bootstrap.tools.require(tool.id).id, tool.id);
  assert.deepEqual(bootstrap.report, {
    agentCount: 1,
    executorCount: 1,
    toolCount: 1,
    toolHandlerCount: 1,
    projectAdapterCount: 0,
    operational: true,
  });
  assert.equal(Object.isFrozen(bootstrap.report), true);
});

test("the authoritative production configuration resolves only its real OpenAI binding", () => {
  const bootstrap = createProductionWorkforceBootstrap(
    PRODUCTION_WORKFORCE_CONFIGURATION,
  );
  assert.equal(bootstrap.report.agentCount, 1);
  assert.equal(bootstrap.report.toolCount, 0);
  assert.equal(bootstrap.report.operational, true);
  assert.equal(
    bootstrap.agents.require("control-plane-analysis-agent").name,
    "Control Plane Analysis Agent",
  );
  assert.equal(
    bootstrap.agentExecutors.has("control-plane-analysis-agent"),
    true,
  );
});

test("production registers exactly one real project: Money Mind, with an honest unavailable source", async () => {
  // Hermetic: never depends on the developer/CI MONEY_MIND_REPO_PATH.
  const bootstrap = createProductionWorkforceBootstrap({
    ...PRODUCTION_WORKFORCE_CONFIGURATION,
    projectAdapters: [createMoneyMindProductionBinding({})],
  });
  assert.equal(bootstrap.report.projectAdapterCount, 1);
  const project = bootstrap.projects.get("money-mind");
  assert.ok(project);
  assert.equal(project.displayName, "Money Mind");
  assert.equal(project.metadata?.sourceAvailable, false);
  // No checkout in the runtime: reads report absence, runs fail; nothing is faked.
  const adapter = bootstrap.projects.require("money-mind").adapter;
  const status = (await adapter.execute("READ_STATUS", {})) as {
    chapters: unknown[];
    featureFlags: unknown[];
  };
  assert.deepEqual(status.chapters, []);
  assert.deepEqual(status.featureFlags, []);
  await assert.rejects(
    () => adapter.execute("READ_FILE", { path: "docs/anything.md" }),
    /not found/i,
  );
  // Nothing can run: the runner reports the script as unavailable.
  const run = (await adapter.execute("RUN_TESTS", { script: "test" })) as {
    available: boolean;
  };
  assert.equal(run.available, false);
  // The existing production agent's project scope now refers to a real project.
  assert.ok(
    bootstrap.agents
      .require("control-plane-analysis-agent")
      .allowedProjects.every((id) => bootstrap.projects.has(id)),
  );
});

test("the unavailable repository never probes a filesystem path", async () => {
  const repo = new UnavailableMoneyMindRepo();
  assert.equal(await repo.exists(), false);
  assert.equal(await repo.hasScript("test" as never), false);
  await assert.rejects(() => repo.readTextFile(), /not available/i);
  await assert.rejects(() => repo.listDirectory(), /not available/i);
  await assert.rejects(
    () => repo.runScript("test" as never, 1000),
    /not available/i,
  );
});

test("a configured MONEY_MIND_REPO_PATH switches to the real filesystem backend", () => {
  const binding = createMoneyMindProductionBinding({
    MONEY_MIND_REPO_PATH: "/definitely/configured",
  });
  assert.equal(binding.metadata?.sourceAvailable, true);
});

test("production bootstrap rejects duplicate agent ids", () => {
  const duplicate = { ...agent };
  assert.throws(
    () =>
      createProductionWorkforceBootstrap(
        configuration({
          agents: [
            { definition: agent, executorKey: "runtime-executor" },
            { definition: duplicate, executorKey: "other-executor" },
          ],
          executorBindings: {
            "runtime-executor": { execute: async () => ({}) },
            "other-executor": { execute: async () => ({}) },
          },
        }),
      ),
    /duplicate agent id/,
  );
});

test("production bootstrap rejects unknown executor and tool-handler bindings", () => {
  assert.throws(
    () =>
      createProductionWorkforceBootstrap(
        configuration({
          agents: [{ definition: agent, executorKey: "missing" }],
        }),
      ),
    /unknown agent executor binding/,
  );
  assert.throws(
    () =>
      createProductionWorkforceBootstrap(
        configuration({ tools: [{ definition: tool, handlerKey: "missing" }] }),
      ),
    /unknown tool handler binding/,
  );
});

test("production bootstrap rejects dangling tool and agent references", () => {
  assert.throws(
    () =>
      createProductionWorkforceBootstrap(
        configuration({
          agents: [
            {
              definition: { ...agent, allowedTools: ["missing"] },
              executorKey: "runtime-executor",
            },
          ],
        }),
      ),
    /references unknown tool/,
  );
  assert.throws(
    () =>
      createProductionWorkforceBootstrap(
        configuration({
          tools: [
            {
              definition: { ...tool, allowedAgents: ["missing"] },
              handlerKey: "runtime-handler",
            },
          ],
        }),
      ),
    /references unknown agent/,
  );
});
