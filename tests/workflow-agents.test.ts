import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  AgentExecutionError,
  AuditLog,
  HandoffSystem,
  ValidationError,
  validateProjectManagerTask,
  type ModelProvider,
  type ModelRequest,
  type Task,
} from "../core/index.js";
import {
  ProjectManagerAgent,
  makeProjectManagerAgentDefinition,
} from "../agents/project-manager/index.js";
import {
  DeveloperAgent,
  makeDeveloperAgentDefinition,
} from "../agents/developer/index.js";
import { QaAgent, makeQaAgentDefinition } from "../agents/qa/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

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

function fakeTask(
  type: string,
  input: unknown,
  over: Partial<Task> = {},
): Task {
  const ts = "2026-01-01T00:00:00.000Z";
  return {
    id: "task_1",
    type,
    description: "test task",
    projectId: "proj-x",
    priority: "normal",
    status: "running",
    input,
    output: undefined,
    errors: [],
    requiredPermissions: [],
    createdAt: ts,
    updatedAt: ts,
    metadata: {},
    ...over,
  };
}

const PM_DEF = makeProjectManagerAgentDefinition({
  allowedProjects: ["proj-x"],
});
const DEV_DEF = makeDeveloperAgentDefinition({ allowedProjects: ["proj-x"] });
const QA_DEF = makeQaAgentDefinition({ allowedProjects: ["proj-x"] });

/* ------------------------------------------------------------------ */
/* Project Manager Agent                                              */
/* ------------------------------------------------------------------ */

test("project manager: decompose produces a validated, dependency-ordered plan", async () => {
  const decomposition = JSON.stringify({
    summary: "Plan the work",
    subtasks: [
      {
        id: "research",
        type: "research",
        description: "look into it",
        recommendedCapability: "web_research",
        dependsOn: [],
        acceptanceCriteria: ["found sources"],
      },
      {
        id: "build",
        type: "development",
        description: "implement",
        recommendedAgentId: "developer-agent",
        dependsOn: ["research"],
        acceptanceCriteria: ["builds"],
      },
    ],
    risks: ["scope creep"],
    assumptions: ["stable requirements"],
    recommendation: "proceed",
  });
  const agent = new ProjectManagerAgent({
    model: scriptedModel([decomposition]),
    audit: new AuditLog(),
  });
  const output = (await agent.execute(
    PM_DEF,
    fakeTask("project-manager-plan", {
      mode: "decompose",
      objective: "ship the feature",
    }),
  )) as { mode: string; subtasks: unknown[]; recommendation: string };
  assert.equal(output.mode, "decompose");
  assert.equal(output.subtasks.length, 2);
  assert.equal(output.recommendation, "proceed");
});

test("project manager: unparseable model output is a structured model_failure", async () => {
  const agent = new ProjectManagerAgent({
    model: scriptedModel(["not json"]),
    audit: new AuditLog(),
  });
  await assert.rejects(
    agent.execute(PM_DEF, fakeTask("project-manager-plan", { objective: "x" })),
    (error: unknown) => {
      assert.ok(error instanceof AgentExecutionError);
      assert.equal((error as AgentExecutionError).reason, "model_failure");
      return true;
    },
  );
});

test("project manager: a decomposition with an unknown dependency is a structured invalid_result", async () => {
  const bad = JSON.stringify({
    summary: "s",
    subtasks: [
      {
        id: "a",
        type: "t",
        description: "d",
        recommendedAgentId: "x",
        dependsOn: ["ghost"],
        acceptanceCriteria: ["c"],
      },
    ],
    recommendation: "proceed",
  });
  const agent = new ProjectManagerAgent({
    model: scriptedModel([bad]),
    audit: new AuditLog(),
  });
  await assert.rejects(
    agent.execute(PM_DEF, fakeTask("project-manager-plan", { objective: "x" })),
    (error: unknown) => {
      assert.equal((error as AgentExecutionError).reason, "invalid_result");
      return true;
    },
  );
});

test("project manager: summarize mode aggregates prior results into a final status", async () => {
  const summary = JSON.stringify({
    summary: "Everything finished",
    risks: [],
    assumptions: [],
    recommendation: "proceed",
    finalStatus: "completed",
  });
  const agent = new ProjectManagerAgent({
    model: scriptedModel([summary]),
    audit: new AuditLog(),
  });
  const output = (await agent.execute(
    PM_DEF,
    fakeTask("project-manager-plan", {
      mode: "summarize",
      objective: "ship the feature",
      priorResults: [
        { specId: "research", status: "completed", summary: "done" },
      ],
    }),
  )) as { mode: string; finalStatus: string; subtasks: unknown[] };
  assert.equal(output.mode, "summarize");
  assert.equal(output.finalStatus, "completed");
  assert.deepEqual(output.subtasks, []);
});

