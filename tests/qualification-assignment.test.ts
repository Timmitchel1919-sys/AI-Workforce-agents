/**
 * Specialist qualification, assignment, write-scope and review-independence.
 *
 * Each test names the invariant it protects and the failure it prevents. The
 * recurring theme is that the platform must be able to say NO:
 *
 *   - `NO_QUALIFIED_AGENT` is a real outcome, and the task is BLOCKED.
 *   - An unqualified agent is never assigned "because it was available".
 *   - Two specialists never hold overlapping write scope at once.
 *   - An implementer never reviews its own change set.
 *   - Reassignment never returns work to the agent that just failed it, and
 *     never erases the failed attempt.
 *
 * A suite that only proves the happy path would pass just as well against a
 * router that assigns `agents[0]`, so every "no" here is asserted explicitly.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  NO_QUALIFIED_AGENT,
  SpecialistAssignmentService,
  InMemoryAssignmentRepository,
} from "../core/orchestrator/assignment-system.js";
import {
  scopeCovers,
  scopesConflict,
} from "../core/orchestrator/lease-manager.js";
import { AgentQualificationRouter } from "../core/environments/agent-qualification-router.js";
import { EnvironmentRegistry } from "../core/environments/environment-registry.js";
import { V1_SPECIALIST_WORKFORCE } from "../agents/specialists/v1-specialist-workforce.js";
import {
  ValidationError,
  StateTransitionError,
  type AgentDescriptor,
  type TaskRequirements,
  requiresIndependentReview,
  validateAssignment,
} from "../contracts/index.js";

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

/**
 * Fixtures are derived from the REAL V1 workforce, not from invented
 * descriptors. A test that passes against a shape the product does not ship is
 * not evidence about the product, so every base here is an actual registered
 * specialist and every override is a declared, visible change to it.
 */
const BY_ID = new Map(V1_SPECIALIST_WORKFORCE.map((d) => [d.id, d]));

function real(id: string): AgentDescriptor {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`fixture refers to an unknown V1 agent: ${id}`);
  return found;
}

function variant(
  id: string,
  overrides: Partial<AgentDescriptor>,
): AgentDescriptor {
  return { ...real(id), ...overrides } as AgentDescriptor;
}

function requirements(
  overrides: Partial<TaskRequirements> = {},
): TaskRequirements {
  return {
    projectId: "money-mind",
    taskType: "implementation",
    requiredCapabilities: ["software.backend"],
    riskLevel: "low",
    ...overrides,
  };
}

function service(
  descriptors: readonly AgentDescriptor[],
): SpecialistAssignmentService {
  return new SpecialistAssignmentService(
    new InMemoryAssignmentRepository(),
    () => descriptors,
    undefined,
    () => "2026-01-01T00:00:00.000Z",
  );
}

const BACKEND = real("backend-dev-v1");
const SECOND_BACKEND = variant("backend-dev-v1", { id: "backend-dev-v2" });
const FRONTEND = real("frontend-dev-v1");
const REVIEWER = real("reviewer-v1");

const router = new AgentQualificationRouter(new EnvironmentRegistry());

/* ------------------------------------------------------------------ */
/* 1. NO QUALIFIED AGENT is a real, blocking outcome                   */
/* ------------------------------------------------------------------ */

test("the whole V1 workforce qualifies only where it actually declares coverage", () => {
  // Every registered specialist, scored against one backend task. Agents from
  // other domains must be rejected with `missing_capability` — the point being
  // that shipping twelve specialists does not mean twelve agents can do
  // backend work.
  const outcome = router.qualify(requirements(), V1_SPECIALIST_WORKFORCE);
  assert.deepEqual(
    outcome.candidates.map((c) => c.id),
    ["backend-dev-v1"],
  );
  for (const e of outcome.evidence.filter((x) => !x.qualifies)) {
    assert.ok(
      e.reasonCodes.includes("missing_capability"),
      `${e.agentId} was rejected without a capability reason`,
    );
    assert.equal(
      new Set(e.reasonCodes).size,
      e.reasonCodes.length,
      `${e.agentId} reported a duplicated reason code`,
    );
  }
});

