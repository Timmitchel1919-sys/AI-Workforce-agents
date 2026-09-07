import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  AgentExecutionError,
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
  ValidationError,
  validateResearchResult,
  validateResearchTask,
  type AgentLimits,
  type Environment,
  type ModelProvider,
  type ModelRequest,
  type ResearchResult,
  type Task,
} from "../core/index.js";
import { makeInMemoryTool, mockResearchTools } from "../adapters/index.js";
import {
  computeConfidence,
  makeResearchAgentDefinition,
  researchAgentGrants,
  researchApprovalPolicy,
  researchFetchToolDefinition,
  researchSearchToolDefinition,
  researchToolDefinitions,
  ResearchAgent,
  RESEARCH_AGENT_ID,
} from "../agents/research/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

const PLAN_JSON = JSON.stringify({
  subQuestions: ["What is X?", "How does Y behave?"],
  searchQueries: ["alpha topic", "beta topic"],
});

const SYNTH_JSON = JSON.stringify({
  executiveSummary: "A concise summary of what was found.",
  findings: [
    { statement: "X is well documented.", kind: "fact", sourceIds: ["src_1"] },
    { statement: "Y is probably related.", kind: "inference", sourceIds: [] },
  ],
  assumptions: ["Assumes the corpus is current."],
  limitations: ["Only two sources were available."],
  recommendations: ["Widen the search next iteration."],
});

type Handler = (input: unknown) => unknown;

function scriptedModel(
  responses: string[],
): ModelProvider & { calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  let i = 0;
  return {
    id: "fake-model",
    calls,
    async generate(request: ModelRequest) {
      calls.push(request);
      const content = responses[Math.min(i, responses.length - 1)] ?? "{}";
      i += 1;
      return { content, model: "fake-1" };
    },
  };
}

function throwingModel(message: string): ModelProvider {
  return {
    id: "throwing-model",
    async generate() {
      throw new Error(message);
    },
  };
}

const defaultSearch: Handler = () => ({
  results: [
    {
      title: "Reference A",
      reference: "https://example.org/a",
      snippet: "about alpha",
      sourceType: "web_page",
    },
  ],
});
const defaultFetch: Handler = () => ({
  title: "Reference A",
  content: "Alpha content, verified and on topic.",
  sourceType: "web_page",
  reputation: 0.7,
});

interface EngineOptions {
  search?: Handler;
  fetch?: Handler;
  permissions?: PermissionSystem;
  approvals?: ApprovalSystem;
  audit?: AuditLog;
  clock?: () => number;
}

function researchEngine(options: EngineOptions = {}) {
  const audit = options.audit ?? new AuditLog();
  const permissions =
    options.permissions ?? new PermissionSystem(researchAgentGrants());
  const approvals = options.approvals ?? new ApprovalSystem();
  const calls: Array<{ tool: string; input: unknown }> = [];
  const search = options.search ?? defaultSearch;
  const fetch = options.fetch ?? defaultFetch;

  const registry = new ToolRegistry();
  registry.register(
    makeInMemoryTool(researchSearchToolDefinition, (input) => {
      calls.push({ tool: "research.search", input });
      return search(input);
    }),
  );
  registry.register(
    makeInMemoryTool(researchFetchToolDefinition, (input) => {
      calls.push({ tool: "research.fetch", input });
      return fetch(input);
    }),
  );

  const engine = new ToolExecutionEngine({
    registry,
    permissions,
    approvals,
    audit,
    clock: options.clock,
  });
  return { engine, audit, permissions, approvals, registry, toolCalls: calls };
}

interface AgentOptions extends EngineOptions {
  model?: ModelProvider;
  limits?: Partial<AgentLimits>;
  context?: ContextSystem;
  environment?: Environment;
}

function standaloneAgent(options: AgentOptions = {}) {
  const context = options.context ?? new ContextSystem();
  const wiring = researchEngine(options);
  const agent = new ResearchAgent({
    model:
      "model" in options
        ? options.model
        : scriptedModel([PLAN_JSON, SYNTH_JSON]),
    toolEngine: wiring.engine,
    context,
    audit: wiring.audit,
    limits: options.limits,
    clock: options.clock,
    environment: options.environment,
  });
  return { agent, context, ...wiring };
}

