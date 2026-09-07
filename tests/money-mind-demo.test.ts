/**
 * Phase 6 §12 demonstration: one deterministic, fully offline run of
 *
 *   "Inspect the current Money Mind V2 development state and report what is
 *    complete, what tests exist, and what should be worked on next."
 *
 *   Project Manager -> [Money Mind via Research] -> Research -> QA -> Project
 *   Manager -> Structured Report
 *
 * Every model call is a local stub and every Money Mind read goes through
 * `InMemoryMoneyMindRepo` — no real Anthropic API and no real Money Mind
 * repository, network, or filesystem access. Money Mind is never modified
 * (every capability used here is read-only).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  ContextSystem,
  HandoffSystem,
  Orchestrator,
  PermissionSystem,
  RoutingAgentExecutor,
  TaskSystem,
  ToolExecutionEngine,
  ToolRegistry,
  WorkflowEngine,
  WorkflowSystem,
  validateQAResult,
  MONEY_MIND_PROJECT_ID,
  type ModelProvider,
  type ModelRequest,
} from "../core/index.js";
import {
  InMemoryMoneyMindRepo,
  MoneyMindProjectAdapter,
  MONEY_MIND_TOOL_IDS,
  makeMoneyMindTools,
  moneyMindGrants,
} from "../adapters/index.js";
import {
  ResearchAgent,
  RESEARCH_AGENT_ID,
  makeResearchAgentDefinition,
  researchAgentGrants,
} from "../agents/research/index.js";
import {
  ProjectManagerAgent,
  PROJECT_MANAGER_AGENT_ID,
  makeProjectManagerAgentDefinition,
  projectManagerGrants,
} from "../agents/project-manager/index.js";
import {
  QaAgent,
  QA_AGENT_ID,
  makeQaAgentDefinition,
  qaGrants,
} from "../agents/qa/index.js";

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

test("demonstration: Project Manager -> Money Mind (Research) -> QA -> Project Manager -> Completed", async () => {
  const PROJECT_ID = MONEY_MIND_PROJECT_ID;

  /* ---------------- Money Mind adapter + tools (read-only, in-memory) --- */

  const repo = new InMemoryMoneyMindRepo();
  const mmAdapter = new MoneyMindProjectAdapter({ repo });
  const mmTools = makeMoneyMindTools(mmAdapter);

  /* ---------------- registry + permissions ------------------------------ */

  const registry = new AgentRegistry();
  registry.register(
    makeProjectManagerAgentDefinition({
      allowedProjects: [PROJECT_ID],
      extraAllowedTools: [
        MONEY_MIND_TOOL_IDS.status,
        MONEY_MIND_TOOL_IDS.readProject,
      ],
    }),
  );
  registry.register(
    makeResearchAgentDefinition({
      allowedProjects: [PROJECT_ID],
      extraAllowedTools: [
        MONEY_MIND_TOOL_IDS.readDocs,
        MONEY_MIND_TOOL_IDS.readFile,
        MONEY_MIND_TOOL_IDS.inspect,
        MONEY_MIND_TOOL_IDS.status,
      ],
    }),
  );
  registry.register(makeQaAgentDefinition({ allowedProjects: [PROJECT_ID] }));

  const permissions = new PermissionSystem([
    ...projectManagerGrants(),
    ...researchAgentGrants(),
    ...qaGrants(),
    ...moneyMindGrants(PROJECT_MANAGER_AGENT_ID),
    ...moneyMindGrants(RESEARCH_AGENT_ID),
  ]);

  /* ---------------- shared services -------------------------------------- */

  const audit = new AuditLog();
  const approvals = new ApprovalSystem();
  const context = new ContextSystem();
  context.setProjectContext(PROJECT_ID, { repository: "money-mind" });

  /* ---------------- tool registry + engine (Money Mind tools only) ------- */

  const toolRegistry = new ToolRegistry(audit);
  for (const tool of Object.values(mmTools)) toolRegistry.register(tool);
  const toolEngine = new ToolExecutionEngine({
    registry: toolRegistry,
    permissions,
    approvals,
    audit,
  });

  /* ---------------- scripted (offline) agents ----------------------------- */

  const pmDecompose = JSON.stringify({
    summary:
      "Inspect Money Mind's V2 development state and report what is complete, " +
      "what tests exist, and what to work on next.",
    subtasks: [
      {
        id: "research-money-mind",
        type: "research",
        description: "Inspect the Money Mind V2 development state",
        recommendedAgentId: RESEARCH_AGENT_ID,
        dependsOn: [],
        acceptanceCriteria: [
          "identifies which V2 layers are implemented",
          "identifies whether an automated test suite exists",
          "recommends a next step",
        ],
        input: {
          objective: "Report the current Money Mind V2 development state",
          question:
            "What is complete in Money Mind V2, what tests exist, and what " +
            "should be worked on next?",
          sourcesRequired: 1,
        },
      },
      {
        id: "qa-review",
        type: "qa",
        description: "Verify the Money Mind status report",
        recommendedAgentId: QA_AGENT_ID,
        dependsOn: ["research-money-mind"],
        acceptanceCriteria: [
          "report covers V2 layer completion",
          "report covers test coverage status",
          "report recommends a next step",
        ],
        input: {
          objective: "Verify the Money Mind V2 status report",
          acceptanceCriteria: [
            "report covers V2 layer completion",
            "report covers test coverage status",
            "report recommends a next step",
          ],
          artifacts: [
            {
              id: "research-report",
              description: "Research Agent's Money Mind status report",
              content:
                "All six V2 layers are implemented and validated; no automated " +
                "test suite (npm script) is defined; recommend adding one before " +
                "further V2 work.",
            },
          ],
        },
      },
    ],
    risks: [
      "V2 status may drift between inspections without a scheduled recheck",
    ],
    assumptions: [
      "the configured Money Mind checkout reflects current develop/v2",
    ],
    recommendation: "proceed",
  });

  const pmSummarize = JSON.stringify({
    summary:
      "Money Mind V2 layers 1-6 are implemented and validated; no automated " +
      "test suite exists yet; recommend adding one next.",
    risks: [],
    assumptions: [],
    recommendation: "proceed",
    finalStatus: "completed",
  });

  const projectManager = new ProjectManagerAgent({
    model: scriptedModel("pm-model", [pmDecompose, pmSummarize]),
    audit,
  });

  const researchPlan = JSON.stringify({
    subQuestions: [
      "Which V2 layers are implemented?",
      "Is an automated test suite configured?",
    ],
    searchQueries: ["V2 status", "test"],
  });
  const researchSynthesis = JSON.stringify({
    executiveSummary:
      "All six V2 layers are implemented and validated; no automated test " +
      "suite is configured; the recommended next step is adding one.",
    findings: [
      {
        statement: "V2 layers 1 through 6 are implemented and validated.",
        kind: "fact",
        sourceIds: ["src_1"],
      },
      {
        statement: "No automated npm test script is defined for this project.",
        kind: "fact",
        sourceIds: ["src_1"],
      },
    ],
    assumptions: [],
    limitations: [],
    recommendations: ["Add an automated test suite before further V2 work."],
  });
  const research = new ResearchAgent({
    model: scriptedModel("research-model", [researchPlan, researchSynthesis]),
    toolEngine,
    context,
    audit,
    searchToolId: MONEY_MIND_TOOL_IDS.readDocs,
    fetchToolId: MONEY_MIND_TOOL_IDS.readFile,
  });

  const qaPass = JSON.stringify({
    verdict: "pass",
    findings: [
      {
        criterion: "report covers V2 layer completion",
        satisfied: true,
        evidence: "all six V2 layers reported implemented and validated",
      },
      {
        criterion: "report covers test coverage status",
        satisfied: true,
        evidence: "reports no automated test suite is configured",
      },
      {
        criterion: "report recommends a next step",
        satisfied: true,
        evidence: "recommends adding an automated test suite",
      },
    ],
    defects: [],
    recommendation: "Report is accurate and complete; safe to summarize.",
  });
  const qa = new QaAgent({
    model: scriptedModel("qa-model", [qaPass]),
    audit,
  });

  /* ---------------- wiring ------------------------------------------------ */

  const router = new RoutingAgentExecutor();
  router.register(PROJECT_MANAGER_AGENT_ID, projectManager);
  router.register(RESEARCH_AGENT_ID, research);
  router.register(QA_AGENT_ID, qa);

  const workflows = new WorkflowSystem();
  const handoffs = new HandoffSystem();
  const orchestrator = new Orchestrator(
    registry,
    new TaskSystem(),
    handoffs,
    audit,
    router,
    approvals,
    { permissions, environment: "local" },
  );
  const engine = new WorkflowEngine({
    registry,
    workflows,
    orchestrator,
    handoffs,
    audit,
    permissions,
    toolRegistry,
  });

  /* ---------------- run: PM decompose -> Research (Money Mind) -> QA ----- */

  const workflow = await engine.planFromObjective({
    name: "Inspect Money Mind V2 development state",
    description:
      "Inspect the current Money Mind V2 development state and report what " +
      "is complete, what tests exist, and what should be worked on next.",
    projectId: PROJECT_ID,
    participatingAgents: [RESEARCH_AGENT_ID, QA_AGENT_ID],
    objective:
      "Inspect the current Money Mind V2 development state and report what " +
      "is complete, what tests exist, and what should be worked on next.",
    availableAgents: [RESEARCH_AGENT_ID, QA_AGENT_ID],
  });

  assert.equal(workflow.status, "completed");
  assert.equal(workflow.taskRecords.length, 2);
  assert.ok(workflow.taskRecords.every((r) => r.status === "completed"));

  const bySpec = Object.fromEntries(
    workflow.taskRecords.map((r) => [r.specId, r]),
  );
  assert.equal(
    bySpec["research-money-mind"]!.assignedAgentId,
    RESEARCH_AGENT_ID,
  );
  assert.equal(bySpec["qa-review"]!.assignedAgentId, QA_AGENT_ID);

  // Research really did read Money Mind: its ResearchResult cites a source
  // whose reference is one of Money Mind's real (fixture) documentation paths.
  const researchOutput = bySpec["research-money-mind"]!.output as {
    sources: { reference: string; verified: boolean }[];
  };
  assert.ok(researchOutput.sources.length > 0);
  assert.ok(
    researchOutput.sources.some(
      (s) => s.verified && /\.(md|yaml)$/.test(s.reference),
    ),
  );

  // QA's structured verdict really did pass, and validates independently.
  const qaOutput = bySpec["qa-review"]!.output;
  validateQAResult(qaOutput);
  assert.equal((qaOutput as { verdict: string }).verdict, "pass");

  /* ---------------- run: PM summarize -> Completed ------------------------ */

  const priorResults = workflow.taskRecords.map((r) => ({
    specId: r.specId,
    agentId: r.assignedAgentId,
    status: r.status,
    summary: `${r.specId}: ${r.status}`,
  }));
  const summaryTask = await orchestrator.submit({
    type: "project-manager-plan",
    description: "Summarize the Money Mind V2 status inspection",
    projectId: PROJECT_ID,
    input: {
      mode: "summarize",
      objective:
        "Inspect the current Money Mind V2 development state and report what " +
        "is complete, what tests exist, and what should be worked on next.",
      priorResults,
    },
  });

  assert.equal(summaryTask.status, "completed");
  const finalDecision = summaryTask.output as {
    finalStatus: string;
    summary: string;
  };
  assert.equal(finalDecision.finalStatus, "completed");
  assert.ok(finalDecision.summary.length > 0);

  /* ---------------- Money Mind was never modified -------------------------- */

  assert.equal(repo.runCalls.length, 0);

  /* ---------------- the whole thing is auditable --------------------------- */

  const workflowKinds = audit
    .query({ type: "workflow_event" })
    .map((e) => (e.data as { kind: string }).kind);
  for (const expected of [
    "workflow_created",
    "workflow_started",
    "agent_assigned",
    "task_created",
    "qa_passed",
    "workflow_completed",
  ]) {
    assert.ok(
      workflowKinds.includes(expected),
      `missing workflow_event: ${expected}`,
    );
  }

  const toolPhases = audit
    .query({ type: "tool_execution" })
    .map((e) => (e.data as { phase: string; toolId: string }).toolId);
  assert.ok(toolPhases.includes(MONEY_MIND_TOOL_IDS.readDocs));
  assert.ok(toolPhases.includes(MONEY_MIND_TOOL_IDS.readFile));
});
