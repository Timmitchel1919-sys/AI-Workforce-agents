/**
 * Safe API error model. All responses carry a stable `code` the UI
 * can switch on, a human-safe `message` that NEVER contains stack
 * traces / tokens / Firebase internals / file paths, and the
 * server-authoritative `correlationId` for cross-referencing with
 * canonical security events and audit records.
 */
export type ApiErrorCode = "invalid_request" | "unauthenticated" | "forbidden" | "not_found" | "conflict" | "payload_too_large" | "unsupported_media_type" | "approval_required" | "rate_limited" | "security_dependency_unavailable" | "method_not_allowed" | "app_check_missing" | "app_check_invalid" | "internal_error";
export declare const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>>;
export interface ApiErrorBody {
    error: {
        code: ApiErrorCode;
        message: string;
        correlationId: string;
    };
}
export declare function apiError(code: ApiErrorCode, message: string, correlationId: string): {
    status: number;
    body: ApiErrorBody;
};
/**
 * Field names a request body must NEVER populate; the server derives
 * them from the trusted execution path. Routes that accept arbitrary
 * JSON strip these before passing the body to downstream services.
 */
export declare const UNTRUSTED_BODY_FIELDS: readonly ["role", "capabilities", "isAdmin", "authenticated", "firebaseUid", "operatorId", "allowedProjects", "mfaVerified", "reauthVerified", "approvalSatisfied"];
export declare function stripUntrustedFields(body: Record<string, unknown>): Record<string, unknown>;
