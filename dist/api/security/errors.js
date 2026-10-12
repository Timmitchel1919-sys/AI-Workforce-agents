export class ApiSecurityError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "ApiSecurityError";
    }
}
export class UnauthorizedError extends ApiSecurityError {
    constructor(message = "Unauthenticated request") {
        super(401, "unauthenticated", message);
    }
}
export class ForbiddenError extends ApiSecurityError {
    constructor(message = "You do not have permission to perform this action.") {
        super(403, "forbidden", message);
    }
}
export class ValidationError extends ApiSecurityError {
    constructor(message) {
        super(400, "invalid_request", message);
    }
}
export class PayloadTooLargeError extends ApiSecurityError {
    constructor(message = "Payload Too Large") {
        super(413, "payload_too_large", message);
    }
}
export class RateLimitError extends ApiSecurityError {
    constructor(message = "Too Many Requests") {
        super(429, "rate_limited", message);
    }
}
export class MethodNotAllowedError extends ApiSecurityError {
    constructor(message = "Method Not Allowed") {
        super(405, "method_not_allowed", message);
    }
}
export class UnsupportedMediaTypeError extends ApiSecurityError {
    constructor(message = "Unsupported Media Type") {
        super(415, "unsupported_media_type", message);
    }
}
