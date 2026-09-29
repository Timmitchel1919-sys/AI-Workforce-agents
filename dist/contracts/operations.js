import { ValidationError, requireText } from "./index.js";
export const OPERATIONAL_EVENT_KINDS = [
    "audit_observation",
    "task_lifecycle",
    "workflow_lifecycle",
    "tool_execution",
    "model_execution",
    "approval_decision",
    "environment_observation",
    "verification",
    "release",
];
export const OUTCOME_DOMAINS = [
    "cost",
    "capacity",
    "delivery",
    "failure_risk",
    "reliability",
];
export const DATA_READINESS_STATUSES = [
    "ready",
    "limited",
    "not_ready",
    "unknown",
];
const sensitiveKey = /(?:api[_-]?key|authorization|credential|password|secret|token)/i;
function requireIso(value, field) {
    if (Number.isNaN(Date.parse(value))) {
        throw new ValidationError(`${field} must be an ISO timestamp`);
    }
}
function validateRecord(values, field) {
    for (const [key, value] of Object.entries(values)) {
        if (sensitiveKey.test(key)) {
            throw new ValidationError(`${field}.${key} must not contain sensitive data`);
        }
        if (typeof value !== "string" &&
            typeof value !== "number" &&
            typeof value !== "boolean") {
            throw new ValidationError(`${field}.${key} must be a scalar value`);
        }
    }
}
export function validateProvenance(value) {
    if (!["workforce", "operator", "integration", "import"].includes(value.source)) {
        throw new ValidationError("provenance.source is invalid");
    }
    requireText(value.sourceId, "provenance.sourceId");
}
export function validateOperationalEvent(event) {
    requireText(event.id, "event.id");
    requireText(event.projectId, "event.projectId");
    if (!OPERATIONAL_EVENT_KINDS.includes(event.kind)) {
        throw new ValidationError("event.kind is invalid");
    }
    requireIso(event.observedAt, "event.observedAt");
    requireIso(event.recordedAt, "event.recordedAt");
    validateProvenance(event.provenance);
    validateRecord(event.dimensions, "event.dimensions");
}
export function validateOperationalOutcome(outcome) {
    requireText(outcome.id, "outcome.id");
    requireText(outcome.projectId, "outcome.projectId");
    if (!OUTCOME_DOMAINS.includes(outcome.domain)) {
        throw new ValidationError("outcome.domain is invalid");
    }
    if (!["succeeded", "failed", "cancelled", "unknown"].includes(outcome.status)) {
        throw new ValidationError("outcome.status is invalid");
    }
    requireIso(outcome.occurredAt, "outcome.occurredAt");
    requireIso(outcome.recordedAt, "outcome.recordedAt");
    validateProvenance(outcome.provenance);
    validateRecord(outcome.actual, "outcome.actual");
}
