export declare class ApiSecurityError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string);
}
export declare class UnauthorizedError extends ApiSecurityError {
    constructor(message?: string);
}
export declare class ForbiddenError extends ApiSecurityError {
    constructor(message?: string);
}
export declare class ValidationError extends ApiSecurityError {
    constructor(message: string);
}
export declare class PayloadTooLargeError extends ApiSecurityError {
    constructor(message?: string);
}
export declare class RateLimitError extends ApiSecurityError {
    constructor(message?: string);
}
export declare class MethodNotAllowedError extends ApiSecurityError {
    constructor(message?: string);
}
export declare class UnsupportedMediaTypeError extends ApiSecurityError {
    constructor(message?: string);
}
