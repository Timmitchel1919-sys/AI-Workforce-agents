import {
  type RequiredPermission,
  type Repository,
  type Workflow,
  type WorkflowCounters,
  type WorkflowDraft,
  type WorkflowResult,
  type WorkflowStatus,
  type WorkflowTaskRecord,
  type WorkflowTaskSpec,
  DEFAULT_RETRY_POLICY,
  DEFAULT_WORKFLOW_LIMITS,
  NotFoundError,
  StateTransitionError,
  ValidationError,
  validateWorkflowDraft,
} from "../../contracts/index.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import { createId, now } from "../shared.js";
import { initialTaskRecord } from "./workflow-graph.js";

/**
 * Deterministic workflow lifecycle, structured exactly like `TaskSystem`'s
 * task lifecycle:
 *
 *   created ─▶ planned ─▶ running ─▶ completed
 *                             │
 *                ├─▶ awaiting_approval ─▶ running
 *                └─▶ blocked ─▶ running | failed
 *
 * `completed`, `failed`, and `cancelled` are terminal.
 */
const TRANSITIONS: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  created: ["planned", "cancelled"],
  planned: ["running", "cancelled"],
  running: ["awaiting_approval", "blocked", "completed", "failed", "cancelled"],
  awaiting_approval: ["running", "cancelled"],
  blocked: ["running", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export interface WorkflowTransitionPatch {
  error?: string;
  metadata?: Record<string, unknown>;
}

export class WorkflowSystem {
  constructor(
    private readonly repo: Repository<Workflow> = new InMemoryRepository<Workflow>(),
  ) {}

  create(draft: WorkflowDraft): Workflow {
    validateWorkflowDraft(draft);
    const limits = { ...DEFAULT_WORKFLOW_LIMITS, ...(draft.limits ?? {}) };
    if (draft.tasks.length > limits.maxTasks) {
      throw new ValidationError(
        `workflow declares ${draft.tasks.length} tasks, exceeding limits.maxTasks (${limits.maxTasks})`,
      );
    }
    const timestamp = now();

    const tasks: WorkflowTaskSpec[] = draft.tasks.map((task) => ({
      id: task.id,
      type: task.type,
      description: task.description,
      agentId: task.agentId,
      capability: task.capability,
      dependsOn: [...(task.dependsOn ?? [])],
      acceptanceCriteria: [...(task.acceptanceCriteria ?? [])],
      input: task.input ?? null,
      requiredPermissions: (task.requiredPermissions ?? []).map(
        (p): RequiredPermission => ({ ...p }),
      ),
      expectedTools: [...(task.expectedTools ?? [])],
      priority: task.priority,
      metadata: { ...(task.metadata ?? {}) },
    }));

    const taskRecords: WorkflowTaskRecord[] = tasks.map((task) =>
      initialTaskRecord(task.id, timestamp),
    );

    const workflow: Workflow = {
      id: createId("workflow"),
      name: draft.name,
      description: draft.description,
      projectId: draft.projectId,
      participatingAgents: [...draft.participatingAgents],
      tasks,
      successCriteria: [...(draft.successCriteria ?? [])],
      failureBehavior: draft.failureBehavior ?? "abort",
      limits,
      retryPolicy: { ...DEFAULT_RETRY_POLICY, ...(draft.retryPolicy ?? {}) },
      status: "created",
      taskRecords,
      counters: {
        tasksCreated: 0,
        agentExecutions: 0,
        retries: 0,
        handoffs: 0,
        toolCalls: 0,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: { ...(draft.metadata ?? {}) },
    };
    this.repo.upsert(workflow);
    return workflow;
  }

  get(id: string): Workflow | undefined {
    return this.repo.findById(id);
  }

  require(id: string): Workflow {
    const workflow = this.repo.findById(id);
    if (!workflow) throw new NotFoundError(`unknown workflow: ${id}`);
    return workflow;
  }

  list(): Workflow[] {
    return this.repo.list();
  }

  canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
    return TRANSITIONS[from].includes(to);
  }

  transition(
    id: string,
    to: WorkflowStatus,
    patch: WorkflowTransitionPatch = {},
  ): Workflow {
    const workflow = this.require(id);
    if (!this.canTransition(workflow.status, to)) {
      throw new StateTransitionError(
        `invalid workflow transition: ${workflow.status} -> ${to}`,
      );
    }
    const timestamp = now();
    const next: Workflow = {
      ...workflow,
      status: to,
      updatedAt: timestamp,
      error: patch.error ?? workflow.error,
      metadata: patch.metadata
        ? { ...workflow.metadata, ...patch.metadata }
        : workflow.metadata,
      startedAt:
        to === "running" && !workflow.startedAt
          ? timestamp
          : workflow.startedAt,
      completedAt:
        to === "completed" || to === "failed" || to === "cancelled"
          ? timestamp
          : workflow.completedAt,
    };
    this.repo.upsert(next);
    return next;
  }

  /** Replace one task record (matched by `specId`) within the workflow. */
  updateTaskRecord(
    id: string,
    specId: string,
    patch: Partial<Omit<WorkflowTaskRecord, "specId">>,
  ): Workflow {
    const workflow = this.require(id);
    const index = workflow.taskRecords.findIndex((r) => r.specId === specId);
    if (index < 0) {
      throw new NotFoundError(
        `workflow ${id} has no task record for spec "${specId}"`,
      );
    }
    const timestamp = now();
    const records = [...workflow.taskRecords];
    records[index] = {
      ...records[index]!,
      ...patch,
      specId,
      updatedAt: timestamp,
    };
    const next: Workflow = {
      ...workflow,
      taskRecords: records,
      updatedAt: timestamp,
    };
    this.repo.upsert(next);
    return next;
  }

  incrementCounter(id: string, key: keyof WorkflowCounters, by = 1): Workflow {
    const workflow = this.require(id);
    const next: Workflow = {
      ...workflow,
      counters: { ...workflow.counters, [key]: workflow.counters[key] + by },
      updatedAt: now(),
    };
    this.repo.upsert(next);
    return next;
  }

  setResult(id: string, result: WorkflowResult): Workflow {
    const workflow = this.require(id);
    const next: Workflow = { ...workflow, result, updatedAt: now() };
    this.repo.upsert(next);
    return next;
  }
}
