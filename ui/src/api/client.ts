/**
 * Centralized, typed Control Plane API client.
 *
 * The ONLY place in the UI that constructs HTTP requests. Responsibilities:
 * base URL, `Authorization: Bearer <id token>`, `x-correlation-id`, JSON
 * parsing, and converting every failure into a normalized `ApiError`.
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
} from "./types";

export interface ApiClientConfig {
  /** e.g. `/api` (dev, proxied) or `https://…/api` (prod). */
  baseUrl: string;
  /** Returns the current Firebase ID token, or `null` when unauthenticated. */
  getToken: () => Promise<string | null>;
  generateCorrelationId?: () => string;
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
}

export interface ApiClient {
  get<T>(path: string, options?: ApiRequestOptions): Promise<ApiResult<T>>;
  post<T>(
    path: string,
    body?: unknown,
    options?: ApiRequestOptions,
  ): Promise<ApiResult<T>>;
}

const CORRELATION_HEADER = "x-correlation-id";

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

export function createApiClient(config: ApiClientConfig): ApiClient {
  const fetchFn = config.fetchFn ?? fetch;
  const newCorrelationId = config.generateCorrelationId ?? randomCorrelationId;

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    options: ApiRequestOptions | undefined,
  ): Promise<ApiResult<T>> {
    const correlationId = options?.correlationId ?? newCorrelationId();
    const url = buildUrl(config.baseUrl, path, options?.query);

    const headers: Record<string, string> = {
      accept: "application/json",
      [CORRELATION_HEADER]: correlationId,
    };
    const token = await config.getToken();
    if (token) headers.authorization = `Bearer ${token}`;

    const init: RequestInit = { method, headers, signal: options?.signal };
    if (method === "POST") {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body ?? {});
    }

    let res: Response;
    try {
      res = await fetchFn(url, init);
    } catch (cause) {
      throw new ApiError({
        kind: "network",
        message:
          cause instanceof Error && cause.name === "AbortError"
            ? "request cancelled"
            : "network error — the Control Plane API is unreachable",
        correlationId,
      });
    }

    const echoed = res.headers.get(CORRELATION_HEADER) ?? correlationId;

    if (!res.ok) {
      throw new ApiError({
        kind: kindForStatus(res.status),
        message: await readErrorMessage(res),
        status: res.status,
        correlationId: echoed,
      });
    }

    if (res.status === 204) {
      return {
        data: undefined as T,
        status: res.status,
        correlationId: echoed,
      };
    }

    let data: T;
    try {
      data = (await res.json()) as T;
    } catch {
      throw new ApiError({
        kind: "malformed_response",
        message: "the API returned a response that could not be parsed as JSON",
        status: res.status,
        correlationId: echoed,
      });
    }

    return { data, status: res.status, correlationId: echoed };
  }

  return {
    get: (path, options) => request("GET", path, undefined, options),
    post: (path, body, options) => request("POST", path, body, options),
  };
}
