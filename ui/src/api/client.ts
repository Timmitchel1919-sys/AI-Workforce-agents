/**
 * Centralized, typed Control Plane API client.
 *
 * The ONLY place in the UI that constructs HTTP requests. Responsibilities:
 * base URL, `Authorization: Bearer <id token>`, `x-correlation-id`, JSON
 * encode/decode, per-request timeout, and converting every failure — HTTP,
 * network, timeout, malformed body — into a normalized `ApiError`.
 *
 * Components and features never call `fetch` — they go through endpoint modules
 * that take an `ApiClient`.
 */
import { ApiError, kindForStatus } from "./errors";
import type {
  ApiErrorBody,
  ApiQuery,
  ApiRequestOptions,
  ApiResult,
  HttpMethod,
  RequestLogEntry,
} from "./types";

export interface ApiClientConfig {
  /** e.g. `/api` (dev, proxied) or `https://…/api` (prod). */
  baseUrl: string;
  /** Returns the current Firebase ID token, or `null` when unauthenticated. */
  getToken: () => Promise<string | null>;
  /** Default per-request timeout (ms). Default 20000. */
  timeoutMs?: number;
  generateCorrelationId?: () => string;
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Dev diagnostics. Receives a safe entry (no auth headers / token / body). */
  logger?: (entry: RequestLogEntry) => void;
}

export interface ApiClient {
  get<T>(path: string, options?: ApiRequestOptions<T>): Promise<ApiResult<T>>;
  post<T>(
    path: string,
    body?: unknown,
    options?: ApiRequestOptions<T>,
  ): Promise<ApiResult<T>>;
  patch<T>(
    path: string,
    body?: unknown,
    options?: ApiRequestOptions<T>,
  ): Promise<ApiResult<T>>;
  delete<T>(
    path: string,
    options?: ApiRequestOptions<T>,
  ): Promise<ApiResult<T>>;
}

const CORRELATION_HEADER = "x-correlation-id";
const DEFAULT_TIMEOUT_MS = 20_000;

function randomCorrelationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function buildUrl(baseUrl: string, path: string, query?: ApiQuery): string {
  const base = baseUrl.replace(/\/$/, "");
  const rel = path.startsWith("/") ? path : `/${path}`;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      qs.set(key, String(value));
    }
  }
  const suffix = qs.toString();
  return suffix ? `${base}${rel}?${suffix}` : `${base}${rel}`;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.clone().json()) as Partial<ApiErrorBody>;
    if (body && body.error && typeof body.error.message === "string") {
      return body.error.message;
    }
  } catch {
    /* fall through to text */
  }
  try {
    const text = (await res.text()).trim();
    if (text) return text.slice(0, 500);
  } catch {
    /* ignore */
  }
  return res.statusText || `request failed (${res.status})`;
}

/** Merge the caller's AbortSignal (if any) with our timeout signal. */
function linkAbort(
  external: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: () => boolean; cleanup: () => void } {
  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort);
  }
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const fetchFn = config.fetchFn ?? fetch;
  const newCorrelationId = config.generateCorrelationId ?? randomCorrelationId;
  const defaultTimeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request<T>(
    method: HttpMethod,
    path: string,
    body: unknown,
    options: ApiRequestOptions<T> | undefined,
  ): Promise<ApiResult<T>> {
    const correlationId = options?.correlationId ?? newCorrelationId();
    const url = buildUrl(config.baseUrl, path, options?.query);
    const startedAt = Date.now();

    const log = (status: number | null, ok: boolean, errorKind?: string) =>
      config.logger?.({
        method,
        path,
        status,
        ok,
        durationMs: Date.now() - startedAt,
        correlationId,
        errorKind,
      });

    const headers: Record<string, string> = {
      accept: "application/json",
      [CORRELATION_HEADER]: correlationId,
    };
    const token = await config.getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    if (method === "POST" || method === "PATCH" || method === "DELETE") {
      headers["content-type"] = "application/json";
    }

    const abort = linkAbort(
      options?.signal,
      options?.timeoutMs ?? defaultTimeout,
    );
    const init: RequestInit = { method, headers, signal: abort.signal };
    if (method === "POST" || method === "PATCH") {
      init.body = JSON.stringify(body ?? {});
    } else if (method === "DELETE" && body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetchFn(url, init);
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === "AbortError";
      const kind = aborted && abort.timedOut() ? "timeout" : "network";
      log(null, false, kind);
      throw new ApiError({
        kind,
        message:
          kind === "timeout"
            ? "the Control Plane API did not respond in time"
            : aborted
              ? "request cancelled"
              : "network error — the Control Plane API is unreachable",
        correlationId,
      });
    } finally {
      abort.cleanup();
    }

    const echoed = res.headers.get(CORRELATION_HEADER) ?? correlationId;

    if (!res.ok) {
      const kind = kindForStatus(res.status);
      log(res.status, false, kind);
      throw new ApiError({
        kind,
        message: await readErrorMessage(res),
        status: res.status,
        correlationId: echoed,
      });
    }

    if (res.status === 204) {
      log(res.status, true);
      return {
        data: undefined as T,
        status: res.status,
        correlationId: echoed,
      };
    }

    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      log(res.status, false, "malformed_response");
      throw new ApiError({
        kind: "malformed_response",
        message: "the API returned a response that could not be parsed as JSON",
        status: res.status,
        correlationId: echoed,
      });
    }

    let data: T;
    if (options?.parse) {
      try {
        data = options.parse(raw);
      } catch (cause) {
        log(res.status, false, "malformed_response");
        throw new ApiError({
          kind: "malformed_response",
          message:
            cause instanceof Error
              ? `unexpected API response shape: ${cause.message}`
              : "unexpected API response shape",
          status: res.status,
          correlationId: echoed,
        });
      }
    } else {
      data = raw as T;
    }

    log(res.status, true);
    return { data, status: res.status, correlationId: echoed };
  }

  return {
    get: (path, options) => request("GET", path, undefined, options),
    post: (path, body, options) => request("POST", path, body, options),
    patch: (path, body, options) => request("PATCH", path, body, options),
    delete: (path, options) => request("DELETE", path, undefined, options),
  };
}
