/**
 * Developer Agent contracts.
 *
 * Phase 5's Developer Agent is planning/review-oriented: it produces a
 * structured plan and a list of *proposed* changes with rationale and risk —
 * never a real file write, shell command, or repository mutation. Turning a
 * proposal into an actual change is a separate, approval-gated capability for
 * a later phase.
 */
import { requireText, ValidationError } from "./index.js";
const MODES = ["plan", "review", "implement"];
const RISK_LEVELS = ["low", "medium", "high"];
const RECOMMENDATIONS = [
    "ready_for_qa",
    "needs_clarification",
    "blocked",
];
export function validateDeveloperTask(raw) {
    if (!raw || typeof raw !== "object") {
        throw new ValidationError("developer task must be an object");
    }
    const draft = raw;
    requireText(draft.objective, "developerTask.objective");
    requireText(draft.instructions, "developerTask.instructions");
    const mode = draft.mode ?? "plan";
    if (!MODES.includes(mode)) {
        throw new ValidationError(`developerTask.mode must be one of ${MODES.join(", ")}`);
    }
    return {
        mode,
        objective: draft.objective,
        instructions: draft.instructions,
        context: [...(draft.context ?? [])],
        acceptanceCriteria: [...(draft.acceptanceCriteria ?? [])],
        constraints: [...(draft.constraints ?? [])],
        metadata: { ...(draft.metadata ?? {}) },
    };
}
export function validateDeveloperResult(raw) {
    if (!raw || typeof raw !== "object") {
        throw new ValidationError("developer result must be an object");
    }
    const result = raw;
    requireText(result.taskId, "result.taskId");
    requireText(result.agentId, "result.agentId");
    requireText(result.summary, "result.summary");
    requireText(result.createdAt, "result.createdAt");
    if (!MODES.includes(result.mode)) {
        throw new ValidationError(`result.mode must be one of ${MODES.join(", ")}`);
    }
    if (!RECOMMENDATIONS.includes(result.recommendation)) {
        throw new ValidationError(`result.recommendation must be one of ${RECOMMENDATIONS.join(", ")}`);
    }
    for (const key of [
        "plan",
        "risks",
        "openQuestions",
        "proposedChanges",
    ]) {
        if (!Array.isArray(result[key])) {
            throw new ValidationError(`result.${key} must be an array`);
        }
    }
    result.proposedChanges.forEach((change, index) => {
        requireText(change.description, `result.proposedChanges[${index}].description`);
        requireText(change.rationale, `result.proposedChanges[${index}].rationale`);
        if (!RISK_LEVELS.includes(change.riskLevel)) {
            throw new ValidationError(`result.proposedChanges[${index}].riskLevel must be one of ${RISK_LEVELS.join(", ")}`);
        }
    });
}