test("a generalist is not silently a specialist: software.general does not cover software.backend", () => {
  // This is a deliberate refusal. `software.general` is a SIBLING of
  // `software.backend` in the taxonomy, not an ancestor, so a generalist is not
  // auto-qualified for specialised backend work. The alternative — treating
  // `general` as a wildcard — is exactly the "everyone is a bit of everything"
  // fallback that would make the workforce unfalsifiable.
  const generalist = variant("software-dev-v1", {
    capabilities: ["software.general"],
  });
  assert.equal(
    router.qualifyDescriptor(
      generalist,
      requirements({ requiredCapabilities: ["software.backend"] }),
    ).qualifies,
    false,
  );
  assert.equal(
    router.qualifyDescriptor(
      generalist,
      requirements({ requiredCapabilities: ["software.general"] }),
    ).qualifies,
    true,
  );
});

test("NO QUALIFIED AGENT: a task with no matching specialist is BLOCKED, never approximated", () => {
  const outcome = service([BACKEND]).assign(
    requirements({ taskType: "design" }),
    {
      taskId: "task-1",
      assignedBy: "planner",
    },
  );
  assert.equal(outcome.status, "blocked");
  if (outcome.status !== "blocked") return;
  assert.equal(outcome.reason, NO_QUALIFIED_AGENT);
  assert.equal(outcome.evidence.length, 1);
  assert.ok(outcome.evidence[0]!.reasonCodes.includes("missing_capability"));
});

test("NO QUALIFIED AGENT: an empty workforce blocks instead of defaulting to anyone", () => {
  const outcome = service([]).assign(requirements(), {
    taskId: "task-2",
    assignedBy: "planner",
  });
  assert.equal(outcome.status, "blocked");
  if (outcome.status !== "blocked") return;
  assert.deepEqual(outcome.evidence, []);
});

test("AVAILABLE != QUALIFIED: a free agent with the wrong capability is still rejected", () => {
  // frontend-dev-v1 is genuinely available; it is still the wrong specialist.
  const outcome = service([FRONTEND]).assign(requirements(), {
    taskId: "task-3",
    assignedBy: "planner",
  });
  assert.equal(outcome.status, "blocked");
});

/* ------------------------------------------------------------------ */
/* 2. Strict constraint checking                                      */
/* ------------------------------------------------------------------ */

test("project isolation: a money-mind agent cannot be assigned to another project", () => {
  const outcome = service([BACKEND]).assign(
    requirements({ projectId: "ai-workforce" }),
    { taskId: "task-4", assignedBy: "planner" },
  );
  assert.equal(outcome.status, "blocked");
  if (outcome.status !== "blocked") return;
  assert.ok(outcome.evidence[0]!.reasonCodes.includes("project_not_allowed"));
});

test("risk ceiling: a low-risk agent refuses a critical task", () => {
  const lowRisk = variant("backend-dev-v1", {
    qualification: {
      technologies: [],
      maxRiskLevel: "low",
      requiredToolCapabilities: [],
      reviewRequiredFromRiskLevel: "low",
    },
  });
  const outcome = service([lowRisk]).assign(
    requirements({ riskLevel: "critical" }),
    {
      taskId: "task-5",
      assignedBy: "planner",
    },
  );
  assert.equal(outcome.status, "blocked");
  if (outcome.status !== "blocked") return;
  assert.ok(outcome.evidence[0]!.reasonCodes.includes("risk_above_ceiling"));
});

