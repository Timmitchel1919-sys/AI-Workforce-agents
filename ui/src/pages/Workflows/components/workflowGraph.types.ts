import type {
  TaskView,
  WorkflowStageView,
  WorkflowView,
} from "../../../api/contracts";

/**
 * Lightweight presentation model derived only from Control Plane workflow and
 * task records. It deliberately does not introduce a second workflow schema.
 */
export interface WorkflowGraphNode {
  readonly id: string;
  readonly specId: string;
  readonly label: string;
  readonly type: string;
  readonly status: string;
  readonly description: string;
  readonly taskId?: string;
  readonly agentId?: string;
  readonly retryCount: number;
  readonly error?: string;
  readonly isCurrent: boolean;
}

export interface WorkflowGraphEdge {
  readonly source: string;
  readonly target: string;
}

export interface WorkflowGraphModel {
  readonly nodes: readonly WorkflowGraphNode[];
  readonly edges: readonly WorkflowGraphEdge[];
  /** The task query may be paginated, so an incomplete result is disclosed. */
  readonly hasCompleteTaskSet: boolean;
}

function nodeFromStage(
  stage: WorkflowStageView,
  task: TaskView | undefined,
  currentSpecId: string | undefined,
): WorkflowGraphNode {
  return {
    id: stage.specId,
    specId: stage.specId,
    label: stage.description,
    type: stage.type,
    status: task?.status ?? stage.status,
    description: stage.description,
    taskId: task?.taskId,
    agentId: task?.assignedAgentId ?? stage.assignedAgentId,
    retryCount: task?.retryCount ?? stage.retryCount,
    error: task?.lastError ?? stage.error,
    isCurrent: currentSpecId === stage.specId,
  };
}

/**
 * Builds a read-only graph from actual stages plus task-level dependency IDs.
 * Stage order is never used to infer an edge, preserving parallel workflows.
 */
export function toWorkflowGraph(
  workflow: WorkflowView,
  tasks: readonly TaskView[],
  hasCompleteTaskSet: boolean,
): WorkflowGraphModel {
  const taskBySpecId = new Map(
    tasks
      .filter((task) => task.workflowSpecId)
      .map((task) => [task.workflowSpecId as string, task]),
  );
  const nodeByTaskId = new Map(
    tasks
      .filter((task) => task.workflowSpecId)
      .map((task) => [task.taskId, task.workflowSpecId as string]),
  );
  const nodes = workflow.stages.map((stage) =>
    nodeFromStage(
      stage,
      taskBySpecId.get(stage.specId),
      workflow.currentSpecId,
    ),
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: WorkflowGraphEdge[] = [];

  for (const task of tasks) {
    if (!task.workflowSpecId || !nodeIds.has(task.workflowSpecId)) continue;
    for (const dependencyTaskId of task.dependsOn) {
      const source = nodeByTaskId.get(dependencyTaskId);
      if (source && nodeIds.has(source)) {
        edges.push({ source, target: task.workflowSpecId });
      }
    }
  }

  return { nodes, edges, hasCompleteTaskSet };
}
