/**
 * Phase 6 §17 "INTEGRATION" category: each of the three tool-eligible agents
 * (Research, Project Manager, QA — Developer mirrors QA) actually reaching
 * Money Mind through the real `ToolExecutionEngine`. Research is exercised
 * through its normal, unmodified pipeline (money-mind.read-docs /
 * money-mind.read-file wired as its search/fetch tools); Project Manager and
 * QA have no tool-calling step in their own `run()` in this phase (Phase 5's
 * design — see ADR-0007 decision 4), so their granted eligibility is proven
 * directly against the engine, the same boundary their tool calls would go
 * through if a future phase adds one.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentExecutionError,
  AuditLog,
  ApprovalSystem,
  ContextSystem,
  PermissionSystem,
  ToolExecutionEngine,
  ToolRegistry,
  validateResearchResult,
  MONEY_MIND_PROJECT_ID,
  type ModelProvider,
  type ModelRequest,
  type Task,
} from "../core/index.js";
import {
  InMemoryMoneyMindRepo,
  MoneyMindProjectAdapter,
  MONEY_MIND_TOOL_IDS,
  makeMoneyMindTools,
  moneyMindGrants,
  MONEY_MIND_DEFAULT_AGENT_IDS,
} from "../adapters/index.js";
import { ResearchAgent, RESEARCH_AGENT_ID } from "../agents/research/index.js";

const PM = MONEY_MIND_DEFAULT_AGENT_IDS.projectManager;
const DEVELOPER = MONEY_MIND_DEFAULT_AGENT_IDS.developer;
const QA = MONEY_MIND_DEFAULT_AGENT_IDS.qa;

function scriptedModel(id: string, responses: string[]): ModelProvider {
  let i = 0;
  return {
    id,
    async generate(_request: ModelRequest) {
      const content = responses[Math.min(i, responses.length - 1)] ?? "{}";
      i += 1;
      return { content, model: id };
    },
  };
}

function wire() {
  const repo = new InMemoryMoneyMindRepo();
  const adapter = new MoneyMindProjectAdapter({ repo });
  const tools = makeMoneyMindTools(adapter);

  const audit = new AuditLog();
  const approvals = new ApprovalSystem();
  const permissions = new PermissionSystem([
    ...moneyMindGrants(RESEARCH_AGENT_ID),
    ...moneyMindGrants(PM),
    ...moneyMindGrants(DEVELOPER),
    ...moneyMindGrants(QA),
  ]);
  const toolRegistry = new ToolRegistry(audit);
  for (const tool of Object.values(tools)) toolRegistry.register(tool);
  const engine = new ToolExecutionEngine({
    registry: toolRegistry,
    permissions,
    approvals,
    audit,
  });
  const context = new ContextSystem();

  return {
    repo,
    adapter,
    tools,
    audit,
    approvals,
    permissions,
    toolRegistry,
    engine,
    context,
  };
}

function makeResearchTask(over: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    type: "research",
    description: "research money mind",
    projectId: MONEY_MIND_PROJECT_ID,
    priority: "normal",
    status: "running",
    input: {
      objective: "Understand the current Money Mind V2 development state",
      question: "What V2 layers are implemented and is there a test suite?",
      constraints: [],
      outputFormat: "structured",
      sourcesRequired: 1,
      metadata: {},
    },
    errors: [],
    requiredPermissions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* Research Agent -> Money Mind (real, unmodified pipeline)           */
/* ------------------------------------------------------------------ */

test("integration: Research Agent -> Money Mind produces a grounded, validated ResearchResult", async () => {
  const { engine, context } = wire();

  const plan = JSON.stringify({
    subQuestions: ["What V2 layers are implemented?", "Is there a test suite?"],
    searchQueries: ["V2 status"],
  });
  const synthesis = JSON.stringify({
    executiveSummary:
      "All six V2 layers are implemented and validated; no automated test " +
      "suite is configured yet.",
    findings: [
      {
        statement: "V2 layers 1 through 6 are implemented and validated.",
        kind: "fact",
        sourceIds: ["src_1"],
      },
      {
        statement: "No automated npm test script is defined.",
        kind: "fact",
        sourceIds: ["src_1"],
      },
    ],
    assumptions: [],
    limitations: [],
    recommendations: ["Add an automated test suite before further V2 work."],
  });

  const research = new ResearchAgent({
    model: scriptedModel("research-model", [plan, synthesis]),
    toolEngine: engine,
    context,
    audit: new AuditLog(),
    searchToolId: MONEY_MIND_TOOL_IDS.readDocs,
    fetchToolId: MONEY_MIND_TOOL_IDS.readFile,
  });

  const task = makeResearchTask();
  const output = await research.execute(
    {
      id: RESEARCH_AGENT_ID,
      name: "Research Agent",
      description: "",
      capabilities: [],
      allowedTools: [],
      allowedProjects: [MONEY_MIND_PROJECT_ID],
      supportedTaskTypes: ["research"],
      permissions: [],
    },
    task,
    undefined,
  );

  validateResearchResult(output);
  const result = output as unknown as {
    sources: { verified: boolean }[];
    findings: { statement: string }[];
  };
  assert.ok(result.sources.length > 0);
  assert.ok(result.sources.some((s) => s.verified));
  assert.ok(result.findings.some((f) => f.statement.includes("V2 layers")));
});

