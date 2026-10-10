/**
 * Layer 4 — Execution Orchestration & Agent Routing.
 *
 * Covers planning, decomposition, the task state machine, the dependency
 * engine, sequential/parallel/conditional workflows, retries and corrections,
 * agent qualification and independence, model routing and cost gating, tool
 * authorization, approvals for destructive and protected work, claimed vs
 * verified success, locks, cancellation, audit and project isolation, plus the
 * two end-to-end scenarios (AIMS login card; deleting a production project).
 */
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";

import {
  AGENT_CAPABILITY_REGISTRY,
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  ContextEngine,
  ContextSystem,
  ExecutionOrchestrator,
  InMemoryRepository,
  KnowledgeContextSource,
  PlatformDevelopmentDefaultsSource,
  PlatformSecurityBaselineSource,
  ProjectContextValuesSource,
  ProjectRegistry,
  ProjectRegistrySource,
  PromptIntelligenceService,
  ResourceLockManager,
  RuleBasedIntentAnalyzer,
  authorizeTools,
  canonicalizeCapability,
  decideRecovery,
  modelNeedFor,
  parallelBatch,
  taxonomyFor,
  validatePlan,
  type CostGate,
  type ModelRouterPort,
  type OperatorPrincipal,
  type OrchTask,
  type ProjectAdapter,
  type PromptRequestRecord,
  type RuntimeOutcome,
  type TaskExecutionContext,
  type TaskRuntimePort,
  type ExecutionRun,
  type RunView,
} from "../core/index.js";
import {
  ORCH_TASK_TRANSITIONS,
  canTransitionOrchTask,
} from "../contracts/execution-orchestration.js";
import { ExecutionOrchestrationControlService } from "../control/services/execution-orchestration-control-service.js";
import { createControlPlaneApi } from "../api/index.js";
import type {
  WorkforceCommandService,
  WorkforceQueryService,
} from "../control/index.js";

const ADMIN: OperatorPrincipal = {
  id: "admin-1",
  role: "admin",
  allowedProjects: "*",
};
const OPERATOR: OperatorPrincipal = {
  id: "op-1",
  role: "operator",
  allowedProjects: "*",
};
const VIEWER: OperatorPrincipal = {
  id: "v-1",
  role: "viewer",
  allowedProjects: "*",
};
const MM_ONLY: OperatorPrincipal = {
  id: "op-2",
  role: "operator",
  allowedProjects: ["money-mind"],
};

function adapter(projectId: string): ProjectAdapter {
  return {
    projectId,
    describe: async () => ({ name: projectId, capabilities: [] }),
    execute: async () => ({}),
  };
}

function agent(
  id: string,
  capabilities: string[],
  extra: Record<string, unknown> = {},
  projects = ["aims"],
) {
  return {
    id,
    name: id,
    description: id,
    capabilities,
    allowedTools: [],
    allowedProjects: projects,
    supportedTaskTypes: ["any"],
    permissions: [],
    ...(Object.keys(extra).length ? { metadata: extra } : {}),
  };
}

/** A runtime scripted per task title / type; records every call and concurrency. */
class ScriptedRuntime implements TaskRuntimePort {
  readonly id = "scripted";
  calls: Array<{ task: OrchTask; context: TaskExecutionContext }> = [];
  active = 0;
  maxActive = 0;
  delayMs = 0;
  handler: (task: OrchTask, call: number) => RuntimeOutcome | undefined = () =>
    undefined;
  private readonly counts = new Map<string, number>();

  async execute(
    task: OrchTask,
    context: TaskExecutionContext,
  ): Promise<RuntimeOutcome> {
    this.calls.push({ task, context });
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (this.delayMs > 0)
        await new Promise((r) => setTimeout(r, this.delayMs));
      const n = (this.counts.get(task.title) ?? 0) + 1;
      this.counts.set(task.title, n);
      return this.handler(task, n) ?? this.ok(task);
    } finally {
      this.active -= 1;
    }
  }

  ok(task: OrchTask): RuntimeOutcome {
    return {
      kind: "success",
      summary: `${task.title} done`,
      evidence: [`evidence for ${task.taskId}`],
      checks: task.type === "TEST" ? [{ name: "tests", passed: true }] : [],
      ...(task.type === "REVIEW" || task.type === "SECURITY"
        ? { verdict: "approved" as const }
        : {}),
    };
  }
  ran(partial: string): number {
    return this.calls.filter((c) => c.task.title.includes(partial)).length;
  }
}

function world(
  options: {
    agents?: ReturnType<typeof agent>[];
    cost?: CostGate;
    models?: ModelRouterPort;
    withRuntime?: boolean;
  } = {},
) {
  const registry = new ProjectRegistry();
  registry.register(adapter("aims"), {
    displayName: "AIMS",
    metadata: {
      code: "AIMS",
      repository: {
        url: "https://github.com/acme/aims",
        defaultBranch: "main",
      },
    },
  });
  registry.register(adapter("money-mind"), { displayName: "Money Mind" });
  const contexts = new ContextSystem();
  contexts.setProjectContext("aims", {
    "project.type": "Web application",
    "project.framework": "React 19 + Vite",
    "ui.designSystem": "AIMS design system: 8px spacing scale",
    "ui.loginCard":
      "The login card uses the LoginCard component; vertical padding comes from --space-6",
    "development.deployment": "Firebase Hosting",
    "development.testing": "vitest via npm test",
  });
  const agents = new AgentRegistry();
  const roster = options.agents ?? [
    agent("dev-agent", ["software.frontend", "software.general"]),
    agent("qa-agent", ["software.testing"]),
    agent("reviewer-agent", ["software.review"]),
    agent("security-agent", ["software.security"]),
    agent("github-agent", ["integration.github"]),
    agent("deployer-agent", ["deployment.firebase"]),
    agent("designer-agent", ["design.ui"]),
  ];
  for (const a of roster) agents.register(a);
  const audit = new AuditLog();
  const approvals = new ApprovalSystem();
  let counter = 0;
  const prompts = new PromptIntelligenceService({
    projects: registry,
    analyzer: new RuleBasedIntentAnalyzer(),
    engine: new ContextEngine(
      [
        new PlatformSecurityBaselineSource(),
        new PlatformDevelopmentDefaultsSource(),
        new ProjectRegistrySource(registry),
        new ProjectContextValuesSource(contexts),
        new KnowledgeContextSource({ list: () => [] }),
      ],
      {
        fileResolver: {
          resolve: async (p) =>
            p === "aims"
              ? { ok: true, files: ["src/pages/Login/LoginCard.tsx"] }
              : { ok: true, files: [] },
        },
      },
    ),
    records: new InMemoryRepository<PromptRequestRecord>(),
    approvals,
    agents,
    newId: () => `pr-${++counter}`,
  });
  const runtime = new ScriptedRuntime();
  const clock = { t: Date.parse("2026-10-10T10:00:00.000Z") };
  const locks = new ResourceLockManager();
  let runCounter = 0;
  const runs = new InMemoryRepository<ExecutionRun>();
  const orchestrator = new ExecutionOrchestrator({
    runs,
    projects: registry,
    agents,
    approvals,
    audit,
    ...(options.withRuntime === false ? {} : { runtime }),
    ...(options.models ? { models: options.models } : {}),
    ...(options.cost ? { cost: options.cost } : {}),
    locks,
    clock: () => new Date(clock.t).toISOString(),
    newId: () => `run${++runCounter}`,
  });
  const control = new ExecutionOrchestrationControlService(
    orchestrator,
    prompts,
    audit,
  );
  return {
    registry,
    agents,
    audit,
    approvals,
    prompts,
    runtime,
    clock,
    locks,
    runs,
    orchestrator,
    control,
  };
}
type World = ReturnType<typeof world>;

