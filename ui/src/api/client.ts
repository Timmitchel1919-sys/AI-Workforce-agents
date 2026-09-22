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

export interface ApiRequestOptions extends RequestInit {
  accessToken?: string | null;
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
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
      const message =
        typeof body === "object" &&
        body !== null &&
        "message" in body &&
        typeof body.message === "string"
          ? body.message
          : "The request could not be completed.";

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