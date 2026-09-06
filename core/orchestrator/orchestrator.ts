import { type Agent, type Handoff, type Task } from "../../contracts/index.js";
import { AuditLog } from "../audit/audit-log.js";
import { HandoffSystem, type NewHandoff } from "../handoffs/handoff-system.js";
import { AgentRegistry } from "../registry/agent-registry.js";
import { TaskSystem, type NewTask } from "../tasks/task-system.js";

export interface AgentExecutor { execute(agent: Agent, task: Task): Promise<unknown>; }
export class Orchestrator {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly tasks: TaskSystem,
    private readonly handoffs: HandoffSystem,
    private readonly audit: AuditLog,
    private readonly executor: AgentExecutor
  ) {}
  async submit(input: NewTask): Promise<Task> {
    let task = this.tasks.create(input);
    this.audit.record("task_created", { taskId: task.id, projectId: task.projectId, data: { type: task.type } });
    task = this.tasks.transition(task.id, "queued");
    const agent = this.registry.eligible(task.type, task.projectId)[0];
    if (!agent) return this.tasks.transition(task.id, "blocked");
    task = this.tasks.transition(task.id, "running", { assignedAgentId: agent.id });
    this.audit.record("task_assigned", { taskId: task.id, agentId: agent.id, projectId: task.projectId, data: {} });
    try {
      this.audit.record("agent_executed", { taskId: task.id, agentId: agent.id, projectId: task.projectId, data: {} });
      const output = await this.executor.execute(agent, task);
      task = this.tasks.transition(task.id, "completed", { output });
      this.audit.record("task_completed", { taskId: task.id, agentId: agent.id, projectId: task.projectId, data: {} });
      return task;
    } catch (error) {
      task = this.tasks.fail(task.id, error instanceof Error ? error.message : String(error));
      this.audit.record("task_failed", { taskId: task.id, agentId: agent.id, projectId: task.projectId, data: { error: task.errors.at(-1) } });
      return task;
    }
  }
  handoff(input: NewHandoff): Handoff {
    if (!this.registry.get(input.sourceAgentId) || !this.registry.get(input.destinationAgentId)) throw new Error("handoff agents must be registered");
    if (!this.tasks.get(input.taskId)) throw new Error("handoff task must exist");
    const handoff = this.handoffs.create(input);
    this.audit.record("handoff_created", { taskId: handoff.taskId, agentId: handoff.sourceAgentId, data: { destinationAgentId: handoff.destinationAgentId } });
    return handoff;
  }
}
