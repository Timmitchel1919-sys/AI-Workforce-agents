export const SECURITY_EVENT_CATEGORIES = [
    "authentication",
    "authorization",
    "policy",
    "data_protection",
    "agent_security",
    "system",
];
export const SECURITY_EVENT_SEVERITIES = [
    "info",
    "low",
    "medium",
    "high",
    "critical",
];
export const SECURITY_EVENT_OUTCOMES = [
    "allowed",
    "denied",
    "blocked",
    "failed",
    "observed",
];
export function validateSecurityEvent(event) {
    if (!event.id || !event.eventId || event.id !== event.eventId)
        throw new Error("security event id must equal eventId");
    if (event.schemaVersion !== 1)
        throw new Error("unsupported security event schema");
    if (!event.occurredAt || Number.isNaN(Date.parse(event.occurredAt)))
        throw new Error("security event occurredAt must be an ISO timestamp");
    if (!event.category || !event.type || !event.severity || !event.outcome)
        throw new Error("security event identity fields are required");
    if (!event.actor.kind || !event.source.kind)
        throw new Error("security event actor and source are required");
}
