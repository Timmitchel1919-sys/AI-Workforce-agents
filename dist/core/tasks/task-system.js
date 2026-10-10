import { NotFoundError, StateTransitionError, ValidationError, validateTaskDraft, } from "../../contracts/index.js";
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
const TRANSITIONS = {
    created: ["queued", "cancelled"],
    queued: ["running", "blocked", "awaiting_approval", "cancelled"],
    running: ["blocked", "awaiting_approval", "completed", "failed", "cancelled"],
    blocked: ["queued", "running", "cancelled"],
    awaiting_approval: ["running", "queued", "failed", "cancelled"],
    completed: [],
    failed: ["queued"],
    cancelled: [],
};
export class TaskSystem {
    repo;
    newId;
    constructor(repo = new InMemoryRepository(), options = {}) {
        this.repo = repo;
        this.newId = options.newId ?? (() => createId("task"));
    }
    create(draft) {
        validateTaskDraft(draft);
        const timestamp = now();
        const taskId = this.newId();
        if (typeof taskId !== "string" || taskId.trim() === "") {
            throw new ValidationError("task.id factory returned an empty id");
        }
        if (this.repo.findById(taskId)) {
            throw new StateTransitionError(`task id collision: ${taskId}`);
        }
        const requiredPermissions = (draft.requiredPermissions ?? []).map((entry) => ({ ...entry }));
        const task = {
            id: taskId,
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
            // EO-5.1 orchestration extensions — carried through so the software
            // factory can plan, gate and dispatch without losing task authorship.
            ...(draft.programId !== undefined ? { programId: draft.programId } : {}),
            ...(draft.workstreamId !== undefined
                ? { workstreamId: draft.workstreamId }
                : {}),
            ...(draft.objective !== undefined ? { objective: draft.objective } : {}),
            requirements: draft.requirements ?? [],
            dependencies: draft.dependencies ?? [],
            requiredCapabilities: draft.requiredCapabilities ?? [],
            environmentRequirements: draft.environmentRequirements ?? [],
            ...(draft.modelRequirements !== undefined
                ? { modelRequirements: draft.modelRequirements }
                : {}),
            completionCriteria: draft.completionCriteria ?? [],
            ...(draft.riskClass !== undefined ? { riskClass: draft.riskClass } : {}),
            ...(draft.executionContext !== undefined
                ? { executionContext: structuredClone(draft.executionContext) }
                : {}),
        };
        this.repo.upsert(task);
        return task;
    }
    get(id) {
        return this.repo.findById(id);
    }
    require(id) {
        const task = this.repo.findById(id);
        if (!task)
            throw new NotFoundError(`unknown task: ${id}`);
        return task;
    }
    list() {
        return this.repo.list();
    }
    /** Remove a task outright (used by the software factory for planned-placeholder cleanup). */
    delete(id) {
        return this.repo.delete(id);
    }
    canTransition(from, to) {
        return TRANSITIONS[from].includes(to);
    }
    transition(id, to, patch = {}) {
        const task = this.require(id);
        if (!this.canTransition(task.status, to)) {
            throw new StateTransitionError(`invalid task transition: ${task.status} -> ${to}`);
        }
        const next = {
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
    assign(id, agentId) {
        return this.transition(id, "running", { assignedAgentId: agentId });
    }
    complete(id, output) {
        return this.transition(id, "completed", { output });
    }
    fail(id, error) {
        return this.transition(id, "failed", { error });
    }
    cancel(id) {
        return this.transition(id, "cancelled");
    }
}
