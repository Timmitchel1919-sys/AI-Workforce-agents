/** Query-string values accepted by list endpoints. */
export type ApiQuery = Record<
  string,
  string | number | boolean | undefined | null
>;

export interface ApiRequestOptions {
  query?: ApiQuery;
  signal?: AbortSignal;
  /** Override the generated correlation id (e.g. to link a UI action chain). */
  correlationId?: string;
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
