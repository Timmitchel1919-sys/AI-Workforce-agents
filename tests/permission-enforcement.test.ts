import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentRegistry,
  AuditLog,
  HandoffSystem,
  Orchestrator,
  PermissionSystem,
  TaskSystem,
  type Agent,
  type AgentExecutor,
  type Environment,
  type PermissionGrant,
  type RequiredPermission,
  type Task,
  type TaskDraft,
} from "../core/index.js";

const makeAgent = (id = "alpha"): Agent => ({
  id,
  name: id,
  description: "test agent",
  capabilities: ["code"],
  allowedTools: ["files", "shell"],
  allowedProjects: ["money-mind"],
  supportedTaskTypes: ["implementation"],
  permissions: [],
});

interface Harness {
  audit: AuditLog;
  orchestrator: Orchestrator;
  readonly calls: number;
  submit: (required: RequiredPermission[], projectId?: string) => Promise<Task>;
}

function harness(
  grants: PermissionGrant[],
  opts: { environment?: Environment; executor?: AgentExecutor } = {},
): Harness {
  const registry = new AgentRegistry();
  const tasks = new TaskSystem();
  const audit = new AuditLog();
  const state = { calls: 0 };
  const executor: AgentExecutor = opts.executor ?? {
    execute: async () => {
      state.calls += 1;
      return "ok";
    },
  };
  const orchestrator = new Orchestrator(
    registry,
    tasks,
    new HandoffSystem(),
    audit,
    executor,
    undefined,
    {
      permissions: new PermissionSystem(grants),
      environment: opts.environment,
    },
  );
  registry.register(makeAgent("alpha"));

  const base: Omit<TaskDraft, "requiredPermissions"> = {
    type: "implementation",
    description: "work",
    projectId: "money-mind",
    input: {},
  };
  return {
    audit,
    orchestrator,
    get calls() {
      return state.calls;
    },
    submit: (required, projectId) =>
      orchestrator.submit({
        ...base,
        projectId: projectId ?? base.projectId,
        requiredPermissions: required,
      }),
  };
}

const allowWrite = (over: Partial<PermissionGrant> = {}): PermissionGrant => ({
  effect: "allow",
  action: "write",
  agentId: "alpha",
  projectId: "money-mind",
  environment: "local",
  ...over,
});

/* ------------------------------------------------------------------ */

test("permission: an allowed action executes and is audited", async () => {
  const h = harness([allowWrite()]);
  const task = await h.submit([{ action: "write" }]);

  assert.equal(task.status, "completed");
  assert.equal(h.calls, 1);

  const decision = h.audit.query({ type: "permission_decision" })[0];
  assert.equal(decision?.data.allowed, true);
  assert.equal(decision?.data.action, "write");
});

test("permission: a denied action fails safely and never executes", async () => {
  const h = harness([]); // no grants -> deny by default
  const task = await h.submit([{ action: "write" }]);

  assert.equal(task.status, "failed");
  assert.equal(h.calls, 0);
  assert.match(task.errors[0]!, /permission denied/);

  assert.equal(
    h.audit.query({ type: "permission_decision" })[0]?.data.allowed,
    false,
  );
  const failure = h.audit.query({ type: "task_failed" })[0];
  assert.equal(failure?.data.reason, "permission_denied");
  assert.ok(!h.audit.list().some((e) => e.type === "agent_executed"));
});

test("permission: an explicit deny beats an allow", async () => {
  const h = harness([
    allowWrite(),
    { effect: "deny", action: "write", projectId: "money-mind" },
  ]);
  const task = await h.submit([{ action: "write" }]);
  assert.equal(task.status, "failed");
  assert.equal(h.calls, 0);
});

test("permission: project scope is enforced", async () => {
  const h = harness([allowWrite({ projectId: "aims" })]);
  const task = await h.submit([{ action: "write" }], "money-mind");
  assert.equal(task.status, "failed");
});

test("permission: agent scope is enforced", async () => {
  const h = harness([allowWrite({ agentId: "beta" })]);
  const task = await h.submit([{ action: "write" }]);
  assert.equal(task.status, "failed");
});

test("permission: tool scope is enforced", async () => {
  const denied = harness([
    { ...allowWrite(), action: "execute", toolId: "files" },
  ]);
  assert.equal(
    (await denied.submit([{ action: "execute", toolId: "shell" }])).status,
    "failed",
  );

  const allowed = harness([
    { ...allowWrite(), action: "execute", toolId: "shell" },
  ]);
  assert.equal(
    (await allowed.submit([{ action: "execute", toolId: "shell" }])).status,
    "completed",
  );
});

test("permission: environment scope is enforced", async () => {
  const denied = harness([allowWrite({ environment: "local" })], {
    environment: "production",
  });
  assert.equal((await denied.submit([{ action: "write" }])).status, "failed");

  const allowed = harness([allowWrite({ environment: "production" })], {
    environment: "production",
  });
  assert.equal(
    (await allowed.submit([{ action: "write" }])).status,
    "completed",
  );
});

test("permission: a gated task with no permission system fails safe", async () => {
  const registry = new AgentRegistry();
  const tasks = new TaskSystem();
  const audit = new AuditLog();
  let ran = 0;
  const orchestrator = new Orchestrator(
    registry,
    tasks,
    new HandoffSystem(),
    audit,
    {
      execute: async () => {
        ran += 1;
        return "ok";
      },
    },
  );
  registry.register(makeAgent("alpha"));

  const task = await orchestrator.submit({
    type: "implementation",
    description: "work",
    projectId: "money-mind",
    input: {},
    requiredPermissions: [{ action: "deploy" }],
  });
  assert.equal(task.status, "failed");
  assert.equal(ran, 0);
  assert.match(task.errors[0]!, /no permission system configured/);
});

test("permission: the executor guard blocks an unpermitted tool call mid-run", async () => {
  const h = harness([allowWrite()], {
    executor: {
      execute: async (_agent, _task, guard) => {
        guard?.assert("write"); // allowed
        guard?.assert("secret_access"); // denied -> throws
        return "unreachable";
      },
    },
  });
  const task = await h.submit([{ action: "write" }]);
  assert.equal(task.status, "failed");
  assert.match(task.errors[0]!, /permission denied/);
});

test("permission: ungated tasks are unaffected when no system is configured", async () => {
  const registry = new AgentRegistry();
  const tasks = new TaskSystem();
  const orchestrator = new Orchestrator(
    registry,
    tasks,
    new HandoffSystem(),
    new AuditLog(),
    { execute: async () => "ok" },
  );
  registry.register(makeAgent("alpha"));
  const task = await orchestrator.submit({
    type: "implementation",
    description: "work",
    projectId: "money-mind",
    input: {},
  });
  assert.equal(task.status, "completed");
});