test("project manager: task validation rejects a blank objective", () => {
  assert.throws(
    () => validateProjectManagerTask({ objective: "" }),
    ValidationError,
  );
});

/* ------------------------------------------------------------------ */
/* Developer Agent                                                    */
/* ------------------------------------------------------------------ */

test("developer: produces a structured plan with proposed (not applied) changes", async () => {
  const result = JSON.stringify({
    summary: "Add validation",
    plan: ["read the module", "add a guard clause"],
    proposedChanges: [
      {
        description: "add input validation",
        rationale: "prevents bad state",
        riskLevel: "low",
      },
    ],
    risks: ["may need a migration"],
    openQuestions: [],
    recommendation: "ready_for_qa",
  });
  const agent = new DeveloperAgent({
    model: scriptedModel([result]),
    audit: new AuditLog(),
  });
  const output = (await agent.execute(
    DEV_DEF,
    fakeTask("development", {
      objective: "add validation",
      instructions: "validate the input field",
    }),
  )) as {
    proposedChanges: Array<{ riskLevel: string }>;
    recommendation: string;
  };
  assert.equal(output.recommendation, "ready_for_qa");
  assert.equal(output.proposedChanges[0]!.riskLevel, "low");
});

test("developer: an unrecognized risk level is normalized, not silently dropped", async () => {
  const odd = JSON.stringify({
    summary: "s",
    plan: [],
    proposedChanges: [
      { description: "d", rationale: "r", riskLevel: "extreme" },
    ],
    risks: [],
    openQuestions: [],
    recommendation: "ready_for_qa",
  });
  const agent = new DeveloperAgent({
    model: scriptedModel([odd]),
    audit: new AuditLog(),
  });
  const output = (await agent.execute(
    DEV_DEF,
    fakeTask("development", { objective: "x", instructions: "y" }),
  )) as { proposedChanges: Array<{ riskLevel: string }> };
  // an unrecognized level is not fabricated as "low" — it falls back to the
  // conservative "medium", never silently discarded.
  assert.equal(output.proposedChanges[0]!.riskLevel, "medium");
});

test("developer: a missing summary is a structured invalid_result", async () => {
  const bad = JSON.stringify({
    plan: [],
    proposedChanges: [],
    risks: [],
    openQuestions: [],
    recommendation: "ready_for_qa",
  });
  const agent = new DeveloperAgent({
    model: scriptedModel([bad]),
    audit: new AuditLog(),
  });
  await assert.rejects(
    agent.execute(
      DEV_DEF,
      fakeTask("development", { objective: "x", instructions: "y" }),
    ),
    (error: unknown) => {
      assert.equal((error as AgentExecutionError).reason, "invalid_result");
      return true;
    },
  );
});

test("developer: a throwing model is a structured model_failure", async () => {
  const agent = new DeveloperAgent({
    model: throwingModel("exploded"),
    audit: new AuditLog(),
  });
  await assert.rejects(
    agent.execute(
      DEV_DEF,
      fakeTask("development", { objective: "x", instructions: "y" }),
    ),
    (error: unknown) => {
      assert.equal((error as AgentExecutionError).reason, "model_failure");
      return true;
    },
  );
});