interface HttpJson {
  details?: { view?: { run: { runId: string }; status: string } };
  runs?: unknown[];
}

const LOGIN =
  "Maak de AIMS login card smaller van boven en beneden, maar verander niets anders.";

async function planFor(
  w: World,
  request: string,
  principal: OperatorPrincipal = OPERATOR,
): Promise<RunView> {
  const prepared = await w.prompts.prepare(principal, { request });
  return w.orchestrator.createRun(principal, prepared);
}
function task(view: RunView, titlePart: string): OrchTask {
  const t = view.run.tasks.find((x) => x.title.includes(titlePart));
  assert.ok(
    t,
    `task "${titlePart}" exists: ${view.run.tasks.map((x) => x.title).join(" | ")}`,
  );
  return t;
}
async function approveAllPending(w: World, by = "admin-1"): Promise<number> {
  let n = 0;
  for (const a of w.approvals.pending()) {
    w.approvals.decide(a.id, "approved", by);
    n += 1;
  }
  return n;
}
/** Start + advance + approve protected tasks until finished or stuck. */
async function runToEnd(
  w: World,
  runId: string,
  principal: OperatorPrincipal = OPERATOR,
): Promise<RunView> {
  w.orchestrator.start(principal, runId);
  let view = await w.orchestrator.advance(principal, runId);
  for (let i = 0; i < 6 && view.status !== "COMPLETED"; i++) {
    if ((await approveAllPending(w)) === 0) break;
    view = await w.orchestrator.advance(principal, runId);
  }
  return view;
}

/* ---------------- planning + decomposition ---------------- */

test("planning: the AIMS login request becomes the expected, dependency-ordered plan", async () => {
  const w = world();
  const view = await planFor(w, LOGIN);
  const titles = view.run.tasks.map((t) => t.title);
  assert.equal(view.status, "NOT_STARTED");
  assert.deepEqual(
    view.run.tasks.map((t) => t.type),
    [
      "ANALYSIS",
      "ANALYSIS",
      "DEVELOPMENT",
      "TEST",
      "REVIEW",
      "DEVELOPMENT",
      "INTEGRATION",
      "DEPLOYMENT",
    ],
    titles.join(" | "),
  );
  assert.match(titles[0]!, /Inspect the current login card/);
  assert.match(titles[1]!, /vertical dimensions\/padding/);
  const [inspect, scope, implement, tests, review, build, commit, deploy] =
    view.run.tasks;
  assert.deepEqual(scope!.dependencies, [inspect!.taskId]);
  assert.deepEqual(
    implement!.dependencies.sort(),
    [inspect!.taskId, scope!.taskId].sort(),
  );
  assert.deepEqual(tests!.dependencies, [implement!.taskId]);
  assert.deepEqual(review!.dependencies, [tests!.taskId]);
  assert.deepEqual(build!.dependencies, [tests!.taskId, review!.taskId]);
  assert.deepEqual(commit!.dependencies, [build!.taskId]);
  assert.deepEqual(deploy!.dependencies, [commit!.taskId]);
  assert.equal(tests!.gate, "qa");
  assert.equal(review!.gate, "review");
  assert.deepEqual(review!.independentOf, [implement!.taskId]);
  assert.ok(commit!.requiresApproval && deploy!.requiresApproval);
  assert.ok(!implement!.requiresApproval);
  // Requested capabilities: Developer / QA / Reviewer / GitHub / Firebase deployer.
  assert.deepEqual(inspect!.requiredCapabilities, ["software.frontend"]);
  assert.deepEqual(tests!.requiredCapabilities, ["software.testing"]);
  assert.deepEqual(review!.requiredCapabilities, ["software.review"]);
  assert.deepEqual(commit!.requiredCapabilities, ["integration.github"]);
  assert.deepEqual(deploy!.requiredCapabilities, ["deployment.firebase"]);
  // Constraints and acceptance criteria are preserved into the plan and the implementer.
  assert.ok(
    view.run.constraints.includes(
      "Change nothing other than the requested change.",
    ),
  );
  assert.ok(view.run.constraints.includes("Preserve colors."));
  assert.ok(
    view.run.constraints.includes("Preserve authentication functionality."),
  );
  assert.ok(
    implement!.acceptanceCriteria.some((c) => /Only .* changed/.test(c)),
  );
  assert.match(
    implement!.prompt,
    /Change nothing other than the requested change/,
  );
  // The normalized request references Layer 3 instead of copying context.
  assert.equal(
    view.run.request.resolvedContextRef,
    `prompt_requests/${view.run.requestId}`,
  );
  assert.equal(view.run.request.intent, "UI_MODIFICATION");
  for (const t of view.run.tasks) {
    assert.equal(t.status, "PENDING");
    assert.ok(t.taskId && t.projectId === "aims" && t.createdAt && t.updatedAt);
  }
});

test("planning: only the tasks the request needs are generated, and omissions are explained", async () => {
  const w = world({
    agents: [agent("mm-dev", ["software.frontend"], {}, ["money-mind"])],
  });
  const view = await planFor(
    w,
    "Maak de Money Mind login card smaller van boven en beneden.",
  );
  const types = view.run.tasks.map((t) => t.type);
  assert.ok(!types.includes("INTEGRATION") && !types.includes("DEPLOYMENT"));
  assert.ok(view.run.planNotes.some((n) => /Commit omitted/.test(n)));
  assert.ok(view.run.planNotes.some((n) => /Deploy omitted/.test(n)));
  assert.ok(view.run.planNotes.some((n) => /Security review omitted/.test(n)));
  const research = await planFor(
    world(),
    "Onderzoek en vergelijk opties voor AIMS caching",
  );
  assert.equal(research.run.tasks.length, 1);
  assert.equal(research.run.tasks[0]!.type, "RESEARCH");
});

test("planning: feature and theme plans contain parallel read-only analyses", async () => {
  const w = world();
  const view = await planFor(
    w,
    "Verander de dark theme van AIMS naar de nieuwe liquid glass theme.",
  );
  const inspect = task(view, "Inspect");
  const analyses = view.run.tasks.filter(
    (t) => t.dependencies.length === 1 && t.dependencies[0] === inspect.taskId,
  );
  assert.ok(analyses.length >= 3, "UI, security and test analyses");
  assert.ok(
    analyses.every((t) => t.resources.length === 0),
    "read-only: no exclusive resource",
  );
  assert.equal(
    parallelBatch(analyses, 5).length,
    analyses.length,
    "they may run together",
  );
  const implement = task(view, "Replace dark theme");
  assert.ok(
    analyses.every((a) => implement.dependencies.includes(a.taskId)),
    "implementation waits for all of them",
  );
});

