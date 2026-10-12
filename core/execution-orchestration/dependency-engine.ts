/**
 * Dependency Engine (Layer 4) — pure functions over a task list.
 *
 *  - validates ids, references and acyclicity;
 *  - enforces the mandatory-gate rule (nothing that integrates or deploys may
 *    skip a review/test gate that guards the code it ships);
 *  - computes which tasks are ready and which may run in parallel (tasks that
 *    write the same resource never do).
 */
import { ValidationError } from "../../contracts/index.js";
import type { OrchTask } from "../../contracts/execution-orchestration.js";

export function validatePlan(tasks: readonly OrchTask[]): void {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.taskId))
      throw new ValidationError(`duplicate task id ${task.taskId}`);
    ids.add(task.taskId);
  }
  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (!ids.has(dep))
        throw new ValidationError(
          `task ${task.taskId} depends on unknown task ${dep}`,
        );
      if (dep === task.taskId)
        throw new ValidationError(`task ${task.taskId} depends on itself`);
    }
    if (task.parentTaskId !== undefined && !ids.has(task.parentTaskId)) {
      throw new ValidationError(`task ${task.taskId} has an unknown parent`);
    }
  }
  assertAcyclic(tasks);
  assertGatesHonoured(tasks);
}

function assertAcyclic(tasks: readonly OrchTask[]): void {
  const byId = new Map(tasks.map((t) => [t.taskId, t]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      throw new ValidationError(
        `dependency cycle: ${[...trail, id].join(" → ")}`,
      );
    }
    state.set(id, 1);
    for (const dep of byId.get(id)?.dependencies ?? [])
      visit(dep, [...trail, id]);
    state.set(id, 2);
  };
  for (const task of tasks) visit(task.taskId, []);
}

/** All transitive upstream task ids of `taskId`. */
export function upstreamOf(
  tasks: readonly OrchTask[],
  taskId: string,
): Set<string> {
  const byId = new Map(tasks.map((t) => [t.taskId, t]));
  const out = new Set<string>();
  const walk = (id: string): void => {
    for (const dep of byId.get(id)?.dependencies ?? []) {
      if (!out.has(dep)) {
        out.add(dep);
        walk(dep);
      }
    }
  };
  walk(taskId);
  return out;
}

/** Number of tasks that (transitively) wait on `taskId` — its criticality. */
export function dependentCount(
  tasks: readonly OrchTask[],
  taskId: string,
): number {
  return tasks.filter((t) => upstreamOf(tasks, t.taskId).has(taskId)).length;
}

/**
 * Mandatory gates: every INTEGRATION/DEPLOYMENT task must transitively depend
 * on each gate task of the plan. A reviewer cannot be skipped by re-wiring.
 */
function assertGatesHonoured(tasks: readonly OrchTask[]): void {
  const gates = tasks.filter((t) => t.gate !== undefined);
  if (gates.length === 0) return;
  for (const task of tasks) {
    if (task.type !== "INTEGRATION" && task.type !== "DEPLOYMENT") continue;
    const upstream = upstreamOf(tasks, task.taskId);
    for (const gate of gates) {
      // A gate whose verification went stale is satisfied by its fresh re-run.
      const reruns = tasks.filter((t) => t.rerunOf === gate.taskId);
      if (
        !upstream.has(gate.taskId) &&
        !reruns.some((r) => upstream.has(r.taskId))
      ) {
        throw new ValidationError(
          `task ${task.taskId} (${task.type}) must depend on the mandatory ${gate.gate} gate ${gate.taskId}`,
        );
      }
    }
  }
}

/** PENDING tasks whose dependencies are all COMPLETED. */
export function readyCandidates(tasks: readonly OrchTask[]): OrchTask[] {
  const byId = new Map(tasks.map((t) => [t.taskId, t]));
  return tasks.filter(
    (t) =>
      t.status === "PENDING" &&
      t.dependencies.every((d) => byId.get(d)?.status === "COMPLETED"),
  );
}

/** Do two tasks write the same exclusive resource? */
export function conflicts(a: OrchTask, b: OrchTask): boolean {
  return a.resources.some((r) => b.resources.includes(r));
}

/** Choose up to `limit` tasks that can safely run together (no shared writes). */
export function parallelBatch(
  ordered: readonly OrchTask[],
  limit: number,
): OrchTask[] {
  const chosen: OrchTask[] = [];
  for (const task of ordered) {
    if (chosen.length >= limit) break;
    if (chosen.every((c) => !conflicts(c, task))) chosen.push(task);
  }
  return chosen;
}
