import type { OrchTask, RunView } from "../types";

const TERMINAL: readonly string[] = ["COMPLETED", "CANCELLED"];

/** A task is retryable when it failed or is blocked, unless the block is a security block. */
export function canRetryTask(task: OrchTask): boolean {
  return (task.status === "FAILED" || task.status === "BLOCKED") && task.blockKind !== "security";
}

/** Stable dependency order: a task is listed after every task it depends on. */
export function orderTasks(tasks: readonly OrchTask[]): OrchTask[] {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const placed = new Set<string>();
  const out: OrchTask[] = [];
  const visiting = new Set<string>();
  const visit = (task: OrchTask) => {
    if (placed.has(task.taskId) || visiting.has(task.taskId)) return;
    visiting.add(task.taskId);
    for (const dep of task.dependencies) {
      const parent = byId.get(dep);
      if (parent) visit(parent);
    }
    visiting.delete(task.taskId);
    placed.add(task.taskId);
    out.push(task);
  };
  tasks.forEach(visit);
  return out;
}

/** Which run-level controls make sense for the derived status. Server-side validation is authoritative. */
export function availableControls(view: RunView) {
  const { status, run } = view;
  const live = !TERMINAL.includes(status);
  const begun = status !== "NOT_STARTED";
  return {
    start: status === "NOT_STARTED" && !run.cancelled,
    advance: live && begun && !run.paused,
    pause: live && begun && !run.paused,
    resume: live && begun && run.paused,
    cancel: live,
  };
}
