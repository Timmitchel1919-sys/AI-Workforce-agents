/**
 * Project workforce planning.
 *
 * The value of this suite is entirely in the "no" cases. A planner that always
 * reports `fully_staffed` would pass a happy-path test and be useless, so the
 * tests below assert the specific ways staffing fails and that each failure is
 * reported as a block rather than smoothed over:
 *
 *   - a project nobody is scoped to is `unstaffable`, not "12 agents available";
 *   - a task nobody can do is `no_qualified_agent`;
 *   - one agent is never booked onto two concurrent tasks in the same wave;
 *   - a dry run leaves nothing behind.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryAssignmentRepository,
  SpecialistAssignmentService,
} from "../core/orchestrator/assignment-system.js";
import { ProjectWorkforcePlanner } from "../core/orchestrator/project-workforce-planner.js";
import { V1_SPECIALIST_WORKFORCE } from "../agents/specialists/v1-specialist-workforce.js";
import type { TaskRequirements } from "../contracts/index.js";

const ALL = V1_SPECIALIST_WORKFORCE;

function req(overrides: Partial<TaskRequirements> = {}): TaskRequirements {
  return {
    projectId: "money-mind",
    taskType: "implementation",
    requiredCapabilities: ["software.backend"],
    riskLevel: "low",
    ...overrides,
  };
}

function planner(pool = ALL): {
  planner: ProjectWorkforcePlanner;
  assignments: SpecialistAssignmentService;
} {
  const assignments = new SpecialistAssignmentService(
    new InMemoryAssignmentRepository(),
    () => pool,
  );
  return { planner: new ProjectWorkforcePlanner(assignments, () => pool), assignments };
}

test("a plan whose tasks are all covered is fully_staffed", () => {
  const { planner: p } = planner();
  const plan = p.plan({
    projectId: "money-mind",
    tasks: [
      { taskId: "t1", requirements: req() },
      { taskId: "t2", requirements: req({ requiredCapabilities: ["software.frontend"] }) },
      { taskId: "t3", requirements: req({ taskType: "review", requiredCapabilities: ["software.review"] }) },
    ],
  });
  assert.equal(plan.status, "fully_staffed");
  assert.deepEqual(plan.blockedTaskIds, []);
  assert.ok(plan.usedAgentIds.includes("backend-dev-v1"));
  assert.ok(plan.usedAgentIds.includes("frontend-dev-v1"));
  assert.ok(plan.usedAgentIds.includes("reviewer-v1"));
});

test("the AI Workforce project itself reports UNSTAFFABLE, because no V1 specialist is scoped to it", () => {
  // This is the honest answer. The V1 workforce is allow-listed to
  // `money-mind`, so presenting "12 specialists" on the AI Workforce project
  // would be a lie told by an allow-list. Widening the scope is a governance
  // decision, not something a planner may assume.
  const { planner: p } = planner();
  const plan = p.plan({
    projectId: "ai-workforce",
    tasks: [{ taskId: "t1", requirements: req({ projectId: "ai-workforce" }) }],
  });
  assert.equal(plan.status, "unstaffable");
  assert.deepEqual(plan.eligibleAgentIds, []);
  assert.deepEqual(plan.usedAgentIds, []);
  assert.deepEqual(plan.blockedTaskIds, ["t1"]);
  assert.match(plan.summary, /0 specialist\(s\) are registered for this project/);
});

test("a task nobody can do is blocked with NO_QUALIFIED_AGENT, not assigned to the nearest agent", () => {
  const { planner: p } = planner();
  const plan = p.plan({
    projectId: "money-mind",
    tasks: [
      { taskId: "t1", requirements: req() },
      {
        taskId: "t2",
        requirements: req({ requiredCapabilities: ["infrastructure.quantum_annealing"] }),
      },
    ],
  });
  assert.equal(plan.status, "partially_staffed");
  assert.deepEqual(plan.blockedTaskIds, ["t2"]);
  const blocked = plan.tasks.find((t) => t.taskId === "t2")!;
  assert.equal(blocked.status, "no_qualified_agent");
  assert.equal(blocked.assignment, undefined);
  assert.match(blocked.reason!, /no registered specialist covers/);
});

test("one agent is never booked onto two concurrent tasks in the same wave", () => {
  const { planner: p } = planner();
  // Both tasks are backend work in the same (default) group. There is exactly
  // one backend specialist, so the second task must wait rather than double-book.
  const plan = p.plan({
    projectId: "money-mind",
    tasks: [
      { taskId: "t1", requirements: req() },
      { taskId: "t2", requirements: req() },
    ],
  });
  assert.equal(plan.status, "partially_staffed");
  const t1 = plan.tasks.find((t) => t.taskId === "t1")!;
  const t2 = plan.tasks.find((t) => t.taskId === "t2")!;
  assert.equal(t1.status, "assigned");
  assert.equal(t2.status, "awaiting_capacity");
  assert.equal(t2.assignment, undefined);
  assert.match(t2.reason!, /already bound to a concurrent task/);
});

test("the same agent may take a second task in a DIFFERENT wave", () => {
  const { planner: p } = planner();
  const plan = p.plan({
    projectId: "money-mind",
    tasks: [
      { taskId: "t1", requirements: req() },
      { taskId: "t2", requirements: req() },
    ],
    concurrencyGroupOf: (taskId) => (taskId === "t1" ? "wave-1" : "wave-2"),
  });
  assert.equal(plan.status, "fully_staffed");
  assert.deepEqual(plan.usedAgentIds, ["backend-dev-v1"]);
});

test("a suspended agent is not used even when it is the only candidate", () => {
  const { planner: p } = planner();
  const plan = p.plan({
    projectId: "money-mind",
    tasks: [{ taskId: "t1", requirements: req() }],
    isEnabled: () => false,
  });
  assert.equal(plan.status, "unstaffable");
  assert.deepEqual(plan.usedAgentIds, []);
});

test("a dry run reports staffing and creates nothing", () => {
  const { planner: p, assignments } = planner();
  const plan = p.plan({
    projectId: "money-mind",
    tasks: [
      { taskId: "t1", requirements: req() },
      { taskId: "t2", requirements: req({ requiredCapabilities: ["software.frontend"] }) },
    ],
    dryRun: true,
  });
  assert.equal(plan.status, "fully_staffed");
  assert.equal(plan.tasks.every((t) => t.assignment === undefined), true);
  assert.equal(assignments.currentForTask("t1"), undefined, "a dry run must not bind work");
});

test("a task is never quietly re-planned into a different project", () => {
  const { planner: p } = planner();
  // The requirement names a project the plan is not for. Rewriting it would
  // staff work in a project the task was never filed under, so it is refused.
  assert.throws(
    () =>
      p.plan({
        projectId: "money-mind",
        tasks: [{ taskId: "t1", requirements: req({ projectId: "somewhere-else" }) }],
      }),
    /requires project somewhere-else but was planned for money-mind/,
  );
});

test("the plan lists the specialists that are actually eligible for the project", () => {
  const { planner: p } = planner();
  const plan = p.plan({ projectId: "money-mind", tasks: [] });
  assert.equal(plan.eligibleAgentIds.length, ALL.length);
  assert.equal(
    plan.eligibleAgentIds.includes("reviewer-v1"),
    true,
  );
});

test("an empty project plan is fully staffed and claims nothing", () => {
  const { planner: p } = planner();
  const plan = p.plan({ projectId: "money-mind", tasks: [] });
  assert.equal(plan.status, "fully_staffed");
  assert.deepEqual(plan.tasks, []);
  assert.deepEqual(plan.usedAgentIds, []);
  assert.match(plan.summary, /0 of 0 task\(s\)/);
});
