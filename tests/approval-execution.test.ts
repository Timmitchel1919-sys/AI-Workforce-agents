import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  HandoffSystem,
  Orchestrator,
  TaskSystem,
  WorkforceError,
  type Agent,
  type ApprovalPolicy,
  type TaskDraft,
} from "../core/index.js";
import { JsonFilePersistence } from "../adapters/index.js";

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

const makeAgent = (id = "alpha"): Agent => ({
  id,
  name: id,
  description: "test agent",
  capabilities: ["code"],
  allowedTools: ["files"],
  allowedProjects: ["money-mind"],
  supportedTaskTypes: ["implementation", "deploy"],
  permissions: [],
});

const draft = (overrides: Partial<TaskDraft> = {}): TaskDraft => ({
  type: "implementation",
  description: "Build a feature",
  projectId: "money-mind",
  input: {},
  ...overrides,
});

/** Requires approval only for `deploy` tasks. Never auto-approves. */
const deployNeedsApproval: ApprovalPolicy = {
  evaluate: (task) => ({
    required: task.type === "deploy",
    action: `deploy:${task.projectId}`,
    reason: "deployments require a human decision",
  }),
};

interface Wiring {
  registry: AgentRegistry;
  tasks: TaskSystem;
  approvals: ApprovalSystem;
  audit: AuditLog;
  orchestrator: Orchestrator;
  calls: string[];
}

function wire(policy: ApprovalPolicy = deployNeedsApproval): Wiring {
  const registry = new AgentRegistry();
  const tasks = new TaskSystem();
  const approvals = new ApprovalSystem();
  const audit = new AuditLog();
  const calls: string[] = [];
  const orchestrator = new Orchestrator(
    registry,
    tasks,
    new HandoffSystem(),
    audit,
    {
      execute: async (agent, task) => {
        calls.push(`${agent.id}:${task.id}`);
        return { ran: true };
      },
    },
    approvals,
    { approvalPolicy: policy },
  );
  registry.register(makeAgent("alpha"));
  return { registry, tasks, approvals, audit, orchestrator, calls };
}

/* ------------------------------------------------------------------ */
/* Approval gating                                                    */
/* ------------------------------------------------------------------ */

test("approval: a non-gated task runs straight through", async () => {
  const { orchestrator, calls } = wire();
  const task = await orchestrator.submit(draft({ type: "implementation" }));
  assert.equal(task.status, "completed");
  assert.equal(calls.length, 1);
});

test("approval: a gated task parks in awaiting_approval and does not execute", async () => {
  const { orchestrator, approvals, audit, calls } = wire();
  const task = await orchestrator.submit(draft({ type: "deploy" }));

  assert.equal(task.status, "awaiting_approval");
  assert.ok(task.approvalId);
  assert.equal(calls.length, 0, "executor must not run before approval");

  const approval = approvals.require(task.approvalId!);
  assert.equal(approval.status, "requested");
  assert.equal(approval.action, "deploy:money-mind");

  const types = audit.list().map((e) => e.type);
  assert.ok(types.includes("approval_requested"));
  assert.ok(!types.includes("agent_executed"));
});

test("approval: resume before a decision is refused", async () => {
  const { orchestrator } = wire();
  const task = await orchestrator.submit(draft({ type: "deploy" }));
  await assert.rejects(orchestrator.resume(task.id), WorkforceError);
});

test("approval: approve then resume runs the task to completion", async () => {
  const { orchestrator, approvals, audit, calls } = wire();
  const task = await orchestrator.submit(draft({ type: "deploy" }));

  orchestrator.recordApprovalDecision(
    task.approvalId!,
    "approved",
    "human:sam",
    {
      ticket: "OPS-9",
    },
  );
  assert.equal(approvals.require(task.approvalId!).status, "approved");

  const resumed = await orchestrator.resume(task.id);
  assert.equal(resumed.status, "completed");
  assert.deepEqual(resumed.output, { ran: true });
  assert.equal(calls.length, 1);

  const types = audit.list().map((e) => e.type);
  assert.deepEqual(types, [
    "task_created",
    "task_assigned",
    "approval_requested",
    "approval_decided",
    "task_resumed",
    "agent_executed",
    "task_completed",
  ]);
});