test("developer: has no filesystem or shell access anywhere in its source", () => {
  for (const file of walkTs(join(repoRoot, "agents", "developer"))) {
    const code = readFileSync(file, "utf8");
    assert.ok(
      !/node:fs|node:child_process|require\(["']fs["']\)|require\(["']child_process["']\)/.test(
        code,
      ),
      `${file} references fs/child_process`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* QA Agent                                                           */
/* ------------------------------------------------------------------ */

const criteria = ["renders correctly", "handles empty input"];

test("qa: PASS when every criterion is satisfied with evidence", async () => {
  const result = JSON.stringify({
    verdict: "pass",
    findings: criteria.map((c) => ({
      criterion: c,
      satisfied: true,
      evidence: "verified in review",
    })),
    defects: [],
    recommendation: "ship it",
  });
  const agent = new QaAgent({
    model: scriptedModel([result]),
    audit: new AuditLog(),
  });
  const output = (await agent.execute(
    QA_DEF,
    fakeTask("qa", {
      objective: "verify the widget",
      acceptanceCriteria: criteria,
    }),
  )) as { verdict: string };
  assert.equal(output.verdict, "pass");
});

test("qa: FAIL when a criterion is unsatisfied, with a defect reported", async () => {
  const result = JSON.stringify({
    verdict: "fail",
    findings: [
      { criterion: criteria[0], satisfied: true, evidence: "ok" },
      {
        criterion: criteria[1],
        satisfied: false,
        evidence: "crashes on empty input",
      },
    ],
    defects: [
      {
        id: "d1",
        severity: "high",
        description: "crash on empty input",
        remediation: "add a guard clause",
      },
    ],
    recommendation: "fix the crash before re-review",
  });
  const agent = new QaAgent({
    model: scriptedModel([result]),
    audit: new AuditLog(),
  });
  const output = (await agent.execute(
    QA_DEF,
    fakeTask("qa", {
      objective: "verify the widget",
      acceptanceCriteria: criteria,
    }),
  )) as { verdict: string; defects: Array<{ severity: string }> };
  assert.equal(output.verdict, "fail");
  assert.equal(output.defects[0]!.severity, "high");
});

test("qa: BLOCKED passes through when the model cannot evaluate", async () => {
  const result = JSON.stringify({
    verdict: "blocked",
    findings: [
      {
        criterion: criteria[0],
        satisfied: false,
        evidence: "artifact missing",
      },
    ],
    defects: [],
    recommendation: "provide the missing artifact",
  });
  const agent = new QaAgent({
    model: scriptedModel([result]),
    audit: new AuditLog(),
  });
  const output = (await agent.execute(
    QA_DEF,
    fakeTask("qa", { objective: "verify", acceptanceCriteria: [criteria[0]!] }),
  )) as { verdict: string };
  assert.equal(output.verdict, "blocked");
});

test("qa: cannot self-approve — a claimed pass with an unsatisfied finding is downgraded to fail", async () => {
  const inconsistent = JSON.stringify({
    verdict: "pass",
    findings: [
      { criterion: criteria[0], satisfied: true, evidence: "ok" },
      { criterion: criteria[1], satisfied: false, evidence: "actually broken" },
    ],
    defects: [],
    recommendation: "looks good", // model is wrong; the guard must override it
  });
  const agent = new QaAgent({
    model: scriptedModel([inconsistent]),
    audit: new AuditLog(),
  });
  const output = (await agent.execute(
    QA_DEF,
    fakeTask("qa", { objective: "verify", acceptanceCriteria: criteria }),
  )) as { verdict: string };
  assert.equal(output.verdict, "fail");
});

test("qa: cannot self-approve — a claimed pass with zero findings is downgraded to fail", async () => {
  const empty = JSON.stringify({
    verdict: "pass",
    findings: [],
    defects: [],
    recommendation: "all good",
  });
  const agent = new QaAgent({
    model: scriptedModel([empty]),
    audit: new AuditLog(),
  });
  const output = (await agent.execute(
    QA_DEF,
    fakeTask("qa", { objective: "verify", acceptanceCriteria: criteria }),
  )) as { verdict: string; findings: unknown[] };
  assert.equal(output.verdict, "fail");
  assert.equal(output.findings.length, criteria.length);
});

test("qa: a task with no acceptance criteria is a structured invalid_task", async () => {
  const agent = new QaAgent({
    model: scriptedModel(["{}"]),
    audit: new AuditLog(),
  });
  await assert.rejects(
    agent.execute(
      QA_DEF,
      fakeTask("qa", { objective: "verify", acceptanceCriteria: [] }),
    ),
    (error: unknown) => {
      assert.equal((error as AgentExecutionError).reason, "invalid_task");
      return true;
    },
  );
});

/* ------------------------------------------------------------------ */
/* Handoff (workflow-relevant paths not covered elsewhere)            */
/* ------------------------------------------------------------------ */

test("handoff: an explicit rejection is recorded with a reason", () => {
  const handoffs = new HandoffSystem();
  const proposed = handoffs.propose({
    taskId: "task_1",
    sourceAgentId: "developer-agent",
    destinationAgentId: "qa-agent",
    completedWork: "implemented the feature",
    remainingWork: "verify acceptance criteria",
    acceptanceCriteria: ["passes QA"],
  });
  const rejected = handoffs.reject(
    proposed.id,
    "artifact reference is missing",
  );
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.resolution, "artifact reference is missing");
});

test("handoff: an invalid handoff (same source and destination) is rejected before storage", () => {
  const handoffs = new HandoffSystem();
  assert.throws(
    () =>
      handoffs.propose({
        taskId: "task_1",
        sourceAgentId: "qa-agent",
        destinationAgentId: "qa-agent",
        completedWork: "x",
        remainingWork: "y",
        acceptanceCriteria: ["z"],
      }),
    /must differ/,
  );
  assert.equal(handoffs.list().length, 0);
});

/* ------------------------------------------------------------------ */
/* helpers                                                             */
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
