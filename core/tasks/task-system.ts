import { type Priority, type Task, type TaskStatus, validateTaskInput } from "../../contracts/index.js";
import { createId, now } from "../shared.js";

const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  created: ["queued", "cancelled"], queued: ["running", "blocked", "awaiting_approval", "cancelled"],
  running: ["blocked", "awaiting_approval", "completed", "failed", "cancelled"], blocked: ["queued", "cancelled"],
  awaiting_approval: ["queued", "cancelled"], completed: [], failed: ["queued", "cancelled"], cancelled: []
};
export interface NewTask { type: string; description: string; projectId: string; input: unknown; priority?: Priority; metadata?: Record<string, unknown>; }
export class TaskSystem {
  private readonly tasks = new Map<string, Task>();
  create(input: NewTask): Task {
    validateTaskInput(input); const timestamp = now();
    const task: Task = { id: createId("task"), ...input, priority: input.priority ?? "normal", status: "created", errors: [], createdAt: timestamp, updatedAt: timestamp, metadata: input.metadata ?? {} };
    this.tasks.set(task.id, task); return task;
  }
  get(id: string): Task | undefined { return this.tasks.get(id); }
  transition(id: string, status: TaskStatus, patch: Partial<Pick<Task, "output" | "assignedAgentId">> = {}): Task {
    const task = this.required(id); if (!transitions[task.status].includes(status)) throw new Error(`invalid task transition: ${task.status} -> ${status}`);
    const next = { ...task, ...patch, status, updatedAt: now() }; this.tasks.set(id, next); return next;
  }
  fail(id: string, error: string): Task { const task = this.required(id); if (!transitions[task.status].includes("failed")) throw new Error("task cannot fail from current state"); const next = { ...task, status: "failed" as const, errors: [...task.errors, error], updatedAt: now() }; this.tasks.set(id, next); return next; }
  private required(id: string): Task { const task = this.get(id); if (!task) throw new Error(`unknown task: ${id}`); return task; }
}
