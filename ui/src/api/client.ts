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
}

/**
 * Returns the signed-in user's CURRENT Firebase ID token (refreshed by the
 * SDK when it has expired), or a force-refreshed one. Registered by the
 * AuthProvider; absent when nobody is signed in or Firebase is not set up.
 */
export type AccessTokenProvider = (forceRefresh: boolean) => Promise<string | null>;

let accessTokenProvider: AccessTokenProvider | null = null;

export function setAccessTokenProvider(provider: AccessTokenProvider | null): void {
  accessTokenProvider = provider;
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

/**
 * Authenticated requests never reuse a stale ID token: the token is read
 * from Firebase at request time (ID tokens expire after an hour, and a
 * sleeping machine or idle tab never refreshes a captured copy). A 401 is
 * retried once with a force-refreshed token before it is surfaced.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const token = await currentToken(options.accessToken, false);
  try {
    return await sendRequest<T>(path, { ...options, accessToken: token });
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      options.accessToken &&
      accessTokenProvider
    ) {
      const refreshed = await currentToken(options.accessToken, true);
      if (refreshed && refreshed !== token) {
        return sendRequest<T>(path, { ...options, accessToken: refreshed });
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
  headers.set("x-correlation-id", createCorrelationId());

  if (options.accessToken) {
    headers.set("Authorization", `Bearer ${options.accessToken}`);
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

      throw new ApiError(message, {
        status: response.status,
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
      throw new ApiError("The request timed out.");
    }

    throw new ApiError("Unable to communicate with the Control Plane API.");
  } finally {
    window.clearTimeout(timeout);
  }
}