test("approval: reject then resume fails the task without executing", async () => {
  const { orchestrator, audit, calls } = wire();
  const task = await orchestrator.submit(draft({ type: "deploy" }));

  orchestrator.recordApprovalDecision(
    task.approvalId!,
    "rejected",
    "human:sam",
  );
  const resumed = await orchestrator.resume(task.id);

  assert.equal(resumed.status, "failed");
  assert.deepEqual(resumed.errors, ["approval rejected"]);
  assert.equal(calls.length, 0);

  const failure = audit.list().find((e) => e.type === "task_failed");
  assert.equal(failure?.data.reason, "approval_rejected");
});

test("approval: an expired approval fails the task on resume", async () => {
  const { orchestrator, calls } = wire({
    evaluate: () => ({
      required: true,
      action: "deploy",
      reason: "needs sign-off",
      expiresAt: "2000-01-01T00:00:00.000Z",
    }),
  });
  const task = await orchestrator.submit(draft({ type: "deploy" }));

  const resumed = await orchestrator.resume(task.id, {
    asOf: "2020-01-01T00:00:00.000Z",
  });
  assert.equal(resumed.status, "failed");
  assert.deepEqual(resumed.errors, ["approval expired"]);
  assert.equal(calls.length, 0);
});

test("approval: resume rejects a task that is not awaiting approval", async () => {
  const { orchestrator } = wire();
  const task = await orchestrator.submit(draft({ type: "implementation" }));
  await assert.rejects(orchestrator.resume(task.id), /not awaiting approval/);
});

test("approval: policy never auto-approves — decision is external", async () => {
  const { orchestrator, approvals, tasks } = wire();
  const task = await orchestrator.submit(draft({ type: "deploy" }));
  // No decision recorded anywhere -> still pending, task still parked.
  assert.equal(approvals.require(task.approvalId!).status, "requested");
  assert.equal(tasks.require(task.id).status, "awaiting_approval");
});

/* ------------------------------------------------------------------ */
/* Persistence across a fresh wiring                                  */
/* ------------------------------------------------------------------ */

test("approval + persistence: a parked task resumes after re-wiring on the same store", async () => {
  const dir = mkdtempSync(join(tmpdir(), "workforce-approval-"));
  try {
    const build = () => {
      const persistence = new JsonFilePersistence(dir);
      const registry = new AgentRegistry(persistence.agents);
      const tasks = new TaskSystem(persistence.tasks);
      const approvals = new ApprovalSystem(persistence.approvals);
      const audit = new AuditLog(undefined, persistence.auditEvents);
      const ran: string[] = [];
      const orchestrator = new Orchestrator(
        registry,
        tasks,
        new HandoffSystem(persistence.handoffs),
        audit,
        {
          execute: async (agent, task) => {
            ran.push(`${agent.id}:${task.id}`);
            return "done";
          },
        },
        approvals,
        { approvalPolicy: deployNeedsApproval },
      );
      return { registry, tasks, approvals, audit, orchestrator, ran };
    };

    const first = build();
    first.registry.register(makeAgent("alpha"));
    const task = await first.orchestrator.submit(draft({ type: "deploy" }));
    assert.equal(task.status, "awaiting_approval");

    // Fresh wiring over the same directory (simulated restart).
    const second = build();
    assert.equal(second.tasks.require(task.id).status, "awaiting_approval");
    assert.equal(second.registry.has("alpha"), true);

    second.orchestrator.recordApprovalDecision(
      task.approvalId!,
      "approved",
      "human:sam",
    );
    const resumed = await second.orchestrator.resume(task.id);
    assert.equal(resumed.status, "completed");
    assert.deepEqual(second.ran, [`alpha:${task.id}`]);

    // A third wiring sees the completed task and the full audit trail.
    const third = build();
    assert.equal(third.tasks.require(task.id).status, "completed");
    assert.ok(third.audit.list().some((e) => e.type === "task_completed"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