function draft(over: Record<string, unknown> = {}) {
  return {
    objective: "Understand the current state of the topic",
    question: "What is the current state of X?",
    constraints: ["recent sources only"],
    sourcesRequired: 3,
    ...over,
  };
}

function fakeTask(over: Partial<Task> = {}): Task {
  const ts = "2026-01-01T00:00:00.000Z";
  return {
    id: "task_r1",
    type: "research",
    description: "research task",
    projectId: "proj-x",
    priority: "normal",
    status: "running",
    input: draft(),
    output: undefined,
    errors: [],
    requiredPermissions: [],
    createdAt: ts,
    updatedAt: ts,
    metadata: {},
    ...over,
  };
}

const AGENT_DEF = makeResearchAgentDefinition({ allowedProjects: ["proj-x"] });

/* ------------------------------------------------------------------ */
/* 1. Agent registration                                              */
/* ------------------------------------------------------------------ */

test("registration: the research agent registers and validates", () => {
  const registry = new AgentRegistry();
  registry.register(AGENT_DEF);
  assert.equal(registry.get(RESEARCH_AGENT_ID)?.name, "Research Agent");
  assert.throws(() => registry.register(AGENT_DEF), /already registered/);
});

test("registration: grants are least-privilege (deny write/deploy/secrets/comms)", () => {
  const grants = researchAgentGrants();
  const denied = grants
    .filter((g) => g.effect === "deny")
    .map((g) => g.action)
    .sort();
  assert.deepEqual(denied, [
    "deploy",
    "external_communication",
    "secret_access",
    "write",
  ]);
  assert.ok(
    grants.some((g) => g.effect === "allow" && g.toolId === "research.search"),
  );
});

/* ------------------------------------------------------------------ */
/* 2. Research task validation                                        */
/* ------------------------------------------------------------------ */

test("task validation: accepts a good task and normalises defaults", () => {
  const task = validateResearchTask(draft());
  assert.equal(task.outputFormat, "structured");
  assert.equal(task.sourcesRequired, 3);
  assert.deepEqual(task.constraints, ["recent sources only"]);
});

test("task validation: rejects bad tasks", () => {
  assert.throws(() => validateResearchTask({ question: "q" }), /objective/);
  assert.throws(
    () => validateResearchTask({ objective: "o", question: "" }),
    /question/,
  );
  assert.throws(
    () => validateResearchTask(draft({ sourcesRequired: 0 })),
    /sourcesRequired/,
  );
  assert.throws(
    () => validateResearchTask(draft({ deadline: "not-a-date" })),
    /deadline/,
  );
});

/* ------------------------------------------------------------------ */
/* 3. Research result validation                                      */
/* ------------------------------------------------------------------ */

test("result validation: rejects malformed results", () => {
  const base: ResearchResult = {
    taskId: "t",
    agentId: "a",
    question: "q",
    executiveSummary: "s",
    findings: [],
    evidence: [],
    sources: [],
    assumptions: [],
    limitations: [],
    confidence: { level: "low", score: 0, basis: "b" },
    recommendations: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    metadata: {},
  };
  assert.doesNotThrow(() => validateResearchResult(base));
  assert.throws(
    () => validateResearchResult({ ...base, executiveSummary: "" }),
    ValidationError,
  );
  assert.throws(
    () =>
      validateResearchResult({
        ...base,
        findings: [{ statement: "x", kind: "fact", supportingSourceIds: [] }],
      }),
    /no supporting source/,
  );
  assert.throws(
    () =>
      validateResearchResult({
        ...base,
        findings: [
          { statement: "x", kind: "inference", supportingSourceIds: ["ghost"] },
        ],
      }),
    /unknown source/,
  );
  assert.throws(
    () =>
      validateResearchResult({
        ...base,
        confidence: { level: "bogus", score: 0, basis: "b" },
      }),
    /confidence/,
  );
});

/* ------------------------------------------------------------------ */
/* 4. Agent lookup                                                    */
/* ------------------------------------------------------------------ */