test("tool ceiling: an agent may not be given a tool it does not declare", () => {
  const narrow = variant("backend-dev-v1", {
    toolPolicy: {
      maxExecutionCapabilities: ["filesystem.read"],
      deniedExecutionCapabilities: [],
      allowsUnrestrictedShell: false,
    },
  });
  const outcome = service([narrow]).assign(
    requirements({ toolRequirements: ["repository.commit"] }),
    { taskId: "task-6", assignedBy: "planner" },
  );
  assert.equal(outcome.status, "blocked");
  if (outcome.status !== "blocked") return;
  assert.ok(
    outcome.evidence[0]!.reasonCodes.includes("tool_capability_denied"),
  );
});

test("administrative lifecycle: a suspended agent receives no new work", () => {
  const suspended = variant("backend-dev-v1", {
    administrativeStatus: "suspended",
  });
  const outcome = service([suspended]).assign(requirements(), {
    taskId: "task-7",
    assignedBy: "planner",
  });
  assert.equal(outcome.status, "blocked");
  if (outcome.status !== "blocked") return;
  assert.ok(
    outcome.evidence[0]!.reasonCodes.includes("administratively_inactive"),
  );
});

test("capability hierarchy: a broad capability satisfies a narrow requirement, never the reverse", () => {
  const broad = variant("backend-dev-v1", { capabilities: ["software"] });
  assert.equal(
    router.qualifyDescriptor(
      broad,
      requirements({ requiredCapabilities: ["software.backend"] }),
    ).qualifies,
    true,
    "software must cover software.backend",
  );
  const narrow = variant("backend-dev-v1", {
    capabilities: ["software.backend"],
  });
  assert.equal(
    router.qualifyDescriptor(
      narrow,
      requirements({ requiredCapabilities: ["software"] }),
    ).qualifies,
    false,
    "software.backend must not cover software",
  );
});

test("preferred capabilities never disqualify a candidate", () => {
  const outcome = service([BACKEND]).assign(
    requirements({
      preferredCapabilities: ["software.backend", "software.frontend"],
    }),
    { taskId: "task-8", assignedBy: "planner" },
  );
  assert.equal(outcome.status, "assigned");
});

