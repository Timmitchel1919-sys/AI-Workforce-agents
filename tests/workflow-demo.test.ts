/**
 * Phase 5 §21 demonstration: one deterministic, fully offline run of
 *
 *   High-level task → Project Manager → Research → Developer → QA
 *                   → Project Manager → Completed
 *
 * proving the multi-agent orchestration architecture end to end. Every model
 * call and tool call is a local stub — no real Anthropic API, web service,
 * GitHub, or repository is touched.
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
  type ModelProvider,
  type ModelRequest,
  type WorkflowResult,
} from "../core/index.js";
import { mockResearchTools } from "../adapters/index.js";
import {
  ResearchAgent,
  RESEARCH_AGENT_ID,
  makeResearchAgentDefinition,
  researchAgentGrants,
  researchToolDefinitions,
} from "../agents/research/index.js";
import {
  ProjectManagerAgent,
  PROJECT_MANAGER_AGENT_ID,
  makeProjectManagerAgentDefinition,
  projectManagerGrants,
} from "../agents/project-manager/index.js";
import {
  DeveloperAgent,
  DEVELOPER_AGENT_ID,
  makeDeveloperAgentDefinition,
  developerGrants,
} from "../agents/developer/index.js";
import {
  QaAgent,
  QA_AGENT_ID,
  makeQaAgentDefinition,
  qaGrants,
} from "../agents/qa/index.js";

/** A scripted model that returns one canned response per call, in order. */
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

