/**
 * Normalized frontend API error model.
 *
 * Every HTTP failure, network failure, and malformed response becomes an
 * `ApiError` with a stable `kind`. Server internals (stack traces, credentials)
 * are never surfaced — only the server's `error.message` string.
 */
export type ApiErrorKind =
  | "bad_request" // 400
  | "unauthorized" // 401
  | "forbidden" // 403
  | "not_found" // 404
  | "conflict" // 409
  | "unprocessable" // 422
  | "server_error" // 5xx
  | "network" // fetch rejected / offline
  | "malformed_response" // 2xx body was not the expected JSON
  | "unknown"; // anything else

const STATUS_KIND: Record<number, ApiErrorKind> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "unprocessable",
};

export function kindForStatus(status: number): ApiErrorKind {
  if (STATUS_KIND[status]) return STATUS_KIND[status];
  if (status >= 500) return "server_error";
  return "unknown";
}

export interface ApiErrorInit {
  kind: ApiErrorKind;
  message: string;
  status?: number | null;
  correlationId?: string | null;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly correlationId: string | null;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.correlationId = init.correlationId ?? null;
  }

  /** True for `401` — the caller should redirect to sign-in. */
  get isAuthError(): boolean {
    return this.kind === "unauthorized";
  }

  /** True for `403` — authenticated but not permitted. */
  get isForbidden(): boolean {
    return this.kind === "forbidden";
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
