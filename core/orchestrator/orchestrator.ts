import {
  type Agent,
  type Handoff,
  type HandoffDraft,
  type Task,
  type TaskDraft,
  NotFoundError,
  ValidationError,
} from "../../contracts/index.js";
import { AuditLog } from "../audit/audit-log.js";
import { HandoffSystem } from "../handoffs/handoff-system.js";
import { AgentRegistry } from "../registry/agent-registry.js";
import { TaskSystem } from "../tasks/task-system.js";

/** Pluggable unit of work. Phase 1 ships only test doubles for this. */
export interface AgentExecutor {
  execute(agent: Agent, task: Task): Promise<unknown>;
}

export type AgentSelector = (candidates: readonly Agent[], task: Task) => Agent;

/** Deterministic default selection: lowest agent id among the candidates. */
export const selectFirstById: AgentSelector = (candidates) =>
  [...candidates].sort((a, b) => a.id.localeCompare(b.id))[0]!;

export interface OrchestratorOptions {
  selectAgent?: AgentSelector;
}

/**
 * Minimal deterministic orchestrator.
 *
 * Responsibilities: validate a task (via {@link TaskSystem}), move it through
 * its lifecycle, pick an eligible agent deterministically, dispatch execution,
 * record audit events, and mediate handoffs. It intentionally does no
 * autonomous planning.
 */
export class Orchestrator {
  private readonly selectAgent: AgentSelector;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly tasks: TaskSystem,
    private readonly handoffs: HandoffSystem,
    private readonly audit: AuditLog,
    private readonly executor: AgentExecutor,
    options: OrchestratorOptions = {},
  ) {
    this.selectAgent = options.selectAgent ?? selectFirstById;
  }

  async submit(draft: TaskDraft): Promise<Task> {
    let task = this.tasks.create(draft);
    this.audit.record("task_created", {
      taskId: task.id,
      projectId: task.projectId,
      data: { type: task.type, priority: task.priority },
    });

    task = this.tasks.transition(task.id, "queued");

    const candidates = this.registry.eligible(task.type, task.projectId);
    if (candidates.length === 0) {
      task = this.tasks.transition(task.id, "blocked", {
        metadata: { blockedReason: "no eligible agent" },
      });
      this.audit.record("task_assigned", {
        taskId: task.id,
        projectId: task.projectId,
        data: { assigned: false, reason: "no eligible agent" },
      });
      return task;
    }

    const agent = this.selectAgent(candidates, task);
    task = this.tasks.assign(task.id, agent.id);
    this.audit.record("task_assigned", {
      taskId: task.id,
      agentId: agent.id,
      projectId: task.projectId,
      data: { assigned: true, candidates: candidates.map((a) => a.id) },
    });

    try {
      this.audit.record("agent_executed", {
        taskId: task.id,
        agentId: agent.id,
        projectId: task.projectId,
        data: {},
      });
      const output = await this.executor.execute(agent, task);
      task = this.tasks.complete(task.id, output);
      this.audit.record("task_completed", {
        taskId: task.id,
        agentId: agent.id,
        projectId: task.projectId,
        data: {},
      });
      return task;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      task = this.tasks.fail(task.id, message);
      this.audit.record("task_failed", {
        taskId: task.id,
        agentId: agent.id,
        projectId: task.projectId,
        data: { error: message },
      });
      return task;
    }
  }

  /** Validate and accept a handoff between two registered agents on a task. */
  requestHandoff(draft: HandoffDraft): Handoff {
    if (
      !this.registry.has(draft.sourceAgentId) ||
      !this.registry.has(draft.destinationAgentId)
    ) {
      throw new ValidationError("handoff agents must be registered");
    }
    if (!this.tasks.get(draft.taskId)) {
      throw new NotFoundError(`handoff task does not exist: ${draft.taskId}`);
    }

    const proposed = this.handoffs.propose(draft);
    const accepted = this.handoffs.accept(proposed.id);
    this.audit.record("handoff_created", {
      taskId: accepted.taskId,
      agentId: accepted.sourceAgentId,
      data: {
        handoffId: accepted.id,
        destinationAgentId: accepted.destinationAgentId,
      },
    });
    return accepted;
  }
}
