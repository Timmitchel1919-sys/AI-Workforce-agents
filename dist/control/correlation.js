import { createId } from "../core/index.js";
export function createCorrelationId() {
    return createId("corr");
}
/** A well-formed id: short, and only characters that are safe in logs, headers and audit records. */
const SAFE_CORRELATION_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
/**
 * Use the caller's correlation id when it is well-formed (<=128 chars of `[A-Za-z0-9_.:-]`);
 * anything else — empty, oversized, or with other characters — is replaced by a minted id, so a
 * caller can neither bloat nor forge free-form text into the audit trail.
 */
export function resolveCorrelationId(options) {
    return sanitizeCorrelationId(options?.correlationId) ?? createCorrelationId();
}
/** The trimmed id when well-formed, else undefined (the caller mints one). */
export function sanitizeCorrelationId(supplied) {
    if (typeof supplied !== "string")
        return undefined;
    const trimmed = supplied.trim();
    return SAFE_CORRELATION_ID.test(trimmed) ? trimmed : undefined;
}
