/**
 * Research Agent contracts — the structured task input and structured result
 * for the first General Agent. Reusable across projects; contains no
 * project-specific logic.
 */
import { requireText, ValidationError } from "./index.js";
const OUTPUT_FORMATS = [
    "structured",
    "summary",
    "brief",
];
/** Validate and normalise a research task. Throws `ValidationError`. */
export function validateResearchTask(raw) {
    if (!raw || typeof raw !== "object") {
        throw new ValidationError("research task must be an object");
    }
    const draft = raw;
    requireText(draft.objective, "research.objective");
    requireText(draft.question, "research.question");
    const outputFormat = draft.outputFormat ?? "structured";
    if (!OUTPUT_FORMATS.includes(outputFormat)) {
        throw new ValidationError(`research.outputFormat must be one of ${OUTPUT_FORMATS.join(", ")}`);
    }
    const sourcesRequired = draft.sourcesRequired ?? 3;
    if (!Number.isInteger(sourcesRequired) || sourcesRequired < 1) {
        throw new ValidationError("research.sourcesRequired must be a positive integer");
    }
    if (draft.constraints !== undefined && !Array.isArray(draft.constraints)) {
        throw new ValidationError("research.constraints must be an array");
    }
    if (draft.deadline !== undefined &&
        (typeof draft.deadline !== "string" ||
            Number.isNaN(Date.parse(draft.deadline)))) {
        throw new ValidationError("research.deadline must be an ISO-8601 string");
    }
    return {
        objective: draft.objective,
        question: draft.question,
        scope: draft.scope,
        projectContext: draft.projectContext,
        constraints: [...(draft.constraints ?? [])],
        outputFormat,
        sourcesRequired,
        priority: draft.priority,
        deadline: draft.deadline,
        metadata: { ...(draft.metadata ?? {}) },
    };
}
const FINDING_KINDS = [
    "fact",
    "claim",
    "assumption",
    "inference",
    "recommendation",
];
const CONFIDENCE_LEVELS = ["high", "medium", "low"];
function isUnitInterval(value) {
    return typeof value === "number" && value >= 0 && value <= 1;
}
/** Assert that `raw` is a well-formed {@link ResearchResult}. */
export function validateResearchResult(raw) {
    if (!raw || typeof raw !== "object") {
        throw new ValidationError("research result must be an object");
    }
    const result = raw;
    requireText(result.taskId, "result.taskId");
    requireText(result.agentId, "result.agentId");
    requireText(result.question, "result.question");
    requireText(result.executiveSummary, "result.executiveSummary");
    requireText(result.createdAt, "result.createdAt");
    for (const key of [
        "findings",
        "evidence",
        "sources",
        "assumptions",
        "limitations",
        "recommendations",
    ]) {
        if (!Array.isArray(result[key])) {
            throw new ValidationError(`result.${key} must be an array`);
        }
    }
    result.sources.forEach((source, index) => {
        requireText(source.id, `result.sources[${index}].id`);
        if (!isUnitInterval(source.relevance)) {
            throw new ValidationError(`result.sources[${index}].relevance must be within 0..1`);
        }
        if (!isUnitInterval(source.reliability)) {
            throw new ValidationError(`result.sources[${index}].reliability must be within 0..1`);
        }
    });
    const sourceIds = new Set(result.sources.map((s) => s.id));
    result.findings.forEach((finding, index) => {
        requireText(finding.statement, `result.findings[${index}].statement`);
        if (!FINDING_KINDS.includes(finding.kind)) {
            throw new ValidationError(`result.findings[${index}].kind must be one of ${FINDING_KINDS.join(", ")}`);
        }
        if (!Array.isArray(finding.supportingSourceIds)) {
            throw new ValidationError(`result.findings[${index}].supportingSourceIds must be an array`);
        }
        for (const id of finding.supportingSourceIds) {
            if (!sourceIds.has(id)) {
                throw new ValidationError(`result.findings[${index}] references unknown source "${id}"`);
            }
        }
        if ((finding.kind === "fact" || finding.kind === "claim") &&
            finding.supportingSourceIds.length === 0) {
            throw new ValidationError(`result.findings[${index}] is a ${finding.kind} with no supporting source`);
        }
    });
    if (!result.confidence ||
        !CONFIDENCE_LEVELS.includes(result.confidence.level) ||
        !isUnitInterval(result.confidence.score)) {
        throw new ValidationError("result.confidence must have a valid level and a 0..1 score");
    }
}
