/**
 * Centralized cache-invalidation for Control Plane commands. After a command
 * succeeds, the affected server-state queries are marked stale and refetched —
 * we do NOT hand-patch the cache (the Control Plane is authoritative and other
 * operators may have changed things). Invalidation relationships live here, not
 * scattered across pages.
 */
import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

export type ControlCommandName =
  | "approve"
  | "reject"
  | "cancel-task"
  | "retry-task"
  | "pause-workflow"
  | "resume-workflow"
  | "cancel-workflow"
  | "disable-agent"
  | "enable-agent";

export interface CommandTargets {
  taskId?: string;
  workflowId?: string;
  agentId?: string;
  approvalId?: string;
}

export function invalidateForCommand(
  qc: QueryClient,
  command: ControlCommandName,
  targets: CommandTargets = {},
): Promise<void> {
  const jobs: Array<Promise<unknown>> = [];
  const inv = (key: readonly unknown[]) =>
    jobs.push(qc.invalidateQueries({ queryKey: key }));

  switch (command) {
    case "approve":
    case "reject":
      inv(queryKeys.approvals.all);
      inv(queryKeys.tasks.all); // a gated task may now proceed / fail
      inv(queryKeys.workflows.all); // an awaiting-approval workflow may resume
      inv(queryKeys.dashboard.all);
      if (targets.taskId) inv(queryKeys.tasks.detail(targets.taskId));
      if (targets.workflowId)
        inv(queryKeys.workflows.detail(targets.workflowId));
      break;

    case "cancel-task":
    case "retry-task":
      inv(queryKeys.tasks.all);
      inv(queryKeys.workflows.all); // the task may belong to a workflow
      inv(queryKeys.dashboard.all);
      if (targets.taskId) inv(queryKeys.tasks.detail(targets.taskId));
      if (targets.workflowId)
        inv(queryKeys.workflows.detail(targets.workflowId));
      break;

    case "pause-workflow":
    case "resume-workflow":
    case "cancel-workflow":
      inv(queryKeys.workflows.all);
      inv(queryKeys.tasks.all); // dispatch of the workflow's tasks changes
      inv(queryKeys.dashboard.all);
      if (targets.workflowId)
        inv(queryKeys.workflows.detail(targets.workflowId));
      break;

    case "disable-agent":
    case "enable-agent":
      inv(queryKeys.agents.all);
      inv(queryKeys.dashboard.all);
      if (targets.agentId) inv(queryKeys.agents.detail(targets.agentId));
      break;
  }

  return Promise.all(jobs).then(() => undefined);
}
