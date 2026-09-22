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
import { requireText, ValidationError, } from "./index.js";
export const DEFAULT_WORKFLOW_LIMITS = {
    maxTasks: 20,
    maxAgentExecutions: 40,
    maxRetries: 2,
    maxHandoffs: 20,
    maxToolCalls: 100,
    maxDurationMs: 5 * 60_000,
    maxDelegationDepth: 1,
};
export const DEFAULT_RETRY_POLICY = {
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
];
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
];
/** Returns the cycle path (e.g. `["a","b","c","a"]`) if one exists, else `null`. */
export function findCycle(nodes) {
    const deps = new Map(nodes.map((n) => [n.id, n.dependsOn]));
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map(nodes.map((n) => [n.id, WHITE]));
    const path = [];
    const visit = (id) => {
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
                if (found)
                    return found;
            }
        }
        path.pop();
        color.set(id, BLACK);
        return null;
    };
    for (const node of nodes) {
        if (color.get(node.id) === WHITE) {
            const found = visit(node.id);
            if (found)
                return found;
        }
    }
    return null;
}
/* ------------------------------------------------------------------ */
/* Validators                                                         */
/* ------------------------------------------------------------------ */
const WORKFLOW_FAILURE_BEHAVIORS = [
    "abort",
    "continue",
];
function validateWorkflowTaskSpecDraft(draft, index) {
    requireText(draft.id, `workflow.tasks[${index}].id`);
    requireText(draft.type, `workflow.tasks[${index}].type`);
    requireText(draft.description, `workflow.tasks[${index}].description`);
    if (!draft.agentId && !draft.capability) {
        throw new ValidationError(`workflow.tasks[${index}] must specify agentId or capability`);
    }
    if (draft.dependsOn !== undefined && !Array.isArray(draft.dependsOn)) {
        throw new ValidationError(`workflow.tasks[${index}].dependsOn must be an array`);
    }
}
/** Validate a whole workflow draft: shape, unique ids, known deps, no cycles. */
export function validateWorkflowDraft(draft) {
    if (!draft || typeof draft !== "object") {
        throw new ValidationError("workflow draft must be an object");
    }
    requireText(draft.name, "workflow.name");
    requireText(draft.description, "workflow.description");
    requireText(draft.projectId, "workflow.projectId");
    if (!Array.isArray(draft.participatingAgents) ||
        draft.participatingAgents.length === 0) {
        throw new ValidationError("workflow.participatingAgents must be a non-empty array");
    }
    if (!Array.isArray(draft.tasks) || draft.tasks.length === 0) {
        throw new ValidationError("workflow.tasks must be a non-empty array");
    }
    draft.tasks.forEach((task, index) => validateWorkflowTaskSpecDraft(task, index));
    const ids = new Set();
    for (const task of draft.tasks) {
        if (ids.has(task.id)) {
            throw new ValidationError(`duplicate workflow task id: "${task.id}"`);
        }
        ids.add(task.id);
    }
    for (const task of draft.tasks) {
        for (const dep of task.dependsOn ?? []) {
            if (dep === task.id) {
                throw new ValidationError(`workflow task "${task.id}" cannot depend on itself`);
            }
            if (!ids.has(dep)) {
                throw new ValidationError(`workflow task "${task.id}" depends on unknown task "${dep}"`);
            }
        }
    }
    if (draft.failureBehavior !== undefined &&
        !WORKFLOW_FAILURE_BEHAVIORS.includes(draft.failureBehavior)) {
        throw new ValidationError("workflow.failureBehavior must be 'abort' or 'continue'");
    }
    const cycle = findCycle(draft.tasks.map((task) => ({
        id: task.id,
        dependsOn: task.dependsOn ?? [],
    })));
    if (cycle) {
        throw new ValidationError(`workflow has a circular dependency: ${cycle.join(" -> ")}`);
    }
}
