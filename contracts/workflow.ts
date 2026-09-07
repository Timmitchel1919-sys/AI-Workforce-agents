/**
 * Multi-agent workflow contracts.
 *
 * A `Workflow` is a declarative task graph: named nodes (`WorkflowTaskSpec`)
 * with explicit `dependsOn` edges, scoped to one project, executed by the
 * `WorkflowEngine` (core/workflows/) through the existing `Orchestrator` —
 * never bypassing permissions, approval, or the tool execution engine.
 *
 * Nothing here is specific to research/development/QA; those are just task
 * `type`s a workflow author chooses. The graph, limits, and retry policy are
 * fully reusable for any future General Agent combination.
 */
import {
  type Priority,
  type RequiredPermission,
  requireText,
  ValidationError,
} from "./index.js";

/* ------------------------------------------------------------------ */
/* Limits & retry policy                                              */
/* ------------------------------------------------------------------ */

/** Hard ceilings a workflow run enforces, independent of any single agent's own limits. */
export interface WorkflowLimits {
  maxTasks: number;
  maxAgentExecutions: number;
  maxRetries: number;
  maxHandoffs: number;
  maxToolCalls: number;
  maxDurationMs: number;
  /** How many levels of "plan a workflow from an objective" may nest. */
  maxDelegationDepth: number;
}

export const DEFAULT_WORKFLOW_LIMITS: WorkflowLimits = {
  maxTasks: 20,
  maxAgentExecutions: 40,
  maxRetries: 2,
  maxHandoffs: 20,
  maxToolCalls: 100,
  maxDurationMs: 5 * 60_000,
  maxDelegationDepth: 1,
};

/**
 * Which task failures may be retried, and how many times. Security and
 * validation failures are deliberately never retryable by default.
 */
