import {
  type Task,
  type TaskDraft,
  type TaskStatus,
  NotFoundError,
  StateTransitionError,
  validateTaskDraft,
} from "../../contracts/index.js";
import { createId, now } from "../shared.js";

/**
 * Allowed forward transitions for the deterministic task lifecycle.
 *
 *   created ─▶ queued ─▶ running ─▶ completed
 *                │          │
 *                ├─▶ blocked ┤
 *                └─▶ awaiting_approval ┘
 *
 * `completed` and `cancelled` are terminal. `failed` may be retried by
 * re-queuing.
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  created: ["queued", "cancelled"],
  queued: ["running", "blocked", "awaiting_approval", "cancelled"],
  running: ["blocked", "awaiting_approval", "completed", "failed", "cancelled"],
  blocked: ["queued", "running", "cancelled"],
  awaiting_approval: ["running", "queued", "failed", "cancelled"],
  completed: [],
  failed: ["queued"],
  cancelled: [],
};

export interface TransitionPatch {
  assignedAgentId?: string;
  output?: unknown;
  metadata?: Record<string, unknown>;
  error?: string;
}

export class TaskSystem {
  private readonly tasks = new Map<string, Task>();

  create(draft: TaskDraft): Task {
    validateTaskDraft(draft);
    const timestamp = now();
    const task: Task = {
      id: createId("task"),
      type: draft.type,
      description: draft.description,
      projectId: draft.projectId,
      priority: draft.priority ?? "normal",
      status: "created",
      input: draft.input ?? null,
      errors: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: { ...(draft.metadata ?? {}) },
    };
    this.tasks.set(task.id, task);
    return task;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  require(id: string): Task {
    const task = this.tasks.get(id);
    if (!task) throw new NotFoundError(`unknown task: ${id}`);
    return task;
  }

  list(): Task[] {
    return [...this.tasks.values()];
  }

  canTransition(from: TaskStatus, to: TaskStatus): boolean {
    return TRANSITIONS[from].includes(to);
  }

  transition(id: string, to: TaskStatus, patch: TransitionPatch = {}): Task {
    const task = this.require(id);
    if (!this.canTransition(task.status, to)) {
      throw new StateTransitionError(
        `invalid task transition: ${task.status} -> ${to}`,
      );
    }
    const next: Task = {
      ...task,
      status: to,
      updatedAt: now(),
      assignedAgentId: patch.assignedAgentId ?? task.assignedAgentId,
      output: "output" in patch ? patch.output : task.output,
      metadata: patch.metadata
        ? { ...task.metadata, ...patch.metadata }
        : task.metadata,
      errors: patch.error ? [...task.errors, patch.error] : task.errors,
    };
    this.tasks.set(id, next);
    return next;
  }

  assign(id: string, agentId: string): Task {
    return this.transition(id, "running", { assignedAgentId: agentId });
  }

  complete(id: string, output: unknown): Task {
    return this.transition(id, "completed", { output });
  }

  fail(id: string, error: string): Task {
    return this.transition(id, "failed", { error });
  }

  cancel(id: string): Task {
    return this.transition(id, "cancelled");
  }
}