test("lookup: eligible only for research tasks on an allowed project", () => {
  const registry = new AgentRegistry();
  registry.register(AGENT_DEF);
  assert.deepEqual(
    registry.eligible("research", "proj-x").map((a) => a.id),
    [RESEARCH_AGENT_ID],
  );
  assert.equal(registry.eligible("research", "other-project").length, 0);
  assert.equal(registry.eligible("deploy", "proj-x").length, 0);
  assert.deepEqual(
    registry.byCapability("source_evaluation").map((a) => a.id),
    [RESEARCH_AGENT_ID],
  );
});

/* ------------------------------------------------------------------ */
/* 5. ModelProvider interaction                                       */
/* ------------------------------------------------------------------ */

test("model: goes through ModelProvider with task correlation, no vendor import", async () => {
  const model = scriptedModel([PLAN_JSON, SYNTH_JSON]);
  const { agent } = standaloneAgent({ model });
  await agent.execute(AGENT_DEF, fakeTask());

  assert.equal(model.calls.length, 2, "one plan + one synthesis call");
  for (const call of model.calls) {
    assert.equal(call.metadata?.agentId, RESEARCH_AGENT_ID);
    assert.equal(call.metadata?.taskId, "task_r1");
    assert.equal(call.metadata?.projectId, "proj-x");
  }
});