test("integration: Research Agent is denied if not granted money-mind.read-docs", async () => {
  const repo = new InMemoryMoneyMindRepo();
  const adapter = new MoneyMindProjectAdapter({ repo });
  const tools = makeMoneyMindTools(adapter);
  const audit = new AuditLog();
  // deliberately grant nothing this time.
  const permissions = new PermissionSystem([]);
  const toolRegistry = new ToolRegistry(audit);
  for (const tool of Object.values(tools)) toolRegistry.register(tool);
  const engine = new ToolExecutionEngine({
    registry: toolRegistry,
    permissions,
    audit,
  });
  const context = new ContextSystem();

  const research = new ResearchAgent({
    model: scriptedModel("research-model", [
      JSON.stringify({ subQuestions: ["x"], searchQueries: ["x"] }),
    ]),
    toolEngine: engine,
    context,
    audit,
    searchToolId: MONEY_MIND_TOOL_IDS.readDocs,
    fetchToolId: MONEY_MIND_TOOL_IDS.readFile,
  });

  await assert.rejects(
    () =>
      research.execute(
        {
          id: RESEARCH_AGENT_ID,
          name: "Research Agent",
          description: "",
          capabilities: [],
          allowedTools: [],
          allowedProjects: [MONEY_MIND_PROJECT_ID],
          supportedTaskTypes: ["research"],
          permissions: [],
        },
        makeResearchTask(),
        undefined,
      ),
    (error: unknown) => {
      assert.ok(error instanceof AgentExecutionError);
      assert.equal(error.reason, "permission_denied");
      return true;
    },
  );
});

/* ------------------------------------------------------------------ */
/* Project Manager -> Money Mind (granted eligibility, engine-level)  */
/* ------------------------------------------------------------------ */

test("integration: Project Manager is eligible for status + project metadata, nothing else", async () => {
  const { engine } = wire();

  const status = await engine.execute(
    engine.createRequest({
      taskId: "t",
      agentId: PM,
      projectId: MONEY_MIND_PROJECT_ID,
      toolId: MONEY_MIND_TOOL_IDS.status,
      input: {},
    }),
  );
  assert.equal(status.status, "success");

  const project = await engine.execute(
    engine.createRequest({
      taskId: "t",
      agentId: PM,
      projectId: MONEY_MIND_PROJECT_ID,
      toolId: MONEY_MIND_TOOL_IDS.readProject,
      input: {},
    }),
  );
  assert.equal(project.status, "success");

  const forbidden = await engine.execute(
    engine.createRequest({
      taskId: "t",
      agentId: PM,
      projectId: MONEY_MIND_PROJECT_ID,
      toolId: MONEY_MIND_TOOL_IDS.readFile,
      input: { path: "README.md" },
    }),
  );
  assert.equal(forbidden.status, "denied");
  assert.equal(forbidden.error?.reason, "agent_not_allowed");
});

/* ------------------------------------------------------------------ */
/* Developer / QA -> Money Mind (granted eligibility, engine-level)   */
/* ------------------------------------------------------------------ */

test("integration: Developer is eligible for inspect / read / test", async () => {
  const { engine, repo } = wire();

  const inspect = await engine.execute(
    engine.createRequest({
      taskId: "t",
      agentId: DEVELOPER,
      projectId: MONEY_MIND_PROJECT_ID,
      toolId: MONEY_MIND_TOOL_IDS.inspect,
      input: {},
    }),
  );
  assert.equal(inspect.status, "success");

  const readFile = await engine.execute(
    engine.createRequest({
      taskId: "t",
      agentId: DEVELOPER,
      projectId: MONEY_MIND_PROJECT_ID,
      toolId: MONEY_MIND_TOOL_IDS.readFile,
      input: { path: "package.json" },
    }),
  );
  assert.equal(readFile.status, "success");

  const gated = await engine.execute(
    engine.createRequest({
      taskId: "t",
      agentId: DEVELOPER,
      projectId: MONEY_MIND_PROJECT_ID,
      toolId: MONEY_MIND_TOOL_IDS.test,
      input: { script: "build" },
    }),
  );
  assert.equal(gated.status, "approval_required");
  assert.equal(repo.runCalls.length, 0);
});

test("integration: QA is eligible for inspect / read / test, denied money-mind.read-docs", async () => {
  const { engine } = wire();

  const inspect = await engine.execute(
    engine.createRequest({
      taskId: "t",
      agentId: QA,
      projectId: MONEY_MIND_PROJECT_ID,
      toolId: MONEY_MIND_TOOL_IDS.inspect,
      input: {},
    }),
  );
  assert.equal(inspect.status, "success");

  const readTestResults = await engine.execute(
    engine.createRequest({
      taskId: "t",
      agentId: QA,
      projectId: MONEY_MIND_PROJECT_ID,
      toolId: MONEY_MIND_TOOL_IDS.readTestResults,
      input: {},
    }),
  );
  assert.equal(readTestResults.status, "success");
  assert.equal(
    (readTestResults.output as { testsConfigured: boolean }).testsConfigured,
    false,
  );

  const denied = await engine.execute(
    engine.createRequest({
      taskId: "t",
      agentId: QA,
      projectId: MONEY_MIND_PROJECT_ID,
      toolId: MONEY_MIND_TOOL_IDS.readDocs,
      input: { query: "status" },
    }),
  );
  assert.equal(denied.status, "denied");
});
