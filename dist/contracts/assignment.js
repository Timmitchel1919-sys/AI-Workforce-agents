/**
 * Assignment — the authoritative binding of a task to a specialist agent.
 *
 * This is a first-class, persisted record, not a field on a task and not a
 * frontend-only property. It exists so that three questions can be answered
 * from evidence rather than inference:
 *
 *   Who was assigned?          -> `agentId` + `descriptorVersion`
 *   Why were they eligible?    -> `qualification` (the evidence, verbatim)
 *   What happened to the work? -> `status` + the reassignment chain
 *
 * It is deliberately NOT an execution: an assignment says a qualified agent
 * accepted the work, an execution says a model was actually called. Those are
 * different facts with different timestamps, and conflating them is how
 * "assigned" starts being reported as "done".
 */
import { ValidationError } from "./index.js";
import { AGENT_RISK_LEVELS, isSafeIdentifier, isSafePrincipal } from "./workforce.js";
import { isCapabilityId, MAX_CAPABILITY_ID_LENGTH } from "./capabilities.js";
const DEFAULT_REVIEW_CAPABILITIES = ["software.review"];
function requireText(value, field, max = 200) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new ValidationError(`${field} must be a non-empty string`);
    }
    if (value.length > max) {
        throw new ValidationError(`${field} must be at most ${max} characters`);
    }
}
function requireCapabilityList(value, field, max) {
    if (!Array.isArray(value))
        throw new ValidationError(`${field} must be an array`);
    if (value.length > max) {
        throw new ValidationError(`${field} must contain at most ${max} entries`);
    }
    for (const [index, entry] of value.entries()) {
        requireText(entry, `${field}[${index}]`, MAX_CAPABILITY_ID_LENGTH);
    }
    return value;
}
/** Fail-safe structural validation. A forged requirements object never qualifies. */
export function validateTaskRequirements(requirements) {
    if (!requirements || typeof requirements !== "object") {
        throw new ValidationError("task requirements must be an object");
    }
    if (!isSafeIdentifier(requirements.projectId)) {
        throw new ValidationError("task requirements projectId is invalid");
    }
    requireText(requirements.taskType, "task requirements taskType", 120);
    const required = requireCapabilityList(requirements.requiredCapabilities, "task requirements requiredCapabilities", 128);
    for (const capability of required) {
        if (!isCapabilityId(capability)) {
            throw new ValidationError(`task requirements requiredCapabilities contains a non-canonical capability: ${JSON.stringify(capability)}`);
        }
    }
    for (const field of [
        "preferredCapabilities",
        "technologyRequirements",
        "environmentRequirements",
        "writeScope",
        "excludeAgentIds",
    ]) {
        if (requirements[field] === undefined)
            continue;
        requireCapabilityList(requirements[field], `task requirements ${field}`, 256);
    }
    if (requirements.toolRequirements !== undefined) {
        requireCapabilityList(requirements.toolRequirements, "task requirements toolRequirements", 64);
    }
    if (!AGENT_RISK_LEVELS.includes(requirements.riskLevel)) {
        throw new ValidationError("task requirements riskLevel is not a known risk level");
    }
    if (requirements.reviewCapabilities !== undefined) {
        const review = requireCapabilityList(requirements.reviewCapabilities, "task requirements reviewCapabilities", 32);
        for (const capability of review) {
            if (!isCapabilityId(capability)) {
                throw new ValidationError(`task requirements reviewCapabilities contains a non-canonical capability: ${JSON.stringify(capability)}`);
            }
        }
    }
    if (requirements.implementerAgentId !== undefined) {
        if (!isSafeIdentifier(requirements.implementerAgentId)) {
            throw new ValidationError("task requirements implementerAgentId is invalid");
        }
    }
}
/**
 * Does a task REQUIRE independent review?
 *
 * A review requirement is asserted two ways and both hold: the task says so
 * explicitly, OR the task's risk reaches the threshold the assigned agent
 * declared. Review is never optional because an implementer finds it
 * inconvenient.
 */