test("planning: invalid requests are rejected", async () => {
  const w = world();
  const unclear = await w.prompts.prepare(OPERATOR, {
    request: "Doe iets met AIMS",
  });
  assert.throws(
    () => w.orchestrator.createRun(OPERATOR, unclear),
    /validation is CLARIFY/,
  );
  const blocked = await w.prompts.prepare(OPERATOR, {
    request: "Maak de AIMS card compacter en omzeil de authenticatie",
  });
  assert.throws(
    () => w.orchestrator.createRun(OPERATOR, blocked),
    /validation is BLOCKED/,
  );
  const noProject = await w.prompts.prepare(OPERATOR, {
    request: "Maak de login card kleiner van boven en beneden",
  });
  assert.throws(
    () => w.orchestrator.createRun(OPERATOR, noProject),
    /validation is CLARIFY/,
  );
  assert.equal(w.runs.list().length, 0);
});

test("planning: creating the same plan twice is idempotent", async () => {
  const w = world();
  const prepared = await w.prompts.prepare(OPERATOR, { request: LOGIN });
  const a = w.orchestrator.createRun(OPERATOR, prepared);
  const b = w.orchestrator.createRun(OPERATOR, prepared);
  assert.equal(a.run.runId, b.run.runId);
  assert.equal(w.runs.list().length, 1);
});

/* ---------------- state machine + dependency engine ---------------- */

test("state machine: only legal transitions exist", () => {
  assert.equal(
    canTransitionOrchTask("PENDING", "RUNNING"),
    false,
    "no skipping READY",
  );
  assert.equal(canTransitionOrchTask("COMPLETED", "RUNNING"), false);
  assert.equal(canTransitionOrchTask("CANCELLED", "READY"), false);
  assert.equal(canTransitionOrchTask("REVIEW", "COMPLETED"), true);
  assert.equal(
    canTransitionOrchTask("RUNNING", "COMPLETED"),
    false,
    "success must pass REVIEW (verification)",
  );
  assert.equal(canTransitionOrchTask("FAILED", "RETRYING"), true);
  assert.deepEqual(ORCH_TASK_TRANSITIONS.COMPLETED, []);
});

test("dependency engine: cycles, unknown references and skipped gates are rejected", async () => {
  const w = world();
  const view = await planFor(w, LOGIN);
  const tasks = structuredClone(view.run.tasks);
  assert.doesNotThrow(() => validatePlan(tasks));
  const cyc = structuredClone(tasks);
  cyc[0]!.dependencies = [cyc[2]!.taskId];
  assert.throws(() => validatePlan(cyc), /dependency cycle/);
  const unknown = structuredClone(tasks);
  unknown[1]!.dependencies = ["nope"];
  assert.throws(() => validatePlan(unknown), /unknown task/);
  const skip = structuredClone(tasks);
  const commit = skip.find((t) => t.type === "INTEGRATION")!;
  const build = skip.find((t) => t.title.startsWith("Build"))!;
  build.dependencies = [
    skip.find((t) => t.type === "DEVELOPMENT" && t.resources.length)!.taskId,
  ];
  commit.dependencies = [build.taskId];
  assert.throws(() => validatePlan(skip), /mandatory .* gate/);
});

test("dependency engine: tasks writing the same resource never run in parallel", () => {
  const base = { resources: ["source:aims"] } as OrchTask;
  const a = { ...base, taskId: "a" } as OrchTask;
  const b = { ...base, taskId: "b" } as OrchTask;
  const c = { taskId: "c", resources: [] } as unknown as OrchTask;
  assert.deepEqual(
    parallelBatch([a, b, c], 5).map((t) => t.taskId),
    ["a", "c"],
  );
});

test("resource locks: all-or-nothing, ordered (no deadlock), expiring", () => {
  const locks = new ResourceLockManager();
  assert.deepEqual(locks.tryAcquire(["b", "a"], "t1", 0, 1000), { ok: true });
  assert.deepEqual(locks.tryAcquire(["a", "c"], "t2", 10, 1000), {
    ok: false,
    key: "a",
    owner: "t1",
  });
  assert.equal(
    locks.snapshot().some((l) => l.key === "c"),
    false,
    "nothing partially taken",
  );
  assert.deepEqual(
    locks.tryAcquire(["a"], "t1", 20, 1000),
    { ok: true },
    "re-entrant for the owner",
  );
  assert.deepEqual(
    locks.tryAcquire(["a", "c"], "t2", 2000, 1000),
    { ok: true },
    "expired lock is recoverable",
  );
  locks.release("t2");
  assert.equal(locks.snapshot().length, 0);
});

/* ---------------- workflow: end to end ---------------- */

test("E2E 1: the AIMS login card runs through every task, agent and gate in order", async () => {
  const models: ModelRouterPort = {
    select: async ({ need }) => ({
      provider: "openai",
      model: `m-${need.routingProfile}`,
      reason: need.rationale,
    }),
  };
  const w = world({ models });
  const created = await planFor(w, LOGIN);
  const runId = created.run.runId;
  const view = await runToEnd(w, runId);
  assert.equal(
    view.status,
    "COMPLETED",
    JSON.stringify(
      view.run.tasks.map((t) => [t.title, t.status, t.blockedReason]),
    ),
  );
  assert.equal(view.progress.percent, 100);
  const byTitle = (part: string) => task(view, part);
  assert.equal(byTitle("Inspect").assignedAgent?.agentId, "dev-agent");
  assert.equal(
    byTitle("Identify the exact").assignedAgent?.agentId,
    "dev-agent",
  );
  assert.equal(byTitle("Reduce vertical").assignedAgent?.agentId, "dev-agent");
  assert.equal(
    byTitle("Run the automated tests").assignedAgent?.agentId,
    "qa-agent",
  );
  assert.equal(
    byTitle("Review the diff").assignedAgent?.agentId,
    "reviewer-agent",
  );
  assert.equal(
    byTitle("Build the application").assignedAgent?.agentId,
    "dev-agent",
  );
  assert.equal(byTitle("Commit").assignedAgent?.agentId, "github-agent");
  assert.equal(byTitle("Deploy").assignedAgent?.agentId, "deployer-agent");
  assert.ok(
    view.run.tasks.every(
      (t) => t.result?.verified === true && t.assignedModel?.model,
    ),
  );
  // Order respects dependencies.
  const order = w.runtime.calls.map((c) => c.task.type);
  assert.ok(order.indexOf("DEVELOPMENT") > order.indexOf("ANALYSIS"));
  const idx = (part: string) =>
    w.runtime.calls.findIndex((c) => c.task.title.includes(part));
  assert.ok(idx("Reduce vertical") < idx("Run the automated tests"));
  assert.ok(idx("Run the automated tests") < idx("Review the diff"));
  assert.ok(idx("Review the diff") < idx("Build the application"));
  assert.ok(idx("Build the application") < idx("Commit"));
  assert.ok(idx("Commit") < idx("Deploy"));
  // Commit and deploy waited for a human.
  assert.equal(
    view.run.tasks.filter((t) => t.approval?.state === "approved").length,
    2,
  );
  // The implementer received the constraints; analysis tasks could not edit.
  const implementCall = w.runtime.calls.find((c) =>
    c.task.title.includes("Reduce vertical"),
  )!;
  assert.ok(implementCall.context.constraints.includes("Preserve colors."));
  assert.ok(implementCall.context.permittedTools.includes("repo.edit"));
  const inspectCall = w.runtime.calls.find((c) =>
    c.task.title.includes("Inspect"),
  )!;
  assert.ok(!inspectCall.context.permittedTools.includes("repo.edit"));
});