test("forged requirements are rejected before any agent is considered", () => {
  assert.throws(
    () =>
      router.qualify(
        { ...requirements(), requiredCapabilities: ["not a capability!"] },
        [BACKEND],
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      router.qualify({ ...requirements(), riskLevel: "apocalyptic" as never }, [
        BACKEND,
      ]),
    ValidationError,
  );
  for (const alias of ["code-review", "project-management", "ui-development"]) {
    assert.throws(
      () =>
        router.qualify({ ...requirements(), requiredCapabilities: [alias] }, [
          BACKEND,
        ]),
      ValidationError,
      `legacy alias ${JSON.stringify(alias)} must not be accepted as a canonical capability`,
    );
  }
  // Some single-segment labels are BOTH canonical ids and legacy aliases
  // ("backend" -> "software.backend"). That is stated here deliberately: a task
  // asking for the bare label does NOT match an agent that declares the
  // canonical id, so it fails closed to NO_QUALIFIED_AGENT rather than
  // qualifying on a coincidence of spelling.
  assert.equal(
    router.qualifyDescriptor(BACKEND, {
      ...requirements(),
      requiredCapabilities: ["backend"],
    }).qualifies,
    false,
  );
});

/* ------------------------------------------------------------------ */
/* 3. Assignment evidence is authoritative                            */
/* ------------------------------------------------------------------ */

test("an assignment carries the qualification evidence verbatim", () => {
  const outcome = service([BACKEND]).assign(requirements(), {
    taskId: "task-9",
    assignedBy: "planner",
  });
  assert.equal(outcome.status, "assigned");
  if (outcome.status !== "assigned") return;
  const a = outcome.assignment;
  assert.equal(a.agentId, "backend-dev-v1");
  assert.equal(a.descriptorVersion, 1);
  assert.equal(a.qualification.qualified, true);
  assert.deepEqual(a.qualification.matchedCapabilities, ["software.backend"]);
  assert.deepEqual(
    a.qualification.consideredLimitations,
    BACKEND.limitations,
    "the agent's stated limitations travel with the assignment",
  );
  assert.equal(
    a.qualification.consideredLimitations.length,
    BACKEND.limitations.length,
  );
  assert.equal(a.status, "assigned");
  assert.equal(a.assignedBy, "planner");
});

test("an assignment for an unqualified agent cannot be constructed at all", () => {
  assert.throws(
    () =>
      validateAssignment({
        assignmentId: "assign-1",
        projectId: "money-mind",
        taskId: "task-10",
        agentId: "backend-dev-v1",
        descriptorVersion: 1,
        status: "assigned",
        assignedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        assignedBy: "planner",
        qualification: {
          agentId: "backend-dev-v1",
          descriptorVersion: 1,
          qualified: false,
          matchedCapabilities: [],
          missingCapabilities: ["software.backend"],
          reasonCodes: ["missing_capability"],
          consideredLimitations: [],
          evaluatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    ValidationError,
  );
});

test("assignment lifecycle transitions are enforced, and terminal states are final", () => {
  const svc = service([BACKEND]);
  const outcome = svc.assign(requirements(), {
    taskId: "task-11",
    assignedBy: "planner",
  });
  assert.equal(outcome.status, "assigned");
  if (outcome.status !== "assigned") return;
  const id = outcome.assignment.assignmentId;
  assert.equal(svc.transition(id, "accepted").status, "accepted");
  assert.equal(svc.transition(id, "executing").status, "executing");
  assert.equal(svc.transition(id, "completed").status, "completed");
  assert.throws(() => svc.transition(id, "executing"), StateTransitionError);
});

test("deterministic selection: the same inputs always choose the same agent", () => {
  const a = variant("backend-dev-v1", { id: "aaa-dev-v1" });
  const b = variant("backend-dev-v1", { id: "bbb-dev-v1" });
  const first = router.qualify(requirements(), [a, b]).candidates[0]!.id;
  const second = router.qualify(requirements(), [b, a]).candidates[0]!.id;
  assert.equal(first, second);
});

/* ------------------------------------------------------------------ */
/* 4. Write scope is owned, not shared (§35, §67)                      */
/* ------------------------------------------------------------------ */

test("overlapping write scope is denied while another agent holds the lease", () => {
  const svc = service([BACKEND, FRONTEND]);
  const first = svc.assign(requirements({ writeScope: ["src/"] }), {
    taskId: "task-a",
    assignedBy: "planner",
    workspaceId: "ws-1",
    writeScope: ["src/"],
  });
  assert.equal(first.status, "assigned");

  assert.throws(
    () =>
      svc.assign(requirements({ writeScope: ["src/backend/"] }), {
        taskId: "task-b",
        assignedBy: "planner",
        workspaceId: "ws-1",
        writeScope: ["src/backend/"],
      }),
    StateTransitionError,
    "a second agent must not write inside a leased scope",
  );
});

test("disjoint write scopes may proceed concurrently", () => {
  const svc = service([BACKEND, FRONTEND]);
  const first = svc.assign(requirements({ writeScope: ["src/backend/"] }), {
    taskId: "task-c",
    assignedBy: "planner",
    workspaceId: "ws-1",
    writeScope: ["src/backend/"],
  });
  const second = svc.assign(requirements({ writeScope: ["src/frontend/"] }), {
    taskId: "task-d",
    assignedBy: "planner",
    workspaceId: "ws-1",
    writeScope: ["src/frontend/"],
  });
  assert.equal(first.status, "assigned");
  assert.equal(second.status, "assigned");
});

test("scope overlap is computed at path boundaries, not by string equality", () => {
  assert.equal(scopesConflict(["src/"], ["src/backend/"]), true);
  assert.equal(scopesConflict(["src"], ["src/app"]), true);
  assert.equal(scopesConflict(["src"], ["src-other"]), false);
  assert.equal(scopesConflict(["*"], ["anything"]), true);
  assert.equal(scopeCovers(["src/"], "src/app/index.ts"), true);
  assert.equal(scopeCovers(["src/index.ts"], "src/other.ts"), false);
});

test("completing a task releases its write scope for the next task", () => {
  const svc = service([BACKEND, FRONTEND]);
  const first = svc.assign(requirements({ writeScope: ["src/"] }), {
    taskId: "task-e",
    assignedBy: "planner",
    workspaceId: "ws-1",
    writeScope: ["src/"],
  });
  assert.equal(first.status, "assigned");
  if (first.status !== "assigned") return;
  svc.transition(first.assignment.assignmentId, "accepted");
  svc.transition(first.assignment.assignmentId, "executing");
  svc.transition(first.assignment.assignmentId, "completed");

  const second = svc.assign(requirements({ writeScope: ["src/"] }), {
    taskId: "task-f",
    assignedBy: "planner",
    workspaceId: "ws-1",
    writeScope: ["src/"],
  });
  assert.equal(
    second.status,
    "assigned",
    "a completed task must not hold the workspace forever",
  );
});

test("write scope is enforced at the execution boundary", () => {
  const svc = service([BACKEND]);
  const outcome = svc.assign(requirements({ writeScope: ["src/"] }), {
    taskId: "task-g",
    assignedBy: "planner",
    workspaceId: "ws-1",
    writeScope: ["src/"],
  });
  assert.equal(outcome.status, "assigned");
  assert.equal(svc.mayWrite("ws-1", "backend-dev-v1", "src/api.ts"), true);
  assert.equal(svc.mayWrite("ws-1", "backend-dev-v1", "docs/readme.md"), false);
  assert.equal(svc.mayWrite("ws-1", "frontend-dev-v1", "src/api.ts"), false);
});

test("a lease scope cannot escape the workspace", () => {
  const svc = service([BACKEND]);
  assert.throws(
    () =>
      svc.assign(requirements({ writeScope: ["../../etc/"] }), {
        taskId: "task-h",
        assignedBy: "planner",
        workspaceId: "ws-1",
        writeScope: ["../../etc/"],
      }),
    ValidationError,
  );
});

/* ------------------------------------------------------------------ */
/* 5. Reassignment (§32, §50, §66)                                    */
/* ------------------------------------------------------------------ */

test("reassignment: a failed task goes to a DIFFERENT qualified agent", () => {
  const svc = service([BACKEND, SECOND_BACKEND]);
  const first = svc.assign(requirements(), {
    taskId: "task-i",
    assignedBy: "planner",
  });
  assert.equal(first.status, "assigned");
  if (first.status !== "assigned") return;

  const second = svc.reassign(
    first.assignment.assignmentId,
    requirements(),
    "transient provider failure",
    {
      assignedBy: "orchestrator",
    },
  );
  assert.equal(second.status, "assigned");
  if (second.status !== "assigned") return;
  assert.notEqual(second.assignment.agentId, first.assignment.agentId);
  assert.equal(
    second.assignment.replacesAssignmentId,
    first.assignment.assignmentId,
  );
});

test("reassignment preserves the failed attempt in history", () => {
  const svc = service([BACKEND, SECOND_BACKEND]);
  const first = svc.assign(requirements(), {
    taskId: "task-j",
    assignedBy: "planner",
  });
  if (first.status !== "assigned") return assert.fail("expected assignment");
  svc.reassign(first.assignment.assignmentId, requirements(), "boom", {
    assignedBy: "orchestrator",
  });

  const history = svc.historyForTask("task-j");
  assert.equal(history.length, 2);
  const failed = history.find(
    (a) => a.assignmentId === first.assignment.assignmentId,
  )!;
  assert.equal(failed.status, "reassigned");
  assert.equal(failed.failureReason, "boom");
});

test("reassignment never returns the work to the agent that just failed it", () => {
  const svc = service([BACKEND]);
  const first = svc.assign(requirements(), {
    taskId: "task-k",
    assignedBy: "planner",
  });
  if (first.status !== "assigned") return assert.fail("expected assignment");
  const second = svc.reassign(
    first.assignment.assignmentId,
    requirements(),
    "failed",
    {
      assignedBy: "orchestrator",
    },
  );
  assert.equal(
    second.status,
    "blocked",
    "the only agent is excluded, so the task blocks honestly",
  );
  if (second.status !== "blocked") return;
  assert.ok(
    second.evidence.some(
      (e) =>
        e.agentId === "backend-dev-v1" &&
        e.reasonCodes.includes("agent_excluded"),
    ),
  );
});

test("a reassigned assignment is terminal and cannot be reassigned again", () => {
  const svc = service([BACKEND, SECOND_BACKEND]);
  const first = svc.assign(requirements(), {
    taskId: "task-l",
    assignedBy: "planner",
  });
  if (first.status !== "assigned") return assert.fail("expected assignment");
  svc.reassign(first.assignment.assignmentId, requirements(), "boom", {
    assignedBy: "orchestrator",
  });
  assert.throws(
    () =>
      svc.reassign(first.assignment.assignmentId, requirements(), "again", {
        assignedBy: "o",
      }),
    StateTransitionError,
  );
});

/* ------------------------------------------------------------------ */
/* 6. Review independence (§50, §69)                                  */
/* ------------------------------------------------------------------ */

test("review independence: the implementer can never review its own change set", () => {
  const svc = service([BACKEND, REVIEWER]);
  const outcome = svc.selectReviewer({
    projectId: "money-mind",
    changeSetId: "changeset-1",
    implementerAgentId: "backend-dev-v1",
    riskLevel: "moderate",
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(outcome.status, "assigned");
  if (outcome.status !== "assigned") return;
  assert.equal(outcome.assignment.agentId, "reviewer-v1");
  const implementerEvidence = outcome.assignment.qualification;
  assert.equal(implementerEvidence.agentId, "reviewer-v1");
  assert.deepEqual(implementerEvidence.missingCapabilities, []);
});

test("review independence: if the implementer is the ONLY reviewer, nobody qualifies", () => {
  const onlyReviewerIsTheImplementer = variant("backend-dev-v1", {
    capabilities: ["software.backend", "software.review"],
    supportedTaskTypes: ["implementation", "review"],
  });
  const svc = service([onlyReviewerIsTheImplementer]);
  const outcome = svc.selectReviewer({
    projectId: "money-mind",
    changeSetId: "changeset-2",
    implementerAgentId: "backend-dev-v1",
    riskLevel: "high",
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(outcome.status, "blocked");
  if (outcome.status !== "blocked") return;
  assert.ok(
    outcome.evidence.some((e) =>
      e.reasonCodes.includes("review_independence_violated"),
    ),
    "self-review must be refused even when the implementer is the only candidate",
  );
});

test("a high-risk task always requires independent review", () => {
  assert.equal(
    requiresIndependentReview(requirements({ riskLevel: "critical" })),
    true,
  );
  assert.equal(
    requiresIndependentReview(requirements({ riskLevel: "high" })),
    true,
  );
  assert.equal(
    requiresIndependentReview(requirements({ riskLevel: "low" })),
    false,
  );
});

test("review independence also holds when the reviewer is chosen manually via exclusion", () => {
  const svc = service([BACKEND, REVIEWER]);
  const outcome = svc.assign(
    requirements({
      taskType: "review",
      requiredCapabilities: ["software.review"],
    }),
    {
      taskId: "changeset-3",
      assignedBy: "orchestrator",
      excludeAgentIds: ["backend-dev-v1"],
    },
  );
  assert.equal(outcome.status, "assigned");
  if (outcome.status !== "assigned") return;
  assert.equal(outcome.assignment.agentId, "reviewer-v1");
});
