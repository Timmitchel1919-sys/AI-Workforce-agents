/**
 * Project Manager Agent contracts.
 *
 * The Project Manager never executes a tool, dispatches a task, or assigns an
 * agent itself — it only produces a structured `ProjectManagerDecision`
 * (subtasks it recommends, or a final summary). The `WorkflowEngine` is the
 * only thing authorized to turn that decision into real tasks, and it
 * re-validates every recommendation (agent eligibility, project scope,
 * permissions) before doing so — the decision is never trusted blindly.
 */
import { requireText, ValidationError } from "./index.js";
import { findCycle } from "./workflow.js";
const MODES = ["decompose", "summarize"];
const RECOMMENDATIONS = [
    "proceed",
    "needs_approval",
    "blocked",
];
const FINAL_STATUSES = [
    "completed",
    "blocked",
    "failed",
];
export function validateProjectManagerTask(raw) {
    if (!raw || typeof raw !== "object") {
        throw new ValidationError("project manager task must be an object");
    }
    const draft = raw;
    requireText(draft.objective, "projectManagerTask.objective");
    const mode = draft.mode ?? "decompose";
    if (!MODES.includes(mode)) {
        throw new ValidationError(`projectManagerTask.mode must be one of ${MODES.join(", ")}`);
    }
    return {
        mode,
        objective: draft.objective,
        constraints: [...(draft.constraints ?? [])],
        availableAgents: [...(draft.availableAgents ?? [])],
        priorResults: (draft.priorResults ?? []).map((r) => ({ ...r })),
        metadata: { ...(draft.metadata ?? {}) },
    };
}
export function validateProjectManagerDecision(raw) {
    if (!raw || typeof raw !== "object") {
        throw new ValidationError("project manager decision must be an object");
    }
    const decision = raw;
    if (!MODES.includes(decision.mode)) {
        throw new ValidationError(`decision.mode must be one of ${MODES.join(", ")}`);
    }
    requireText(decision.summary, "decision.summary");
    requireText(decision.createdAt, "decision.createdAt");
    if (!RECOMMENDATIONS.includes(decision.recommendation)) {
        throw new ValidationError(`decision.recommendation must be one of ${RECOMMENDATIONS.join(", ")}`);
    }
    if (!Array.isArray(decision.subtasks)) {
        throw new ValidationError("decision.subtasks must be an array");
    }
    if (decision.mode === "decompose") {
        if (decision.subtasks.length === 0) {
            throw new ValidationError("decision.subtasks must not be empty in decompose mode");
        }
        const ids = new Set();
        for (const [index, sub] of decision.subtasks.entries()) {
            requireText(sub.id, `decision.subtasks[${index}].id`);
            requireText(sub.type, `decision.subtasks[${index}].type`);
            requireText(sub.description, `decision.subtasks[${index}].description`);
            if (!sub.recommendedAgentId && !sub.recommendedCapability) {
                throw new ValidationError(`decision.subtasks[${index}] must recommend an agent or a capability`);
            }
            if (ids.has(sub.id)) {
                throw new ValidationError(`duplicate subtask id: "${sub.id}"`);
            }
            ids.add(sub.id);
        }
        for (const sub of decision.subtasks) {
            for (const dep of sub.dependsOn ?? []) {
                if (!ids.has(dep)) {
                    throw new ValidationError(`subtask "${sub.id}" depends on unknown subtask "${dep}"`);
                }
            }
        }
        const cycle = findCycle(decision.subtasks.map((s) => ({
            id: s.id,
            dependsOn: s.dependsOn ?? [],
        })));
        if (cycle) {
            throw new ValidationError(`decision.subtasks has a circular dependency: ${cycle.join(" -> ")}`);
        }
    }
    else {
        if (decision.finalStatus === undefined ||
            !FINAL_STATUSES.includes(decision.finalStatus)) {
            throw new ValidationError(`decision.finalStatus must be one of ${FINAL_STATUSES.join(", ")} in summarize mode`);
        }
    }
}