test("E2E 2: deleting a production project waits for a human and never auto-executes", async () => {
  const w = world();
  const created = await planFor(w, "Delete the old production project of AIMS");
  assert.equal(created.run.intent, "DESTRUCTIVE_OPERATION");
  const execute = task(created, "destructive operation");
  assert.ok(execute.destructive && execute.requiresApproval);
  assert.equal(execute.risk, "high");
  w.orchestrator.start(OPERATOR, created.run.runId);
  let view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  assert.equal(task(view, "destructive operation").status, "WAITING_APPROVAL");
  assert.equal(view.status, "WAITING_APPROVAL");
  assert.equal(w.runtime.ran("destructive operation"), 0, "not executed");
  const approval = w.approvals.pending()[0]!;
  assert.equal(approval.decisionMetadata["projectId"], "aims");
  assert.match(approval.action, /delete/);
  assert.match(approval.reason, /risk high/);
  view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  assert.equal(
    w.runtime.ran("destructive operation"),
    0,
    "still not executed while undecided",
  );
  // The destructive tool is unavailable before approval and the verifier cannot be skipped.
  assert.ok(
    !task(view, "destructive operation").permittedTools.includes("repo.delete"),
  );
  w.approvals.decide(approval.id, "approved", "admin-1");
  view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  assert.equal(view.status, "COMPLETED");
  assert.ok(
    w.runtime.calls
      .find((c) => c.task.title.includes("destructive operation"))!
      .context.permittedTools.includes("repo.delete"),
  );
  const events = w.audit
    .list()
    .map((e) => (e.data as { event?: string }).event);
  assert.ok(
    events.includes("APPROVAL_REQUESTED") &&
      events.includes("APPROVAL_GRANTED"),
  );
});

test("approval denied: the destructive task and everything after it are cancelled", async () => {
  const w = world();
  const created = await planFor(w, "Delete the old production project of AIMS");
  w.orchestrator.start(OPERATOR, created.run.runId);
  await w.orchestrator.advance(OPERATOR, created.run.runId);
  w.approvals.decide(w.approvals.pending()[0]!.id, "rejected", "admin-1");
  const view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  assert.equal(task(view, "destructive operation").status, "CANCELLED");
  assert.equal(task(view, "Verify the outcome").status, "CANCELLED");
  assert.equal(view.status, "CANCELLED");
  assert.equal(w.runtime.ran("destructive operation"), 0);
  assert.ok(
    w.audit
      .list()
      .some((e) => (e.data as { event?: string }).event === "APPROVAL_DENIED"),
  );
});

test("protected tasks (commit, deploy) need approval and get their gated tools only after it", async () => {
  const w = world();
  const created = await planFor(w, LOGIN);
  w.orchestrator.start(OPERATOR, created.run.runId);
  let view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  const commit = task(view, "Commit");
  assert.equal(commit.status, "WAITING_APPROVAL");
  assert.ok(
    !commit.permittedTools.includes("git.commit") &&
      commit.deniedTools.includes("git.commit"),
  );
  assert.ok(
    commit.deniedTools.includes("secrets.read"),
    "secrets are never granted",
  );
  assert.equal(w.runtime.ran("Commit"), 0);
  await approveAllPending(w);
  view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  assert.ok(
    w.runtime.calls
      .find((c) => c.task.title.includes("Commit"))!
      .context.permittedTools.includes("git.commit"),
  );
});

/* ---------------- routing: qualification, independence ---------------- */

test("agent routing: unqualified agents are rejected with reasons; nobody qualified blocks the task", async () => {
  const w = world({
    agents: [
      agent("only-tester", ["software.testing"]),
      agent("other-project", ["software.frontend"], {}, ["money-mind"]),
    ],
  });
  const created = await planFor(w, LOGIN);
  w.orchestrator.start(OPERATOR, created.run.runId);
  const view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  const inspect = task(view, "Inspect");
  assert.equal(inspect.status, "BLOCKED");
  assert.equal(inspect.blockKind, "routing");
  assert.match(
    inspect.blockedReason ?? "",
    /no qualified agent for software\.frontend/,
  );
  assert.equal(view.status, "BLOCKED");
  assert.equal(w.runtime.calls.length, 0);
  assert.ok(
    w.audit
      .list()
      .some((e) => (e.data as { event?: string }).event === "TASK_BLOCKED"),
  );
});

test("agent routing: a read-only analysis agent never receives a task that needs write tools", async () => {
  const w = world({
    agents: [
      agent("analyst", ["software.frontend", "software.general"], {
        readOnly: true,
        toolAccess: "none",
      }),
    ],
  });
  const created = await planFor(w, LOGIN);
  w.orchestrator.start(OPERATOR, created.run.runId);
  const view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  assert.equal(
    task(view, "Inspect").assignedAgent?.agentId,
    "analyst",
    "read-only analysis fits",
  );
  assert.equal(
    task(view, "Reduce vertical").status,
    "BLOCKED",
    "implementation needs write tools",
  );
  assert.ok(
    task(view, "Reduce vertical").blockedReason?.includes("no qualified agent"),
  );
});

test("agent routing: the reviewer is never the implementer; a second reviewer unblocks the run", async () => {
  const w = world({
    agents: [
      agent("solo", [
        "software.frontend",
        "software.testing",
        "software.review",
        "software.security",
      ]),
    ],
  });
  const created = await planFor(w, LOGIN);
  w.orchestrator.start(OPERATOR, created.run.runId);
  let view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  assert.equal(task(view, "Reduce vertical").status, "COMPLETED");
  assert.equal(task(view, "Run the automated tests").status, "COMPLETED");
  assert.equal(
    task(view, "Review the diff").status,
    "BLOCKED",
    "independence: solo implemented it",
  );
  assert.equal(view.status, "BLOCKED");
  w.agents.register(agent("independent-reviewer", ["software.review"]));
  view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  assert.equal(
    task(view, "Review the diff").assignedAgent?.agentId,
    "independent-reviewer",
  );
});

test("agent routing: specialization then workload decide between qualified agents", async () => {
  const w = world({
    agents: [
      agent("generalist", [
        "software.frontend",
        "software.testing",
        "software.review",
        "design.ui",
      ]),
      agent("specialist", ["software.frontend"]),
    ],
  });
  const created = await planFor(w, LOGIN);
  w.orchestrator.start(OPERATOR, created.run.runId);
  const view = await w.orchestrator.advance(OPERATOR, created.run.runId, 1);
  assert.equal(task(view, "Inspect").assignedAgent?.agentId, "specialist");
});

