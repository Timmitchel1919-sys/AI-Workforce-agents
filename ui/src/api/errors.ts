/**
 * Normalized frontend API error model.
 *
 * Every HTTP failure, network failure, timeout, and malformed response becomes
 * an `ApiError` with a stable `kind` (HTTP-shaped) and a `category` (the
 * semantic bucket pages switch on). Server internals — stack traces,
 * credentials, filesystem paths — are never surfaced; only the server's
 * `error.message` string.
 */
export type ApiErrorKind =
  | "bad_request" // 400
  | "unauthorized" // 401
  | "forbidden" // 403
  | "not_found" // 404
  | "conflict" // 409
  | "unprocessable" // 422
  | "rate_limited" // 429
  | "server_error" // 500 / other 5xx
  | "service_unavailable" // 502 / 503 / 504
  | "network" // fetch rejected / offline
  | "timeout" // request exceeded the client timeout
  | "malformed_response" // 2xx body was not the expected shape
  | "unknown"; // anything else

/** The bucket a page switches on to choose UX. */
export type ApiErrorCategory =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "server_error"
  | "network"
  | "timeout"
  | "unknown";

const STATUS_KIND: Record<number, ApiErrorKind> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "unprocessable",
  429: "rate_limited",
  502: "service_unavailable",
  503: "service_unavailable",
  504: "service_unavailable",
};

export function kindForStatus(status: number): ApiErrorKind {
  const mapped = STATUS_KIND[status];
  if (mapped) return mapped;
  if (status >= 500) return "server_error";
  return "unknown";
}

const KIND_CATEGORY: Record<ApiErrorKind, ApiErrorCategory> = {
  bad_request: "validation",
  unprocessable: "validation",
  unauthorized: "unauthenticated",
  forbidden: "forbidden",
  not_found: "not_found",
  conflict: "conflict",
  rate_limited: "rate_limited",
  server_error: "server_error",
  service_unavailable: "server_error",
  network: "network",
  timeout: "timeout",
  malformed_response: "unknown",
  unknown: "unknown",
};

export interface ApiErrorInit {
  kind: ApiErrorKind;
  message: string;
  status?: number | null;
  correlationId?: string | null;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly category: ApiErrorCategory;
  readonly status: number | null;
  readonly correlationId: string | null;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.kind = init.kind;
    this.category = KIND_CATEGORY[init.kind];
    this.status = init.status ?? null;
    this.correlationId = init.correlationId ?? null;
  }

  /** `401` — the caller should route to sign-in. */
  get isAuthError(): boolean {
    return this.category === "unauthenticated";
  }
  /** `403` — authenticated but not permitted. */
  get isForbidden(): boolean {
    return this.category === "forbidden";
  }
  /** `409` — someone else changed this; refetch before retrying. */
  get isConflict(): boolean {
    return this.category === "conflict";
  }
  /** Transient — a retry might succeed. */
  get isRetryable(): boolean {
    return (
      this.category === "network" ||
      this.category === "timeout" ||
      this.category === "rate_limited" ||
      this.category === "server_error"
    );
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** A safe, human message for any thrown value. Never leaks internals. */
export function safeErrorMessage(value: unknown): string {
  if (isApiError(value)) return value.message;
  if (value instanceof Error && value.message) return value.message;
  return "Something went wrong.";
}
