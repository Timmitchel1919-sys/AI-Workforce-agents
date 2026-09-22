import { DEFAULT_RETRY_POLICY, DEFAULT_WORKFLOW_LIMITS, NotFoundError, StateTransitionError, ValidationError, validateWorkflowDraft, } from "../../contracts/index.js";
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
const TRANSITIONS = {
    created: ["planned", "cancelled"],
    planned: ["running", "cancelled"],
    running: ["awaiting_approval", "blocked", "completed", "failed", "cancelled"],
    awaiting_approval: ["running", "cancelled"],
    blocked: ["running", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: [],
};
export class WorkflowSystem {
    repo;
    constructor(repo = new InMemoryRepository()) {
        this.repo = repo;
    }
    create(draft) {
        validateWorkflowDraft(draft);
        const limits = { ...DEFAULT_WORKFLOW_LIMITS, ...(draft.limits ?? {}) };
        if (draft.tasks.length > limits.maxTasks) {
            throw new ValidationError(`workflow declares ${draft.tasks.length} tasks, exceeding limits.maxTasks (${limits.maxTasks})`);
        }
        const timestamp = now();
        const tasks = draft.tasks.map((task) => ({
            id: task.id,
            type: task.type,
            description: task.description,
            agentId: task.agentId,
            capability: task.capability,
            dependsOn: [...(task.dependsOn ?? [])],
            acceptanceCriteria: [...(task.acceptanceCriteria ?? [])],
            input: task.input ?? null,
            requiredPermissions: (task.requiredPermissions ?? []).map((p) => ({ ...p })),
            expectedTools: [...(task.expectedTools ?? [])],
            priority: task.priority,
            metadata: { ...(task.metadata ?? {}) },
        }));
        const taskRecords = tasks.map((task) => initialTaskRecord(task.id, timestamp));
        const workflow = {
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
    get(id) {
        return this.repo.findById(id);
    }
    require(id) {
        const workflow = this.repo.findById(id);
        if (!workflow)
            throw new NotFoundError(`unknown workflow: ${id}`);
        return workflow;
    }
    list() {
        return this.repo.list();
    }
    canTransition(from, to) {
        return TRANSITIONS[from].includes(to);
    }
    transition(id, to, patch = {}) {
        const workflow = this.require(id);
        if (!this.canTransition(workflow.status, to)) {
            throw new StateTransitionError(`invalid workflow transition: ${workflow.status} -> ${to}`);
        }
        const timestamp = now();
        const next = {
            ...workflow,
            status: to,
            updatedAt: timestamp,
            error: patch.error ?? workflow.error,
            metadata: patch.metadata
                ? { ...workflow.metadata, ...patch.metadata }
                : workflow.metadata,
            startedAt: to === "running" && !workflow.startedAt
                ? timestamp
                : workflow.startedAt,
            completedAt: to === "completed" || to === "failed" || to === "cancelled"
                ? timestamp
                : workflow.completedAt,
        };
        this.repo.upsert(next);
        return next;
    }
    /** Replace one task record (matched by `specId`) within the workflow. */
    updateTaskRecord(id, specId, patch) {
        const workflow = this.require(id);
        const index = workflow.taskRecords.findIndex((r) => r.specId === specId);
        if (index < 0) {
            throw new NotFoundError(`workflow ${id} has no task record for spec "${specId}"`);
        }
        const timestamp = now();
        const records = [...workflow.taskRecords];
        records[index] = {
            ...records[index],
            ...patch,
            specId,
            updatedAt: timestamp,
        };
        const next = {
            ...workflow,
            taskRecords: records,
            updatedAt: timestamp,
        };
        this.repo.upsert(next);
        return next;
    }
    incrementCounter(id, key, by = 1) {
        const workflow = this.require(id);
        const next = {
            ...workflow,
            counters: { ...workflow.counters, [key]: workflow.counters[key] + by },
            updatedAt: now(),
        };
        this.repo.upsert(next);
        return next;
    }
    setResult(id, result) {
        const workflow = this.require(id);
        const next = { ...workflow, result, updatedAt: now() };
        this.repo.upsert(next);
        return next;
    }
}