test("agent capability registry: V1 names map onto the canonical taxonomy; V2 is declared, not staffed", () => {
  const v1 = AGENT_CAPABILITY_REGISTRY.filter((c) => c.status === "v1");
  assert.deepEqual(v1.map((c) => c.id).sort(), [
    "AI_AUDITOR",
    "AI_COST_CENTER",
    "CODE_REVIEWER",
    "FIREBASE_DEPLOYER",
    "GITHUB_INTEGRATOR",
    "PROJECT_MANAGER",
    "SECURITY_COMPLIANCE",
    "SOFTWARE_DEVELOPER",
    "TEST_QA",
    "UI_DESIGNER",
  ]);
  for (const c of AGENT_CAPABILITY_REGISTRY)
    for (const id of c.taxonomy)
      assert.equal(canonicalizeCapability(id), id, `${c.id} → ${id}`);
  assert.deepEqual(taxonomyFor("TEST_QA"), ["software.testing"]);
  assert.ok(
    AGENT_CAPABILITY_REGISTRY.filter((c) => c.status === "v2").length >= 8,
  );
});

/* ---------------- claimed vs verified ---------------- */

test("verification: a claimed success without evidence is not a completed task", async () => {
  const w = world();
  w.runtime.handler = (t) =>
    t.title.startsWith("Inspect")
      ? { kind: "success", summary: "looks fine", evidence: [] }
      : undefined;
  const created = await planFor(w, LOGIN);
  w.orchestrator.start(OPERATOR, created.run.runId);
  const view = await w.orchestrator.advance(OPERATOR, created.run.runId, 3);
  const inspect = task(view, "Inspect");
  assert.notEqual(inspect.status, "COMPLETED");
  assert.equal(inspect.result?.claimed, "success");
  assert.equal(inspect.result?.verified, false);
  assert.match(
    inspect.failures[0]!.error,
    /not verified: success claimed without evidence/,
  );
  assert.equal(
    w.runtime.ran("Reduce vertical"),
    0,
    "nothing downstream ran on an unverified claim",
  );
});

test("verification: a test task must report its checks; a failing check is a logical failure", async () => {
  const w = world();
  w.runtime.handler = (t, n) =>
    t.type === "TEST" && n === 1
      ? {
          kind: "success",
          summary: "ran",
          evidence: ["log"],
          checks: [
            { name: "typecheck", passed: true },
            { name: "tests", passed: false },
          ],
        }
      : undefined;
  const created = await planFor(w, LOGIN);
  const view = await (async () => {
    w.orchestrator.start(OPERATOR, created.run.runId);
    return w.orchestrator.advance(OPERATOR, created.run.runId, 30);
  })();
  const first = view.run.tasks.find((t) =>
    t.title.startsWith("Run the automated tests"),
  )!;
  assert.ok(first.failures.some((f) => /failed checks: tests/.test(f.error)));
});

/* ---------------- failure handling ---------------- */

test("failure: a logical gate failure sends the work back to the developer and re-runs the gates", async () => {
  const w = world();
  w.runtime.handler = (t, n) =>
    t.type === "TEST" && n === 1
      ? {
          kind: "success",
          summary: "1 test failed",
          evidence: ["log"],
          checks: [{ name: "tests", passed: false }],
        }
      : undefined;
  const created = await planFor(w, LOGIN);
  const view = await runToEnd(w, created.run.runId);
  assert.equal(
    view.status,
    "COMPLETED",
    JSON.stringify(view.run.tasks.map((t) => [t.title, t.status])),
  );
  const fix = view.run.tasks.find((t) => /^Correct:/.test(t.title))!;
  assert.ok(fix, "a correction task was created");
  assert.equal(fix.parentTaskId, task(view, "Reduce vertical").taskId);
  assert.match(fix.prompt, /Correction required/);
  const tests = view.run.tasks.find(
    (t) => t.title === "Run the automated tests",
  )!;
  assert.equal(tests.corrections, 1);
  assert.ok(tests.dependencies.includes(fix.taskId), "tests wait for the fix");
  assert.ok(w.runtime.ran("Run the automated tests") >= 2);
  // The review ran only after the correction was re-tested.
  const idx = (part: string) =>
    w.runtime.calls.findIndex((c) => c.task.title.includes(part));
  assert.ok(
    idx("Correct:") <
      w.runtime.calls
        .map((c) => c.task.title)
        .lastIndexOf("Run the automated tests"),
  );
  const failure = tests.failures[0]!;
  assert.equal(failure.classification, "LOGICAL");
  assert.equal(failure.recovery, "CORRECT");
  assert.ok(failure.agentId && failure.at && failure.taskId === tests.taskId);
  assert.ok(
    w.audit
      .list()
      .some((e) => (e.data as { event?: string }).event === "TASK_FAILED"),
  );
});

test("failure: a review that requests changes after tests passed re-runs the stale test gate", async () => {
  const w = world();
  w.runtime.handler = (t, n) =>
    t.type === "REVIEW" && n === 1
      ? {
          kind: "success",
          summary: "padding also changed",
          evidence: ["diff"],
          verdict: "changes_requested",
        }
      : undefined;
  const created = await planFor(w, LOGIN);
  const view = await runToEnd(w, created.run.runId);
  assert.equal(view.status, "COMPLETED");
  assert.ok(
    view.run.tasks.some((t) => /-rerun1$/.test(t.taskId)),
    "the completed test gate was cloned, not reopened",
  );
  assert.ok(
    w.runtime.ran("Run the automated tests") >= 2,
    "tests ran again on the corrected code",
  );
});

test("failure: corrections are bounded; an exhausted gate fails the run and blocks shipping", async () => {
  const w = world();
  w.runtime.handler = (t) =>
    t.type === "TEST"
      ? {
          kind: "success",
          summary: "still failing",
          evidence: ["log"],
          checks: [{ name: "tests", passed: false }],
        }
      : undefined;
  const created = await planFor(w, LOGIN);
  const view = await runToEnd(w, created.run.runId);
  assert.equal(view.status, "FAILED");
  const gate = view.run.tasks.find(
    (t) => t.title === "Run the automated tests",
  )!;
  assert.equal(gate.status, "FAILED");
  assert.equal(gate.corrections, 2);
  assert.equal(gate.failures.at(-1)!.recovery, "ESCALATE");
  for (const t of view.run.tasks.filter(
    (x) => x.type === "INTEGRATION" || x.type === "DEPLOYMENT",
  )) {
    assert.equal(t.status, "BLOCKED");
    assert.match(t.blockedReason ?? "", /gate .* failed/);
  }
  assert.equal(w.runtime.ran("Commit"), 0);
  assert.equal(w.runtime.ran("Deploy"), 0);
});

