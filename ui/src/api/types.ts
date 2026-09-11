/** Query-string values accepted by list endpoints. */
export type ApiQuery = Record<
  string,
  string | number | boolean | undefined | null
>;

export interface ApiRequestOptions<T = unknown> {
  query?: ApiQuery;
  signal?: AbortSignal;
  /** Override the generated correlation id (e.g. to link a UI action chain). */
  correlationId?: string;
  /** Override the client's default per-request timeout (ms). */
  timeoutMs?: number;
  /**
   * Validate / narrow the parsed JSON at the boundary. Throw to reject a
   * malformed response — the client turns that into a `malformed_response`
   * `ApiError`.
   */
  parse?: (data: unknown) => T;
}

export interface ApiResult<T> {
  data: T;
  status: number;
  /** The correlation id echoed by the server, or the one we sent. */
  correlationId: string;
}

/** Shape of the structured error body the Control Plane API returns. */
export interface ApiErrorBody {
  error: { message: string };
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Development request diagnostics. NEVER carries auth headers, tokens, or bodies. */
export interface RequestLogEntry {
  method: HttpMethod;
  path: string;
  status: number | null;
  ok: boolean;
  durationMs: number;
  correlationId: string;
  errorKind?: string;
}
