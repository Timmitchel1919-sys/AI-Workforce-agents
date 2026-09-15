import type {
  AuditEventView,
  TaskView,
  WorkflowView,
} from "../../api/contracts";
import type { AgentExecutionView } from "../Agents/executions";

export interface WorkflowStepExecutionView {
  readonly task: TaskView;
  readonly execution?: AgentExecutionView;
}

/**
 * Presentational correlation only. A Task appears only when the Control Plane
 * returned it for this workflow; runtime timing comes only from matched audit
 * events, never from a guessed task lifecycle.
 */
export function toWorkflowStepExecutions(
  workflow: WorkflowView,
  tasks: readonly TaskView[],
  executions: readonly AgentExecutionView[],
): readonly WorkflowStepExecutionView[] {
  const executionByTask = new Map(
    executions
      .filter((execution) => execution.taskId)
      .map((execution) => [execution.taskId as string, execution]),
  );
  return tasks
    .filter((task) => task.workflowId === workflow.workflowId)
    .map((task) => ({ task, execution: executionByTask.get(task.taskId) }));
}

export function runtimeEvents(
  workflow: WorkflowView,
  events: readonly AuditEventView[],
): readonly AuditEventView[] {
  return events
    .filter((event) => event.workflowId === workflow.workflowId)
    .slice()
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