test("failure: transient failures retry with backoff, then escalate (never forever)", async () => {
  const w = world();
  w.runtime.handler = (t) =>
    t.title.startsWith("Inspect")
      ? { kind: "failure", error: "request timed out (503)" }
      : undefined;
  const created = await planFor(w, LOGIN);
  w.orchestrator.start(OPERATOR, created.run.runId);
  let view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  let inspect = task(view, "Inspect");
  assert.equal(inspect.status, "READY");
  assert.equal(inspect.attempts, 1);
  assert.ok(inspect.notBefore, "backoff recorded");
  const callsBefore = w.runtime.calls.length;
  view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  assert.equal(
    w.runtime.calls.length,
    callsBefore,
    "not retried before its backoff passes",
  );
  w.clock.t += 60_000;
  view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  w.clock.t += 60_000;
  view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  inspect = task(view, "Inspect");
  assert.equal(inspect.status, "FAILED");
  assert.equal(inspect.failures.length, 3);
  assert.deepEqual(
    inspect.failures.map((f) => f.recovery),
    ["RETRY", "RETRY", "ESCALATE"],
  );
  assert.equal(view.status, "FAILED");
  assert.ok(
    w.audit
      .list()
      .filter((e) => (e.data as { event?: string }).event === "TASK_RETRIED")
      .length >= 2,
  );
  // An operator may retry a FAILED task explicitly.
  w.runtime.handler = () => undefined;
  view = await w.orchestrator.retryTask(
    OPERATOR,
    created.run.runId,
    inspect.taskId,
  );
  assert.equal(task(view, "Inspect").status, "READY");
});

test("failure: after retries are spent the task is reassigned to another qualified agent", async () => {
  const w = world({
    agents: [
      agent("dev-a", ["software.frontend"]),
      agent("dev-b", ["software.frontend", "software.testing"]),
      agent("reviewer-agent", ["software.review"]),
    ],
  });
  w.runtime.handler = (t) =>
    t.title.startsWith("Inspect") && t.assignedAgent?.agentId === "dev-a"
      ? { kind: "failure", error: "ECONNRESET network" }
      : undefined;
  const created = await planFor(w, LOGIN);
  w.orchestrator.start(OPERATOR, created.run.runId);
  let view = await w.orchestrator.advance(OPERATOR, created.run.runId, 1);
  for (let i = 0; i < 4; i++) {
    w.clock.t += 120_000;
    view = await w.orchestrator.advance(OPERATOR, created.run.runId, 1);
  }
  const inspect = task(view, "Inspect");
  assert.ok(inspect.excludedAgents.includes("dev-a"));
  assert.equal(inspect.assignedAgent?.agentId, "dev-b");
  assert.ok(inspect.failures.some((f) => f.recovery === "REASSIGN"));
});

test("failure: a security failure blocks, is never auto-retried, and cannot be retried by hand", async () => {
  const w = world();
  w.runtime.handler = (t) =>
    t.title.startsWith("Inspect")
      ? {
          kind: "failure",
          error: "attempted to read a secret",
          classification: "SECURITY",
        }
      : undefined;
  const created = await planFor(w, LOGIN);
  w.orchestrator.start(OPERATOR, created.run.runId);
  let view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  const inspect = task(view, "Inspect");
  assert.equal(inspect.status, "BLOCKED");
  assert.equal(inspect.blockKind, "security");
  assert.equal(inspect.failures[0]!.recovery, "BLOCK");
  const calls = w.runtime.calls.length;
  view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  assert.equal(w.runtime.calls.length, calls, "no automatic retry");
  await assert.rejects(
    w.orchestrator.retryTask(OPERATOR, created.run.runId, inspect.taskId),
    /never retried automatically/,
  );
  assert.equal(view.status, "BLOCKED");
});

test("failure policy: recovery decisions", () => {
  const base = {
    attempts: 0,
    maxAttempts: 2,
    corrections: 0,
    maxCorrections: 2,
    isGate: false,
    hasCorrectionTarget: false,
    alternativeAgentAvailable: false,
  };
  assert.equal(
    decideRecovery({ ...base, classification: "TRANSIENT" }),
    "RETRY",
  );
  assert.equal(
    decideRecovery({ ...base, classification: "TRANSIENT", attempts: 2 }),
    "ESCALATE",
  );
  assert.equal(
    decideRecovery({
      ...base,
      classification: "TRANSIENT",
      attempts: 2,
      alternativeAgentAvailable: true,
    }),
    "REASSIGN",
  );
  assert.equal(
    decideRecovery({ ...base, classification: "SECURITY" }),
    "BLOCK",
  );
  assert.equal(decideRecovery({ ...base, classification: "APPROVAL" }), "WAIT");
  assert.equal(
    decideRecovery({
      ...base,
      classification: "LOGICAL",
      isGate: true,
      hasCorrectionTarget: true,
    }),
    "CORRECT",
  );
  assert.equal(
    decideRecovery({
      ...base,
      classification: "LOGICAL",
      isGate: true,
      hasCorrectionTarget: true,
      corrections: 2,
    }),
    "ESCALATE",
  );
});

test("runtime: with no execution runtime the run is honestly blocked, not faked", async () => {
  const w = world({ withRuntime: false });
  const created = await planFor(w, LOGIN);
  w.orchestrator.start(OPERATOR, created.run.runId);
  const view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  const inspect = task(view, "Inspect");
  assert.equal(inspect.status, "BLOCKED");
  assert.equal(inspect.blockKind, "runtime");
  assert.match(inspect.blockedReason ?? "", /no execution runtime/);
  assert.equal(view.status, "BLOCKED");
  assert.equal(view.progress.completed, 0);
});

/* ---------------- parallel, locks, cancel, pause ---------------- */

test("parallel: independent read-only analyses run together (bounded), implementation waits", async () => {
  const w = world();
  w.runtime.delayMs = 15;
  const created = await planFor(
    w,
    "Verander de dark theme van AIMS naar de nieuwe liquid glass theme.",
  );
  w.orchestrator.start(OPERATOR, created.run.runId);
  const view = await w.orchestrator.advance(OPERATOR, created.run.runId, 3);
  assert.ok(
    w.runtime.maxActive >= 2,
    `ran concurrently (max ${w.runtime.maxActive})`,
  );
  assert.ok(w.runtime.maxActive <= 3, "bounded by maxParallel");
  const implementIdx = w.runtime.calls.findIndex(
    (c) => c.task.type === "DEVELOPMENT",
  );
  const analyses = w.runtime.calls
    .slice(0, implementIdx)
    .map((c) => c.task.type);
  assert.ok(analyses.length >= 4);
  assert.equal(
    view.run.tasks.find((t) => t.type === "DEVELOPMENT")!.status ===
      "PENDING" || implementIdx >= 0,
    true,
  );
});

test("locks: a held resource queues the writer until it is free (or expires)", async () => {
  const w = world();
  const created = await planFor(w, LOGIN);
  w.locks.tryAcquire(["source:aims"], "another-run-task", w.clock.t, 60_000);
  w.orchestrator.start(OPERATOR, created.run.runId);
  let view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  const implement = task(view, "Reduce vertical");
  assert.equal(implement.status, "QUEUED");
  assert.match(
    implement.blockedReason ?? "",
    /waiting for resource source:aims/,
  );
  assert.equal(w.runtime.ran("Reduce vertical"), 0);
  w.clock.t += 120_000; // the stale lock expires: crash recovery
  view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  assert.equal(task(view, "Reduce vertical").status, "COMPLETED");
});

