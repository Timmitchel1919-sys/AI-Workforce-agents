import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalSystem, AgentRegistry, AuditLog, ContextSystem, HandoffSystem, Orchestrator, PermissionSystem, TaskSystem, type Agent, type ModelProvider, type ProjectAdapter, type ToolProvider } from "../core/index.js";

const agent = (id = "developer"): Agent => ({ id, name: id, description: "test agent", capabilities: ["code"], allowedTools: ["files"], allowedProjects: ["money-mind"], permissions: [], supportedTaskTypes: ["implementation"] });

test("registers agents and finds them by capability", () => {
  const registry = new AgentRegistry(); registry.register(agent());
  assert.equal(registry.get("developer")?.name, "developer"); assert.deepEqual(registry.byCapability("code").map((item) => item.id), ["developer"]);
  assert.throws(() => registry.register(agent()), /already registered/);
});

test("validates a task and enforces lifecycle transitions", () => {
  const tasks = new TaskSystem();
  assert.throws(() => tasks.create({ type: "", description: "x", projectId: "p", input: {} }), /task.type/);
  const task = tasks.create({ type: "implementation", description: "Build", projectId: "money-mind", input: {} });
  assert.equal(tasks.transition(task.id, "queued").status, "queued");
  assert.throws(() => tasks.transition(task.id, "completed"), /invalid task transition/);
});

test("validates structured handoffs", () => {
  const handoffs = new HandoffSystem();
  assert.throws(() => handoffs.create({ sourceAgentId: "a", destinationAgentId: "a", taskId: "t", context: {}, completedWork: "x", remainingWork: "y", acceptanceCriteria: ["z"], artifacts: [], risks: [] }), /must differ/);
  const handoff = handoffs.create({ sourceAgentId: "a", destinationAgentId: "b", taskId: "t", context: {}, completedWork: "x", remainingWork: "y", acceptanceCriteria: ["z"], artifacts: [], risks: [] });
  assert.equal(handoffs.forTask("t")[0]?.id, handoff.id);
});

test("denies permissions by default and permits precise grants", () => {
  const denied = new PermissionSystem().evaluate({ agentId: "a", projectId: "p", action: "write", environment: "production" });
  assert.deepEqual(denied, { allowed: false, reason: "deny by default" });
  const allowed = new PermissionSystem([{ agentId: "a", projectId: "p", action: "read", environment: "local", effect: "allow" }]).evaluate({ agentId: "a", projectId: "p", action: "read", environment: "local" });
  assert.equal(allowed.allowed, true);
});

test("runs the approval lifecycle", () => {
  const approvals = new ApprovalSystem(); const pending = approvals.request({ requestedBy: "a", action: "deploy", reason: "release" });
  assert.equal(approvals.decide(pending.id, "approved", "human", { ticket: "1" }).status, "approved");
  const second = approvals.request({ requestedBy: "a", action: "write", reason: "change" }); assert.equal(approvals.expire(second.id).status, "expired");
});

test("isolates context by project", () => {
  const context = new ContextSystem(); context.put({ taskId: "t", projectId: "aims", values: { projectScoped: "isolated" } });
  assert.equal(context.get("t", "money-mind"), undefined); assert.equal(context.get("t", "aims")?.values.projectScoped, "isolated");
});

test("creates structured audit events", () => {
  const audit = new AuditLog(); const event = audit.record("task_created", { taskId: "t", data: { source: "test" } });
  assert.equal(event.type, "task_created"); assert.equal(audit.list().length, 1);
});

test("uses provider-neutral model, tool, and project adapter contracts", async () => {
  const model: ModelProvider = { id: "fake-model", generate: async () => ({ content: "ok", model: "fake" }) };
  const tool: ToolProvider = { id: "fake-tool", execute: async (request) => ({ output: request.input }) };
  const project: ProjectAdapter = { projectId: "money-mind", describe: async () => ({ name: "Money Mind", capabilities: ["read"] }), execute: async (operation) => operation };
  assert.equal((await model.generate({ messages: [{ role: "user", content: "hello" }] })).content, "ok");
  assert.deepEqual((await tool.execute({ tool: "echo", input: { safe: true }, context: { taskId: "t", projectId: "money-mind", values: {} } })).output, { safe: true });
  assert.equal(await project.execute("inspect", {}), "inspect");
});

test("routes eligible agents deterministically and completes a task", async () => {
  const registry = new AgentRegistry(); registry.register(agent("zeta")); registry.register(agent("alpha"));
  const tasks = new TaskSystem(); const audit = new AuditLog();
  const orchestrator = new Orchestrator(registry, tasks, new HandoffSystem(), audit, { execute: async (selected) => ({ selected: selected.id }) });
  const task = await orchestrator.submit({ type: "implementation", description: "Build", projectId: "money-mind", input: {} });
  assert.equal(task.status, "completed"); assert.equal(task.assignedAgentId, "alpha"); assert.deepEqual(task.output, { selected: "alpha" });
  assert.deepEqual(audit.list().map((event) => event.type), ["task_created", "task_assigned", "agent_executed", "task_completed"]);
});

test("blocks tasks when no agent is eligible", async () => {
  const orchestrator = new Orchestrator(new AgentRegistry(), new TaskSystem(), new HandoffSystem(), new AuditLog(), { execute: async () => "unused" });
  assert.equal((await orchestrator.submit({ type: "implementation", description: "Build", projectId: "money-mind", input: {} })).status, "blocked");
});
