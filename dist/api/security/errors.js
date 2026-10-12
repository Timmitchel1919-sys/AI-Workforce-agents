/**
 * Safe API error model. All responses carry a stable `code` the UI
 * can switch on, a human-safe `message` that NEVER contains stack
 * traces / tokens / Firebase internals / file paths, and the
 * server-authoritative `correlationId` for cross-referencing with
 * canonical security events and audit records.
 */
export const API_ERROR_STATUS = {
    invalid_request: 400,
    unauthenticated: 401,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    payload_too_large: 413,
    unsupported_media_type: 415,
    approval_required: 422,
    rate_limited: 429,
    security_dependency_unavailable: 503,
    method_not_allowed: 405,
    app_check_missing: 403,
    app_check_invalid: 403,
    internal_error: 500,
};
export function apiError(code, message, correlationId) {
    return {
        status: API_ERROR_STATUS[code],
        body: { error: { code, message, correlationId } },
    };
}
/**
 * Field names a request body must NEVER populate; the server derives
 * them from the trusted execution path. Routes that accept arbitrary
 * JSON strip these before passing the body to downstream services.
 */
export const UNTRUSTED_BODY_FIELDS = [
    "role",
    "capabilities",
    "isAdmin",
    "authenticated",
    "firebaseUid",
    "operatorId",
    "allowedProjects",
    "mfaVerified",
    "reauthVerified",
    "approvalSatisfied",
];
export function stripUntrustedFields(body) {
    const clean = {};
    for (const [k, v] of Object.entries(body)) {
        if (UNTRUSTED_BODY_FIELDS.includes(k))
            continue;
        clean[k] = v;
    }
    return clean;
}