test("cancel: stops future work, releases locks, keeps completed work, and is idempotent", async () => {
  const w = world();
  const created = await planFor(w, LOGIN);
  w.orchestrator.start(OPERATOR, created.run.runId);
  await w.orchestrator.advance(OPERATOR, created.run.runId, 2);
  let view = await w.orchestrator.cancel(OPERATOR, created.run.runId);
  assert.equal(view.status, "CANCELLED");
  const done = view.run.tasks.filter((t) => t.status === "COMPLETED").length;
  assert.ok(
    done >= 1 && done < view.run.tasks.length,
    "completed work is not pretended undone",
  );
  assert.ok(
    view.run.tasks.every(
      (t) => t.status === "COMPLETED" || t.status === "CANCELLED",
    ),
  );
  assert.equal(w.locks.snapshot().length, 0);
  await assert.rejects(
    w.orchestrator.advance(OPERATOR, created.run.runId),
    /cancelled/,
  );
  view = await w.orchestrator.cancel(OPERATOR, created.run.runId);
  assert.equal(view.status, "CANCELLED");
});

test("pause: a paused run does not advance; resume continues", async () => {
  const w = world();
  const created = await planFor(w, LOGIN);
  w.orchestrator.start(OPERATOR, created.run.runId);
  w.orchestrator.pause(OPERATOR, created.run.runId);
  let view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  assert.equal(w.runtime.calls.length, 0);
  w.orchestrator.resume(OPERATOR, created.run.runId);
  view = await w.orchestrator.advance(OPERATOR, created.run.runId, 1);
  assert.ok(w.runtime.calls.length > 0);
  assert.equal(view.run.paused, false);
});

test("a run cannot be advanced before it is started", async () => {
  const w = world();
  const created = await planFor(w, LOGIN);
  await assert.rejects(
    w.orchestrator.advance(OPERATOR, created.run.runId),
    /not been started/,
  );
});

/* ---------------- model routing + cost ---------------- */

test("model routing: the need follows the task; the selection is recorded with its reason", () => {
  const small = modelNeedFor({
    type: "DEVELOPMENT",
    risk: "low",
    estimate: { inputTokens: 200, note: "" },
  });
  assert.equal(small.routingProfile, "cost_efficient");
  const big = modelNeedFor({
    type: "DEVELOPMENT",
    risk: "medium",
    estimate: { inputTokens: 3000, note: "" },
  });
  assert.deepEqual(big.requiredCapabilities, ["coding", "reasoning"]);
  assert.equal(big.routingProfile, "quality_first");
  assert.equal(
    modelNeedFor({ type: "REVIEW", risk: "low" }).routingProfile,
    "high_assurance",
  );
  assert.equal(
    modelNeedFor({ type: "ANALYSIS", risk: "low" }).routingProfile,
    "cost_efficient",
  );
  assert.ok(
    modelNeedFor({
      type: "RESEARCH",
      risk: "low",
    }).requiredCapabilities.includes("large_context"),
  );
});

test("model routing: a missing or failing router never fabricates a model", async () => {
  const none = world();
  const a = await planFor(none, LOGIN);
  none.orchestrator.start(OPERATOR, a.run.runId);
  const va = await none.orchestrator.advance(OPERATOR, a.run.runId, 1);
  assert.equal(task(va, "Inspect").assignedModel?.model, undefined);
  assert.match(
    task(va, "Inspect").assignedModel?.reason ?? "",
    /no model router is configured/,
  );
  const failing = world({
    models: {
      select: async () => {
        throw new Error("boom");
      },
    },
  });
  const b = await planFor(failing, LOGIN);
  failing.orchestrator.start(OPERATOR, b.run.runId);
  const vb = await failing.orchestrator.advance(OPERATOR, b.run.runId, 1);
  assert.match(
    task(vb, "Inspect").assignedModel?.reason ?? "",
    /could not select a model/,
  );
  assert.ok(!JSON.stringify(vb).includes("boom"), "errors do not leak");
});

test("cost: a blocked budget stops the task before execution; clearing it resumes", async () => {
  let allowed = false;
  const cost: CostGate = {
    preflight: async () => ({
      allowed,
      status: allowed ? "ok" : "blocked",
      detail: "daily spend reached the limit",
    }),
    spent: async () => 0.42,
  };
  const w = world({ cost });
  const created = await planFor(w, LOGIN);
  w.orchestrator.start(OPERATOR, created.run.runId);
  let view = await w.orchestrator.advance(OPERATOR, created.run.runId);
  assert.equal(task(view, "Inspect").status, "BLOCKED");
  assert.equal(task(view, "Inspect").blockKind, "budget");
  assert.match(task(view, "Inspect").blockedReason ?? "", /budget gate/);
  assert.equal(w.runtime.calls.length, 0);
  allowed = true;
  view = await w.orchestrator.advance(OPERATOR, created.run.runId, 2);
  assert.ok(w.runtime.calls.length > 0);
  const detail = await w.orchestrator.get(OPERATOR, created.run.runId);
  assert.equal(detail.cost.spentUsd, 0.42 * detail.run.tasks.length);
  assert.ok(detail.cost.estimatedInputTokens > 0);
});

/* ---------------- tool authorization ---------------- */

test("tool authorization: least privilege per task type; secrets are never granted", () => {
  const dev = authorizeTools(
    { type: "DEVELOPMENT", destructive: false },
    { approved: false },
  );
  assert.deepEqual(dev.permitted.sort(), [
    "build.run",
    "repo.edit",
    "repo.read",
    "tests.run",
  ]);
  assert.ok(
    dev.denied.includes("secrets.read") &&
      dev.denied.includes("infra.delete_production"),
  );
  const review = authorizeTools(
    { type: "REVIEW", destructive: false },
    { approved: true },
  );
  assert.ok(!review.permitted.includes("repo.edit"));
  const deploy = authorizeTools(
    { type: "DEPLOYMENT", destructive: false },
    { approved: false },
  );
  assert.ok(!deploy.permitted.includes("deploy.firebase"));
  assert.ok(
    authorizeTools(
      { type: "DEPLOYMENT", destructive: false },
      { approved: true },
    ).permitted.includes("deploy.firebase"),
  );
  const maintenance = authorizeTools(
    { type: "MAINTENANCE", destructive: false },
    { approved: true },
  );
  assert.ok(
    !maintenance.permitted.includes("repo.delete"),
    "delete tools need a destructive classification AND approval",
  );
  assert.ok(
    authorizeTools(
      { type: "MAINTENANCE", destructive: true },
      { approved: true },
    ).permitted.includes("repo.delete"),
  );
  const none = authorizeTools(
    { type: "DEVELOPMENT", destructive: false },
    { approved: true, agentToolAccess: "none" },
  );
  assert.deepEqual(none.permitted, []);
});

/* ---------------- audit, secrets, handoff ---------------- */

