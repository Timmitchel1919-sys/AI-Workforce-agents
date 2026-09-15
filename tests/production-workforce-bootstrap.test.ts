import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductionWorkforceBootstrap,
  PRODUCTION_WORKFORCE_CONFIGURATION,
  type ProductionWorkforceConfiguration,
} from "../api/index.js";
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

test("the authoritative production configuration has no implicit test capability", () => {
  const bootstrap = createProductionWorkforceBootstrap(
    PRODUCTION_WORKFORCE_CONFIGURATION,
  );
  assert.equal(bootstrap.report.agentCount, 0);
  assert.equal(bootstrap.report.toolCount, 0);
  assert.equal(bootstrap.report.operational, false);
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