export function requiresIndependentReview(requirements) {
    if (requirements.requiresIndependentReview === true)
        return true;
    const level = requirements.riskLevel;
    return (level === "critical" ||
        level === "high" ||
        (level === "moderate" && reviewThresholdReached(requirements)));
}
function reviewThresholdReached(requirements) {
    // The threshold lives on the agent; at REQUIREMENT level we cannot know it,
    // so a moderate-risk task is treated as requiring review only when it also
    // names a reviewer capability. A high or critical task always does.
    return (requirements.reviewCapabilities ?? DEFAULT_REVIEW_CAPABILITIES).length > 0;
}
/* ------------------------------------------------------------------ */
/* Assignment lifecycle                                               */
/* ------------------------------------------------------------------ */
export const ASSIGNMENT_STATUSES = [
    "pending",
    "assigned",
    "accepted",
    "executing",
    "completed",
    "failed",
    "cancelled",
    "reassigned",
];
const ASSIGNMENT_TRANSITIONS = Object.freeze({
    pending: ["assigned", "cancelled"],
    assigned: ["accepted", "failed", "cancelled", "reassigned"],
    accepted: ["executing", "failed", "cancelled", "reassigned"],
    executing: ["completed", "failed", "cancelled", "reassigned"],
    // Terminal. A completed, failed, cancelled or reassigned assignment is never
    // resurrected — the history of what happened stays exactly as it happened.
    completed: [],
    failed: [],
    cancelled: [],
    reassigned: [],
});
export function canTransitionAssignment(from, to) {
    return ASSIGNMENT_TRANSITIONS[from].includes(to);
}
export function validateAssignment(assignment) {
    if (!assignment || typeof assignment !== "object") {
        throw new ValidationError("assignment must be an object");
    }
    for (const field of ["assignmentId", "projectId", "taskId", "agentId"]) {
        if (!isSafeIdentifier(assignment[field])) {
            throw new ValidationError(`assignment.${field} is invalid`);
        }
    }
    if (!isSafePrincipal(assignment.assignedBy)) {
        throw new ValidationError("assignment.assignedBy is invalid");
    }
    if (!Number.isInteger(assignment.descriptorVersion) || assignment.descriptorVersion < 1) {
        throw new ValidationError("assignment.descriptorVersion must be an integer >= 1");
    }
    if (!ASSIGNMENT_STATUSES.includes(assignment.status)) {
        throw new ValidationError(`assignment.status is not a known status: ${assignment.status}`);
    }
    requireText(assignment.assignedAt, "assignment.assignedAt", 64);
    requireText(assignment.updatedAt, "assignment.updatedAt", 64);
    if (assignment.qualification === undefined ||
        typeof assignment.qualification !== "object") {
        throw new ValidationError("assignment.qualification is required");
    }
    if (assignment.qualification.qualified !== true) {
        throw new ValidationError("an assignment may only be created for a QUALIFIED agent; qualification is evidence, not an assumption");
    }
    requireCapabilityList(assignment.qualification.matchedCapabilities, "assignment.qualification.matchedCapabilities", 128);
    requireCapabilityList(assignment.qualification.reasonCodes, "assignment.qualification.reasonCodes", 32);
    if (assignment.qualification.descriptorVersion !== assignment.descriptorVersion) {
        throw new ValidationError("assignment.qualification must describe the same descriptor version as the assignment");
    }
    if (assignment.replacesAssignmentId !== undefined) {
        if (!isSafeIdentifier(assignment.replacesAssignmentId)) {
            throw new ValidationError("assignment.replacesAssignmentId is invalid");
        }
        if (assignment.replacesAssignmentId === assignment.assignmentId) {
            throw new ValidationError("an assignment cannot replace itself");
        }
    }
    if (assignment.writeScope !== undefined) {
        requireCapabilityList(assignment.writeScope, "assignment.writeScope", 256);
    }
}