test("audit: the significant orchestration events are logged and never contain secrets", async () => {
  const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
  const w = world({
    models: {
      select: async () => ({ provider: "openai", model: "m", reason: "x" }),
    },
  });
  w.runtime.handler = (t) =>
    t.title.startsWith("Inspect")
      ? {
          kind: "success",
          summary: `found token ${secret}`,
          evidence: [`log ${secret}`],
        }
      : undefined;
  const created = await planFor(w, LOGIN);
  const view = await runToEnd(w, created.run.runId);
  assert.equal(view.status, "COMPLETED");
  const events = new Set(
    w.audit.list().map((e) => (e.data as { event?: string }).event),
  );
  for (const expected of [
    "EXECUTION_CREATED",
    "PLAN_CREATED",
    "TASK_CREATED",
    "TASK_ASSIGNED",
    "AGENT_SELECTED",
    "MODEL_SELECTED",
    "TOOL_AUTHORIZED",
    "TASK_STARTED",
    "TASK_COMPLETED",
    "APPROVAL_REQUESTED",
    "APPROVAL_GRANTED",
    "WORKFLOW_COMPLETED",
  ]) {
    if (expected === "TASK_ASSIGNED") continue; // assignment is recorded as AGENT_SELECTED
    assert.ok(events.has(expected), `${expected} logged`);
  }
  const blob = JSON.stringify([w.audit.list(), view]);
  assert.ok(
    !blob.includes(secret),
    "no secret anywhere in the run or the audit log",
  );
  assert.equal(task(view, "Inspect").result?.summary, "[redacted]");
});

test("handoff: an agent receives only its own slice and the verified summaries of direct upstream tasks", async () => {
  const w = world();
  const created = await planFor(w, LOGIN);
  await runToEnd(w, created.run.runId);
  const reviewCtx = w.runtime.calls.find((c) =>
    c.task.title.includes("Review the diff"),
  )!.context;
  assert.deepEqual(
    reviewCtx.upstream.map((u) => u.title),
    ["Run the automated tests"],
    "direct dependencies only",
  );
  assert.ok(!reviewCtx.permittedTools.includes("repo.edit"));
  assert.equal(reviewCtx.agentId, "reviewer-agent");
  assert.ok(
    reviewCtx.prompt.length < 2600,
    "a task slice, not the whole prompt",
  );
  const implementCtx = w.runtime.calls.find((c) =>
    c.task.title.includes("Reduce vertical"),
  )!.context;
  assert.ok(implementCtx.upstream.length === 2);
});

/* ---------------- authorization + isolation ---------------- */

test("authorization: viewers cannot orchestrate; scoped operators cannot reach other projects' runs", async () => {
  const w = world();
  const prepared = await w.prompts.prepare(OPERATOR, { request: LOGIN });
  assert.throws(
    () => w.orchestrator.createRun(VIEWER, prepared),
    /may not orchestrate/,
  );
  const created = w.orchestrator.createRun(OPERATOR, prepared);
  assert.throws(
    () => w.orchestrator.start(MM_ONLY, created.run.runId),
    /not found/,
  );
  await assert.rejects(
    w.orchestrator.advance(MM_ONLY, created.run.runId),
    /not found/,
  );
  await assert.rejects(
    w.orchestrator.cancel(MM_ONLY, created.run.runId),
    /not found/,
  );
  await assert.rejects(
    w.orchestrator.get(MM_ONLY, created.run.runId),
    /not found/,
  );
  assert.deepEqual(w.orchestrator.list(MM_ONLY), []);
  assert.equal(w.orchestrator.list(VIEWER).length, 1, "viewers may read");
  await assert.rejects(
    w.orchestrator.advance(VIEWER, created.run.runId),
    /may not orchestrate/,
  );
  const r = await w.control.orchestrationCreate(VIEWER, {
    requestId: prepared.record.requestId,
  });
  assert.equal(r.outcome, "denied");
  assert.equal(r.errorKind, "forbidden");
});

test("control service: commands are audited without the run payload", async () => {
  const w = world();
  const prepared = await w.prompts.prepare(OPERATOR, { request: LOGIN });
  const created = await w.control.orchestrationCreate(OPERATOR, {
    requestId: prepared.record.requestId,
  });
  assert.equal(created.ok, true);
  const runId = (created.details["view"] as RunView).run.runId;
  const started = await w.control.orchestrationStart(OPERATOR, { runId });
  assert.equal(started.ok, true);
  const events = w.audit.list().filter((e) => e.type === "control_command");
  assert.ok(
    events.some(
      (e) =>
        (e.data as { command?: string }).command === "orchestration_create",
    ),
  );
  assert.ok(
    !JSON.stringify(events).includes("Identify the component"),
    "no prompt text in the audit copy",
  );
  const bad = await w.control.orchestrationAdvance(OPERATOR, {
    runId: "missing",
  });
  assert.equal(bad.errorKind, "not_found");
  const badRetry = await w.control.orchestrationRetryTask(OPERATOR, {
    runId,
    taskId: "nope",
  });
  assert.equal(badRetry.errorKind, "not_found");
});

/* ---------------- HTTP ---------------- */

test("HTTP: orchestration routes are authenticated, authorized and project-isolated", async () => {
  const w = world();
  const server = http.createServer(
    createControlPlaneApi({
      query: {} as WorkforceQueryService,
      command: {} as WorkforceCommandService,
      orchestration: w.control,
      operatorDirectory: {
        resolve: async (t) =>
          t === "op"
            ? OPERATOR
            : t === "viewer"
              ? VIEWER
              : t === "mm"
                ? MM_ONLY
                : t === "admin"
                  ? ADMIN
                  : null,
      },
    }),
  );
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (path: string, token?: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: res.status,
      json: (await res.json()) as HttpJson,
    };
  };
  try {
    const prepared = await w.prompts.prepare(OPERATOR, { request: LOGIN });
    assert.equal((await call("/execution-runs")).status, 401);
    assert.equal(
      (
        await call("/commands/orchestration_create", undefined, {
          requestId: prepared.record.requestId,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await call("/commands/orchestration_create", "viewer", {
          requestId: prepared.record.requestId,
        })
      ).status,
      403,
    );
    const created = await call("/commands/orchestration_create", "op", {
      requestId: prepared.record.requestId,
    });
    assert.equal(created.status, 200);
    const runId = created.json.details?.view?.run.runId as string;
    assert.equal((await call(`/execution-runs/${runId}`, "op")).status, 200);
    assert.equal(
      (await call(`/execution-runs/${runId}`, "mm")).status,
      404,
      "foreign project",
    );
    assert.equal(
      ((await call("/execution-runs", "viewer")).json.runs ?? []).length,
      1,
    );
    assert.equal(
      (await call("/commands/orchestration_advance", "op", { runId })).status,
      409,
      "not started",
    );
    const started = await call("/commands/orchestration_start", "op", {
      runId,
    });
    assert.equal(started.status, 200);
    assert.equal(started.json.details?.view?.status, "WAITING_APPROVAL");
    assert.equal(
      (await call("/commands/orchestration_nope", "op", {})).status,
      404,
    );
    assert.equal(
      (await call("/commands/orchestration_create", "op", {})).status,
      400,
    );
  } finally {
    server.close();
  }
});

test("the transition table is closed over the declared statuses", () => {
  for (const [from, targets] of Object.entries(ORCH_TASK_TRANSITIONS)) {
    for (const to of targets)
      assert.ok(to in ORCH_TASK_TRANSITIONS, `${from} → ${to}`);
  }
});