export interface RetryPolicy {
  maxRetries: number;
  retryableReasons: readonly string[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  retryableReasons: [
    "tool_failure",
    "tool_unavailable",
    "model_failure",
    "model_unavailable",
    "timeout",
  ],
};

/* ------------------------------------------------------------------ */
/* Task graph                                                         */
/* ------------------------------------------------------------------ */

export interface WorkflowTaskSpecDraft {
  /** Unique within the workflow. */
  id: string;
  /** Task type — matched against `Agent.supportedTaskTypes`. */
  type: string;
  description: string;
  /** Explicit agent id. Provide this or `capability`, not neither. */
  agentId?: string;
  /** Resolve an agent by capability when `agentId` is not given. */
  capability?: string;
  /** Spec ids that must complete successfully before this one may start. */
  dependsOn?: readonly string[];
  acceptanceCriteria?: readonly string[];
  input?: unknown;
  requiredPermissions?: readonly RequiredPermission[];
  /** Tool ids this task is expected to use, for assignment pre-checks. */
  expectedTools?: readonly string[];
  priority?: Priority;
  metadata?: Record<string, unknown>;
}

export interface WorkflowTaskSpec {
  id: string;
  type: string;
  description: string;
  agentId?: string;
  capability?: string;
  dependsOn: readonly string[];
  acceptanceCriteria: readonly string[];
  input: unknown;
  requiredPermissions: readonly RequiredPermission[];
  expectedTools: readonly string[];
  priority?: Priority;
  metadata: Record<string, unknown>;
}

export type WorkflowFailureBehavior = "abort" | "continue";

export interface WorkflowDraft {
  name: string;
  description: string;
  projectId: string;
  /** Agent ids this workflow may use. A task cannot be assigned outside this set. */
  participatingAgents: readonly string[];
  tasks: readonly WorkflowTaskSpecDraft[];
  successCriteria?: readonly string[];
  /** `"abort"` (default): a failed task blocks its dependents and fails the workflow. `"continue"`: independent branches keep going. */
  failureBehavior?: WorkflowFailureBehavior;
  limits?: Partial<WorkflowLimits>;
  retryPolicy?: Partial<RetryPolicy>;
  metadata?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Workflow lifecycle                                                 */
/* ------------------------------------------------------------------ */

export const WORKFLOW_STATUSES = [
  "created",
  "planned",
  "running",
  "awaiting_approval",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const WORKFLOW_TASK_STATUSES = [
  "pending",
  "ready",
  "dispatched",
  "awaiting_approval",
  "completed",
  "failed",
  "blocked",
  "skipped",
  "cancelled",
] as const;
export type WorkflowTaskStatus = (typeof WORKFLOW_TASK_STATUSES)[number];

export interface WorkflowTaskRecord {
  specId: string;
  status: WorkflowTaskStatus;
  /** The real `Task` id, once the spec has been dispatched at least once. */
  taskId?: string;
  assignedAgentId?: string;
  retryCount: number;
  error?: string;
  /** The real task's output, once it has completed. */
  output?: unknown;
  /** Set once a handoff has been accepted feeding this task. */
  handoffId?: string;
  updatedAt: string;
}

export interface WorkflowCounters {
  tasksCreated: number;
  agentExecutions: number;
  retries: number;
  handoffs: number;
  toolCalls: number;
}

export interface WorkflowTaskResultSummary {
  specId: string;
  status: WorkflowTaskStatus;
  agentId?: string;
  output?: unknown;
  error?: string;
}

export interface WorkflowResult {
  workflowId: string;
  status: WorkflowStatus;
  summary: string;
  taskResults: readonly WorkflowTaskResultSummary[];
  completedAt: string;
  metadata: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  projectId: string;
  participatingAgents: readonly string[];
  tasks: readonly WorkflowTaskSpec[];
  successCriteria: readonly string[];
  failureBehavior: WorkflowFailureBehavior;
  limits: WorkflowLimits;
  retryPolicy: RetryPolicy;
  status: WorkflowStatus;
  taskRecords: readonly WorkflowTaskRecord[];
  counters: WorkflowCounters;
  result?: WorkflowResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  metadata: Record<string, unknown>;
}

/** Outcome of validating a Project-Manager-recommended (or authored) assignment. */
export interface AgentAssignment {
  specId: string;
  agentId?: string;
  validated: boolean;
  reason: string;
}

/* ------------------------------------------------------------------ */
/* Cycle detection (pure)                                             */
/* ------------------------------------------------------------------ */

export interface DependencyNode {
  id: string;
  dependsOn: readonly string[];
}

/** Returns the cycle path (e.g. `["a","b","c","a"]`) if one exists, else `null`. */
export function findCycle(nodes: readonly DependencyNode[]): string[] | null {
  const deps = new Map(nodes.map((n) => [n.id, n.dependsOn]));
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(nodes.map((n) => [n.id, WHITE]));
  const path: string[] = [];

  const visit = (id: string): string[] | null => {
    color.set(id, GRAY);
    path.push(id);
    for (const dep of deps.get(id) ?? []) {
      const state = color.get(dep);
      if (state === GRAY) {
        const start = path.indexOf(dep);
        return [...path.slice(start), dep];
      }
      if (state === WHITE) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    path.pop();
    color.set(id, BLACK);
    return null;
  };

  for (const node of nodes) {
    if (color.get(node.id) === WHITE) {
      const found = visit(node.id);
      if (found) return found;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Validators                                                         */
/* ------------------------------------------------------------------ */

const WORKFLOW_FAILURE_BEHAVIORS: readonly WorkflowFailureBehavior[] = [
  "abort",
  "continue",
];

function validateWorkflowTaskSpecDraft(
  draft: WorkflowTaskSpecDraft,
  index: number,
): void {
  requireText(draft.id, `workflow.tasks[${index}].id`);
  requireText(draft.type, `workflow.tasks[${index}].type`);
  requireText(draft.description, `workflow.tasks[${index}].description`);
  if (!draft.agentId && !draft.capability) {
    throw new ValidationError(
      `workflow.tasks[${index}] must specify agentId or capability`,
    );
  }
  if (draft.dependsOn !== undefined && !Array.isArray(draft.dependsOn)) {
    throw new ValidationError(
      `workflow.tasks[${index}].dependsOn must be an array`,
    );
  }
}

/** Validate a whole workflow draft: shape, unique ids, known deps, no cycles. */
export function validateWorkflowDraft(draft: WorkflowDraft): void {
  if (!draft || typeof draft !== "object") {
    throw new ValidationError("workflow draft must be an object");
  }
  requireText(draft.name, "workflow.name");
  requireText(draft.description, "workflow.description");
  requireText(draft.projectId, "workflow.projectId");

  if (
    !Array.isArray(draft.participatingAgents) ||
    draft.participatingAgents.length === 0
  ) {
    throw new ValidationError(
      "workflow.participatingAgents must be a non-empty array",
    );
  }
  if (!Array.isArray(draft.tasks) || draft.tasks.length === 0) {
    throw new ValidationError("workflow.tasks must be a non-empty array");
  }
  draft.tasks.forEach((task, index) =>
    validateWorkflowTaskSpecDraft(task, index),
  );

  const ids = new Set<string>();
  for (const task of draft.tasks) {
    if (ids.has(task.id)) {
      throw new ValidationError(`duplicate workflow task id: "${task.id}"`);
    }
    ids.add(task.id);
  }
  for (const task of draft.tasks) {
    for (const dep of task.dependsOn ?? []) {
      if (dep === task.id) {
        throw new ValidationError(
          `workflow task "${task.id}" cannot depend on itself`,
        );
      }
      if (!ids.has(dep)) {
        throw new ValidationError(
          `workflow task "${task.id}" depends on unknown task "${dep}"`,
        );
      }
    }
  }

  if (
    draft.failureBehavior !== undefined &&
    !WORKFLOW_FAILURE_BEHAVIORS.includes(draft.failureBehavior)
  ) {
    throw new ValidationError(
      "workflow.failureBehavior must be 'abort' or 'continue'",
    );
  }

  const cycle = findCycle(
    draft.tasks.map((task) => ({
      id: task.id,
      dependsOn: task.dependsOn ?? [],
    })),
  );
  if (cycle) {
    throw new ValidationError(
      `workflow has a circular dependency: ${cycle.join(" -> ")}`,
    );
  }
}
