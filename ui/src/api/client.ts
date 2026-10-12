import { ApiError } from "./errors";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

const REQUEST_TIMEOUT_MS = 15_000;

function createCorrelationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessageFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  if ("message" in body && typeof body.message === "string") return body.message;
  if (
    "error" in body &&
    body.error &&
    typeof body.error === "object" &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }
  return undefined;
}

export interface ApiRequestOptions extends RequestInit {
  accessToken?: string | null;
  appCheckToken?: string | null;
}

export type AccessTokenProvider = (forceRefresh: boolean) => Promise<string | null>;
export type AppCheckTokenProvider = (forceRefresh?: boolean) => Promise<string | null>;

let accessTokenProvider: AccessTokenProvider | null = null;
let appCheckTokenProvider: AppCheckTokenProvider | null = null;

export function setAccessTokenProvider(provider: AccessTokenProvider | null): void {
  accessTokenProvider = provider;
}

export function setAppCheckTokenProvider(provider: AppCheckTokenProvider | null): void {
  appCheckTokenProvider = provider;
}

async function currentToken(fallback: string | null | undefined, forceRefresh: boolean) {
  if (!fallback) return fallback;
  if (!accessTokenProvider) return fallback;
  try {
    return (await accessTokenProvider(forceRefresh)) ?? fallback;
  } catch {
    return fallback;
  }
}

async function currentAppCheckToken(fallback?: string | null): Promise<string | null | undefined> {
  if (fallback !== undefined) return fallback;
  if (!appCheckTokenProvider) return undefined;
  try {
    return await appCheckTokenProvider();
  } catch {
    return undefined;
  }
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const token = await currentToken(options.accessToken, false);
  const appCheckToken = await currentAppCheckToken(options.appCheckToken);
  try {
    return await sendRequest<T>(path, { ...options, accessToken: token, appCheckToken });
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      options.accessToken &&
      accessTokenProvider
    ) {
      const refreshed = await currentToken(options.accessToken, true);
      if (refreshed && refreshed !== token) {
        return sendRequest<T>(path, { ...options, accessToken: refreshed, appCheckToken });
      }
    }
    throw error;
  }
}

async function sendRequest<T>(
  path: string,
  options: ApiRequestOptions,
): Promise<T> {
  const controller = new AbortController();

  const timeout = window.setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  const headers = new Headers(options.headers);

  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");
  if (!headers.has("x-correlation-id")) headers.set("x-correlation-id", createCorrelationId());

  if (options.accessToken) {
    headers.set("Authorization", `Bearer ${options.accessToken}`);
  }

  if (options.appCheckToken) {
    headers.set("X-Firebase-AppCheck", options.appCheckToken);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") ?? "";

    const body = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const message = errorMessageFromBody(body) ?? "The request could not be completed.";

      const bodyObj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      throw new ApiError(message, {
        status: response.status,
        ...(typeof bodyObj.errorKind === "string" ? { errorKind: bodyObj.errorKind } : {}),
        ...(typeof bodyObj.reason === "string" ? { reason: bodyObj.reason } : {}),
        requestId:
          response.headers.get("x-request-id") ??
          response.headers.get("x-correlation-id") ??
          undefined,
      });
    }

    return body as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("The request timed out.", { code: "timeout" });
    }

    throw new ApiError("Unable to communicate with the Control Plane API.", { code: "network" });
  } finally {
    window.clearTimeout(timeout);
  }
}