test("demonstration: Project Manager -> Research -> Developer -> QA -> Project Manager -> Completed", async () => {
  const PROJECT_ID = "demo-project";

  /* ---------------- registry + permissions ---------------- */

  const registry = new AgentRegistry();
  registry.register(
    makeProjectManagerAgentDefinition({ allowedProjects: [PROJECT_ID] }),
  );
  registry.register(
    makeResearchAgentDefinition({ allowedProjects: [PROJECT_ID] }),
  );
  registry.register(
    makeDeveloperAgentDefinition({ allowedProjects: [PROJECT_ID] }),
  );
  registry.register(makeQaAgentDefinition({ allowedProjects: [PROJECT_ID] }));

  const permissions = new PermissionSystem([
    ...projectManagerGrants(),
    ...researchAgentGrants(),
    ...developerGrants(),
    ...qaGrants(),
  ]);

  /* ---------------- shared services ------------------------ */

  const audit = new AuditLog();
  const approvals = new ApprovalSystem();
  const context = new ContextSystem();
  context.setProjectContext(PROJECT_ID, { codebase: "widgets-service" });

  /* ---------------- offline research tools ------------------ */

  const toolRegistry = new ToolRegistry(audit);
  const corpus = [
    {
      reference: "https://example.org/rate-limit-guide",
      title: "API rate limiting patterns",
      content:
        "Token bucket and sliding window are the two dominant rate limiting " +
        "strategies for public APIs; token bucket tolerates bursts better.",
      sourceType: "document",
      reputation: 0.8,
      keywords: ["rate", "limit", "api"],
    },
  ];
  const tools = mockResearchTools(corpus, researchToolDefinitions);
  toolRegistry.register(tools.search);
  toolRegistry.register(tools.fetch);
  const toolEngine = new ToolExecutionEngine({
    registry: toolRegistry,
    permissions,
    approvals,
    audit,
  });

  /* ---------------- scripted (offline) agents ---------------- */

  const pmDecompose = JSON.stringify({
    summary: "Decomposed: add API rate limiting to the widgets service.",
    subtasks: [
      {
        id: "research",
        type: "research",
        description: "Research rate limiting strategies",
        recommendedAgentId: RESEARCH_AGENT_ID,
        dependsOn: [],
        acceptanceCriteria: ["identifies a recommended strategy with a source"],
        input: {
          objective: "Choose a rate limiting strategy for the widgets API",
          question: "Which rate limiting strategy fits a public API?",
          sourcesRequired: 1,
        },
      },
      {
        id: "development",
        type: "development",
        description: "Plan the implementation",
        recommendedAgentId: DEVELOPER_AGENT_ID,
        dependsOn: ["research"],
        acceptanceCriteria: ["plan is ready for QA"],
        input: {
          mode: "plan",
          objective: "Implement token-bucket rate limiting",
          instructions:
            "Propose a plan and changes based on the research findings.",
          acceptanceCriteria: [
            "configurable bucket size",
            "returns 429 when exceeded",
          ],
        },
      },
      {
        id: "qa",
        type: "qa",
        description: "Verify the implementation plan",
        recommendedAgentId: QA_AGENT_ID,
        dependsOn: ["development"],
        acceptanceCriteria: [
          "plan covers configurable limits",
          "plan covers 429 handling",
        ],
        input: {
          objective: "Verify the rate limiting plan",
          acceptanceCriteria: [
            "plan covers configurable limits",
            "plan covers 429 handling",
          ],
          artifacts: [
            {
              id: "dev-plan",
              description: "Developer's proposed plan",
              content:
                "Plan: add a configurable token-bucket limiter; return HTTP 429 " +
                "with a Retry-After header when the bucket is empty.",
            },
          ],
        },
      },
    ],
    risks: ["third-party clients may retry aggressively"],
    assumptions: ["Redis is available for shared bucket state"],
    recommendation: "proceed",
  });

  const pmSummarize = JSON.stringify({
    summary: "Rate limiting research, plan, and QA verification are complete.",
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
    subQuestions: ["What strategies exist?", "Which fits a public API?"],
    searchQueries: ["rate limit api"],
  });
  const researchSynthesis = JSON.stringify({
    executiveSummary:
      "Token bucket rate limiting is recommended for the widgets API.",
    findings: [
      {
        statement: "Token bucket tolerates bursts better than sliding window.",
        kind: "fact",
        sourceIds: ["src_1"],
      },
    ],
    assumptions: [],
    limitations: [],
    recommendations: [
      "Implement a token-bucket limiter with configurable size.",
    ],
  });
  const research = new ResearchAgent({
    model: scriptedModel("research-model", [researchPlan, researchSynthesis]),
    toolEngine,
    context,
    audit,
  });

  const developerPlan = JSON.stringify({
    summary: "Add a configurable token-bucket rate limiter.",
    plan: [
      "Add a TokenBucket class with configurable capacity and refill rate",
      "Wire it into the request middleware",
      "Return 429 with Retry-After when the bucket is empty",
    ],
    proposedChanges: [
      {
        description: "Add TokenBucket middleware",
        rationale:
          "Matches the research recommendation and is simple to reason about",
        riskLevel: "low",
      },
    ],
    risks: ["needs shared state across instances"],
    openQuestions: [],
    recommendation: "ready_for_qa",
  });
  const developer = new DeveloperAgent({
    model: scriptedModel("dev-model", [developerPlan]),
    audit,
  });

  const qaPass = JSON.stringify({
    verdict: "pass",
    findings: [
      {
        criterion: "plan covers configurable limits",
        satisfied: true,
        evidence: "TokenBucket has configurable capacity",
      },
      {
        criterion: "plan covers 429 handling",
        satisfied: true,
        evidence: "returns 429 with Retry-After",
      },
    ],
    defects: [],
    recommendation: "Approved for implementation.",
  });
  const qa = new QaAgent({
    model: scriptedModel("qa-model", [qaPass]),
    audit,
  });

  /* ---------------- wiring ------------------------------------ */

  const router = new RoutingAgentExecutor();
  router.register(PROJECT_MANAGER_AGENT_ID, projectManager);
  router.register(RESEARCH_AGENT_ID, research);
  router.register(DEVELOPER_AGENT_ID, developer);
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

  /* ---------------- run: PM decompose -> research -> dev -> qa - */

  const workflow = await engine.planFromObjective({
    name: "Add API rate limiting",
    description: "Research, plan, and verify rate limiting for the widgets API",
    projectId: PROJECT_ID,
    participatingAgents: [RESEARCH_AGENT_ID, DEVELOPER_AGENT_ID, QA_AGENT_ID],
    objective: "Add rate limiting to the widgets API",
    availableAgents: [RESEARCH_AGENT_ID, DEVELOPER_AGENT_ID, QA_AGENT_ID],
  });

  assert.equal(workflow.status, "completed");
  assert.equal(workflow.taskRecords.length, 3);
  assert.ok(workflow.taskRecords.every((r) => r.status === "completed"));

  const bySpec = Object.fromEntries(
    workflow.taskRecords.map((r) => [r.specId, r]),
  );
  assert.equal(bySpec.research!.assignedAgentId, RESEARCH_AGENT_ID);
  assert.equal(bySpec.development!.assignedAgentId, DEVELOPER_AGENT_ID);
  assert.equal(bySpec.qa!.assignedAgentId, QA_AGENT_ID);

  // QA's structured verdict really did pass, and validates independently.
  const qaOutput = bySpec.qa!.output;
  validateQAResult(qaOutput);
  assert.equal((qaOutput as { verdict: string }).verdict, "pass");

  // real, accepted handoffs exist across each cross-agent edge.
  assert.equal(handoffs.list().length, 2);
  assert.ok(handoffs.list().every((h) => h.status === "accepted"));

  /* ---------------- run: PM summarize -> Completed -------------- */

  const priorResults = workflow.taskRecords.map((r) => ({
    specId: r.specId,
    agentId: r.assignedAgentId,
    status: r.status,
    summary: `${r.specId}: ${r.status}`,
  }));
  const summaryTask = await orchestrator.submit({
    type: "project-manager-plan",
    description: "Summarize the completed workflow",
    projectId: PROJECT_ID,
    input: {
      mode: "summarize",
      objective: "Add rate limiting to the widgets API",
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

  /* ---------------- the whole thing is auditable ----------------- */

  const workflowKinds = audit
    .query({ type: "workflow_event" })
    .map((e) => (e.data as { kind: string }).kind);
  for (const expected of [
    "workflow_created",
    "workflow_started",
    "agent_assigned",
    "task_created",
    "handoff_created",
    "handoff_accepted",
    "qa_passed",
    "workflow_completed",
  ]) {
    assert.ok(
      workflowKinds.includes(expected),
      `missing workflow_event: ${expected}`,
    );
  }

  const result = workflow.result as WorkflowResult;
  assert.equal(result.status, "completed");
  assert.equal(result.taskResults.length, 3);
});
