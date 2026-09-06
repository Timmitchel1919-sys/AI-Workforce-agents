import {
  type RequiredPermission,
  type Repository,
  type Task,
  type TaskDraft,
  type TaskStatus,
  NotFoundError,
  StateTransitionError,
  validateTaskDraft,
} from "../../contracts/index.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
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
  approvalId?: string;
  output?: unknown;
  metadata?: Record<string, unknown>;
  error?: string;
}

export class TaskSystem {
  constructor(
    private readonly repo: Repository<Task> = new InMemoryRepository<Task>(),
  ) {}

  create(draft: TaskDraft): Task {
    validateTaskDraft(draft);
    const timestamp = now();
    const requiredPermissions: RequiredPermission[] = (
      draft.requiredPermissions ?? []
    ).map((entry) => ({ ...entry }));
    const task: Task = {
      id: createId("task"),
      type: draft.type,
      description: draft.description,
      projectId: draft.projectId,
      priority: draft.priority ?? "normal",
      status: "created",
      input: draft.input ?? null,
      errors: [],
      requiredPermissions,
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: { ...(draft.metadata ?? {}) },
    };
    this.repo.upsert(task);
    return task;
  }

  get(id: string): Task | undefined {
    return this.repo.findById(id);
  }

  require(id: string): Task {
    const task = this.repo.findById(id);
    if (!task) throw new NotFoundError(`unknown task: ${id}`);
    return task;
  }

  list(): Task[] {
    return this.repo.list();
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
      approvalId: "approvalId" in patch ? patch.approvalId : task.approvalId,
      output: "output" in patch ? patch.output : task.output,
      metadata: patch.metadata
        ? { ...task.metadata, ...patch.metadata }
        : task.metadata,
      errors: patch.error ? [...task.errors, patch.error] : task.errors,
    };
    this.repo.upsert(next);
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