test("model: the research agent has no direct Anthropic dependency", () => {
  for (const file of walkTs(join(repoRoot, "agents"))) {
    const code = readFileSync(file, "utf8");
    assert.ok(
      !/@anthropic-ai\/sdk/.test(code) && !/\bAnthropic[A-Z_]/.test(code),
      `${file} references the Anthropic SDK`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* 6. Tool interaction — via the ToolExecutionEngine                  */
/* ------------------------------------------------------------------ */

test("tools: search then fetch run through the ToolExecutionEngine", async () => {
  const { agent, toolCalls, audit } = standaloneAgent();
  await agent.execute(AGENT_DEF, fakeTask());

  const tools = toolCalls.map((c) => c.tool);
  assert.ok(tools.includes("research.search"));
  assert.ok(tools.includes("research.fetch"));
  const firstSearch = toolCalls.find((c) => c.tool === "research.search");
  assert.equal((firstSearch?.input as { query?: string }).query, "alpha topic");

  // the engine recorded its own lifecycle events
  const phases = audit
    .list()
    .filter((e) => e.type === "tool_execution")
    .map((e) => (e.data as { phase: string }).phase);
  assert.ok(phases.includes("requested"));
  assert.ok(phases.includes("authorized"));
  assert.ok(phases.includes("completed"));
});

/* ------------------------------------------------------------------ */
/* 7. Permission enforcement (in the engine)                          */
/* ------------------------------------------------------------------ */

test("permissions: a denied tool stops the run before the tool executes", async () => {
  const { agent, audit, toolCalls } = standaloneAgent({
    permissions: new PermissionSystem([]), // deny-by-default
  });

  await assert.rejects(
    agent.execute(AGENT_DEF, fakeTask()),
    (error: unknown) => {
      assert.ok(error instanceof AgentExecutionError);
      assert.equal((error as AgentExecutionError).reason, "permission_denied");
      return true;
    },
  );
  assert.equal(toolCalls.length, 0, "no tool handler ran");

  const decision = audit
    .list()
    .find(
      (e) =>
        e.type === "permission_decision" &&
        (e.data as { via?: string }).via === "tool-execution-engine",
    );
  assert.equal((decision?.data as { allowed?: boolean }).allowed, false);
});

/* ------------------------------------------------------------------ */
/* 8. Project context isolation                                       */
/* ------------------------------------------------------------------ */

test("context: only the task's project context is visible", async () => {
  const context = new ContextSystem();
  context.setProjectContext("aims", { aimsSecret: "AIMS-ONLY-VALUE" });
  context.setProjectContext("money-mind", { mmKey: "mm-value" });
  context.setTaskContext("task_r1", "money-mind", { taskKey: "t-value" });

  const { agent, audit } = standaloneAgent({ context });
  const output = (await agent.execute(
    AGENT_DEF,
    fakeTask({ projectId: "money-mind" }),
  )) as ResearchResult;

  assert.deepEqual(output.metadata.contextKeys, {
    project: ["mmKey"],
    task: ["taskKey"],
  });
  assert.ok(!JSON.stringify(output).includes("AIMS-ONLY-VALUE"));

  const loaded = audit
    .list()
    .find((e) => (e.data as { kind?: string }).kind === "context_loaded");
  assert.equal(
    (loaded?.data as { projectId?: string }).projectId,
    "money-mind",
  );
  assert.deepEqual((loaded?.data as { projectKeys?: string[] }).projectKeys, [
    "mmKey",
  ]);
});

/* ------------------------------------------------------------------ */
/* 9-11. Limits and timeout (agent-level, preserved)                  */
/* ------------------------------------------------------------------ */

test("limits: exceeding max tool calls fails with limit_exceeded", async () => {
  const { agent } = standaloneAgent({ limits: { maxToolCalls: 1 } });
  await assert.rejects(
    agent.execute(AGENT_DEF, fakeTask()),
    (error: unknown) => {
      assert.ok(error instanceof AgentExecutionError);
      assert.equal((error as AgentExecutionError).reason, "limit_exceeded");
      assert.equal((error as AgentExecutionError).details.kind, "tool_calls");
      return true;
    },
  );
});

test("limits: exceeding max model calls fails with limit_exceeded", async () => {
  const { agent } = standaloneAgent({ limits: { maxModelCalls: 1 } });
  await assert.rejects(
    agent.execute(AGENT_DEF, fakeTask()),
    (error: unknown) => {
      assert.equal((error as AgentExecutionError).reason, "limit_exceeded");
      assert.equal((error as AgentExecutionError).details.kind, "model_calls");
      return true;
    },
  );
});

test("limits: a slow tool trips the wall-clock timeout deterministically", async () => {
  let clockValue = 0;
  const { agent } = standaloneAgent({
    limits: { timeoutMs: 100 },
    clock: () => clockValue,
    search: () => {
      clockValue += 5_000; // jump past the deadline
      return {
        results: [
          {
            title: "A",
            reference: "https://example.org/a",
            snippet: "x",
            sourceType: "web_page",
          },
        ],
      };
    },
  });

  await assert.rejects(
    agent.execute(AGENT_DEF, fakeTask()),
    (error: unknown) => {
      assert.equal((error as AgentExecutionError).reason, "timeout");
      return true;
    },
  );
});

/* ------------------------------------------------------------------ */
/* 12-14. Tool failure, model failure, invalid result                */
/* ------------------------------------------------------------------ */

test("errors: a search-tool failure is a structured tool_failure", async () => {
  const { agent } = standaloneAgent({
    search: () => {
      throw new Error("search backend unavailable");
    },
  });
  await assert.rejects(
    agent.execute(AGENT_DEF, fakeTask()),
    (error: unknown) => {
      assert.equal((error as AgentExecutionError).reason, "tool_failure");
      assert.equal(
        (error as AgentExecutionError).details.tool,
        "research.search",
      );
      return true;
    },
  );
});

test("errors: a fetch failure degrades to an unverified source, not a hard failure", async () => {
  const { agent } = standaloneAgent({
    fetch: () => {
      throw new Error("fetch timeout");
    },
  });
  const output = (await agent.execute(AGENT_DEF, fakeTask())) as ResearchResult;
  assert.ok(output.sources.every((s) => !s.verified));
  assert.ok(output.limitations.some((l) => /could not be verified/.test(l)));
  assert.equal(output.confidence.level, "low");
});

test("errors: a throwing model is a structured model_failure", async () => {
  const { agent } = standaloneAgent({ model: throwingModel("model exploded") });
  await assert.rejects(
    agent.execute(AGENT_DEF, fakeTask()),
    (error: unknown) => {
      assert.equal((error as AgentExecutionError).reason, "model_failure");
      return true;
    },
  );
});

test("errors: unparseable model output is a structured model_failure", async () => {
  const { agent } = standaloneAgent({
    model: scriptedModel(["not json at all", SYNTH_JSON]),
  });
  await assert.rejects(
    agent.execute(AGENT_DEF, fakeTask()),
    (error: unknown) => {
      assert.equal((error as AgentExecutionError).reason, "model_failure");
      return true;
    },
  );
});

test("errors: an empty synthesis yields a structured invalid_result", async () => {
  const { agent } = standaloneAgent({
    model: scriptedModel([PLAN_JSON, "{}"]),
  });
  await assert.rejects(
    agent.execute(AGENT_DEF, fakeTask()),
    (error: unknown) => {
      assert.equal((error as AgentExecutionError).reason, "invalid_result");
      return true;
    },
  );
});

/* ------------------------------------------------------------------ */
/* 15. Successful workflow + confidence model                        */
/* ------------------------------------------------------------------ */

test("workflow: a full run returns a valid, source-grounded ResearchResult", async () => {
  const { agent } = standaloneAgent();
  const output = (await agent.execute(AGENT_DEF, fakeTask())) as ResearchResult;

  assert.doesNotThrow(() => validateResearchResult(output));
  assert.equal(output.agentId, RESEARCH_AGENT_ID);
  assert.equal(output.question, "What is the current state of X?");
  assert.equal(output.sources.length, 2);
  assert.equal(output.findings.length, 2);
  assert.equal(output.findings[0]!.kind, "fact");
  assert.deepEqual(output.findings[0]!.supportingSourceIds, ["src_1"]);
  assert.equal(output.evidence.length, 2);
  assert.equal(output.confidence.level, "medium");
  assert.equal(output.confidence.score, 0.59);
  assert.match(output.confidence.basis, /verified sources 2\/3/);
});

test("confidence: derived from evidence, not model wording", () => {
  const low = computeConfidence({
    sources: [],
    findings: [],
    plannedQuestions: ["q"],
    targetSources: 3,
  });
  assert.equal(low.level, "low");
  assert.equal(low.score, 0);

  const strongSources = [1, 2, 3].map((i) => ({
    id: `src_${i}`,
    title: "t",
    reference: "r",
    sourceType: "document" as const,
    retrievedAt: "",
    relevance: 0.9,
    reliability: 0.8,
    reliabilityBasis: "",
    verified: true,
  }));
  const high = computeConfidence({
    sources: strongSources,
    findings: [
      { statement: "a", kind: "fact", supportingSourceIds: ["src_1"] },
      { statement: "b", kind: "claim", supportingSourceIds: ["src_2"] },
    ],
    plannedQuestions: ["q1", "q2"],
    targetSources: 3,
  });
  assert.equal(high.level, "high");
});

/* ------------------------------------------------------------------ */
/* 16. Audit events                                                   */
/* ------------------------------------------------------------------ */

test("audit: the workflow emits the expected agent_activity + tool_execution trail", async () => {
  const { agent, audit } = standaloneAgent();
  await agent.execute(AGENT_DEF, fakeTask());

  const kinds = audit
    .list()
    .filter((e) => e.type === "agent_activity")
    .map((e) => (e.data as { kind: string }).kind);

  for (const expected of [
    "task_received",
    "started",
    "context_loaded",
    "model_call",
    "plan_ready",
    "tool_requested",
    "tool_result",
    "source_collected",
    "synthesis",
    "confidence_scored",
    "result_validated",
    "completed",
  ]) {
    assert.ok(kinds.includes(expected), `missing agent_activity: ${expected}`);
  }
  assert.equal(kinds[0], "task_received");
  assert.equal(kinds.at(-1), "completed");
  assert.ok(audit.list().some((e) => e.type === "tool_execution"));
});

test("audit: a failed run records a structured failure event", async () => {
  const { agent, audit } = standaloneAgent({ model: throwingModel("boom") });
  await assert.rejects(agent.execute(AGENT_DEF, fakeTask()));
  const failed = audit
    .list()
    .find((e) => (e.data as { kind?: string }).kind === "failed");
  assert.equal((failed?.data as { reason?: string }).reason, "model_failure");
});

/* ------------------------------------------------------------------ */
/* 17. Orchestrator routing                                           */
/* ------------------------------------------------------------------ */

function wireOrchestrator(
  grants = researchAgentGrants(),
  approvalPolicy = researchApprovalPolicy,
) {
  const registry = new AgentRegistry();
  registry.register(
    makeResearchAgentDefinition({ allowedProjects: ["proj-x"] }),
  );
  const tasks = new TaskSystem();
  const permissions = new PermissionSystem(grants);
  const context = new ContextSystem();
  const wiring = researchEngine({ permissions });
  const router = new RoutingAgentExecutor();
  router.register(
    RESEARCH_AGENT_ID,
    new ResearchAgent({
      model: scriptedModel([PLAN_JSON, SYNTH_JSON]),
      toolEngine: wiring.engine,
      context,
      audit: wiring.audit,
    }),
  );
  const orchestrator = new Orchestrator(
    registry,
    tasks,
    new HandoffSystem(),
    wiring.audit,
    router,
    new ApprovalSystem(),
    { permissions, environment: "local", approvalPolicy },
  );
  return { orchestrator, audit: wiring.audit };
}

test("orchestrator: routes a research task to the research agent and completes", async () => {
  const { orchestrator, audit } = wireOrchestrator();
  const task = await orchestrator.submit({
    type: "research",
    description: "Research the state of X",
    projectId: "proj-x",
    input: draft(),
    requiredPermissions: [
      { action: "execute", toolId: "research.search" },
      { action: "read", toolId: "research.fetch" },
    ],
  });

  assert.equal(task.status, "completed");
  assert.doesNotThrow(() => validateResearchResult(task.output));
  assert.equal((task.output as ResearchResult).agentId, RESEARCH_AGENT_ID);
  assert.ok(audit.list().some((e) => e.type === "task_completed"));
  assert.ok(audit.list().some((e) => e.type === "tool_execution"));
});

test("orchestrator: read-only research needs no approval", () => {
  assert.equal(
    researchApprovalPolicy.evaluate({
      ...fakeTask(),
      requiredPermissions: [{ action: "read" }, { action: "execute" }],
    }).required,
    false,
  );
});

test("orchestrator: a research task requesting a risky capability is approval-gated", async () => {
  const grants = [
    ...researchAgentGrants().filter((g) => g.action !== "write"),
    {
      effect: "allow" as const,
      action: "write" as const,
      agentId: RESEARCH_AGENT_ID,
    },
  ];
  const { orchestrator, audit } = wireOrchestrator(grants);
  const task = await orchestrator.submit({
    type: "research",
    description: "Research and write back",
    projectId: "proj-x",
    input: draft(),
    requiredPermissions: [
      { action: "execute", toolId: "research.search" },
      { action: "read", toolId: "research.fetch" },
      { action: "write" },
    ],
  });

  assert.equal(task.status, "awaiting_approval");
  assert.ok(audit.list().some((e) => e.type === "approval_requested"));
});

test("orchestrator: risky research policy classifies each action", () => {
  assert.equal(
    researchApprovalPolicy.evaluate({
      ...fakeTask(),
      requiredPermissions: [{ action: "external_communication" }],
    }).required,
    true,
  );
  assert.equal(
    researchApprovalPolicy.evaluate({ ...fakeTask(), type: "other" }).required,
    false,
  );
});

/* ------------------------------------------------------------------ */
/* 18. Mock research tools (offline) drive a full run                */
/* ------------------------------------------------------------------ */

test("mock research tools: drive a full research run offline through the engine", async () => {
  const corpus = [
    {
      reference: "https://example.org/alpha",
      title: "Alpha overview",
      content:
        "Alpha topic is documented across many alpha studies and alpha reports.",
      sourceType: "document",
      reputation: 0.8,
      keywords: ["alpha", "topic"],
    },
    {
      reference: "https://example.org/beta",
      title: "Beta overview",
      content: "Beta topic connects to alpha topic in several beta analyses.",
      sourceType: "web_page",
      reputation: 0.5,
      keywords: ["beta", "topic"],
    },
  ];
  const audit = new AuditLog();
  const registry = new ToolRegistry();
  const tools = mockResearchTools(corpus, researchToolDefinitions);
  registry.register(tools.search);
  registry.register(tools.fetch);
  const engine = new ToolExecutionEngine({
    registry,
    permissions: new PermissionSystem(researchAgentGrants()),
    audit,
  });
  const agent = new ResearchAgent({
    model: scriptedModel([PLAN_JSON, SYNTH_JSON]),
    toolEngine: engine,
    context: new ContextSystem(),
    audit,
  });
  const output = (await agent.execute(AGENT_DEF, fakeTask())) as ResearchResult;
  assert.doesNotThrow(() => validateResearchResult(output));
  assert.ok(output.sources.length >= 1);
  assert.ok(output.sources.every((s) => s.verified));
});

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}
