import { createHash } from "node:crypto";
export const SECURITY_EVENT_GENESIS_HASH = "0".repeat(64);
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]));
    }
    return value;
}
export function computeSecurityEventHash(event, previousEventHash = SECURITY_EVENT_GENESIS_HASH) {
    const { eventHash: _eventHash, previousEventHash: _previous, ...content } = event;
    return createHash("sha256")
        .update(JSON.stringify(canonical({ ...content, previousEventHash })))
        .digest("hex");
}
export function chainSecurityEvent(event, previousEventHash = SECURITY_EVENT_GENESIS_HASH) {
    const chained = { ...structuredClone(event), previousEventHash };
    return {
        ...chained,
        eventHash: computeSecurityEventHash(chained, previousEventHash),
    };
}
export function verifySecurityEventIntegrity(event) {
    if (!event.previousEventHash || !event.eventHash)
        return false;
    return (computeSecurityEventHash(event, event.previousEventHash) === event.eventHash);
}
export function securityEventChainScope(event) {
    return event.projectId ?? "__global__";
}
