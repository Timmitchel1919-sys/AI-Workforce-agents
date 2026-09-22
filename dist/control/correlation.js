import { createId } from "../core/index.js";
export function createCorrelationId() {
    return createId("corr");
}
/** Use the caller's correlation id when it is a non-empty string; else mint one. */
export function resolveCorrelationId(options) {
    const supplied = options?.correlationId;
    if (typeof supplied === "string" && supplied.trim().length > 0) {
        return supplied.trim();
    }
    return createCorrelationId();
}
