import { apiRequest } from "../../../api/client";
import { ApiError } from "../../../api/errors";

/** Same-origin Control Plane API only. The browser never talks to a provider. */
export const API = "/api";

export type ClientErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID" | "DEGRADED" | "NETWORK";

export class ApiClientError extends Error {
  readonly code: ClientErrorCode;
  readonly status?: number;
  readonly correlationId?: string;

  constructor(code: ClientErrorCode, message: string, options: { status?: number; correlationId?: string } = {}) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.correlationId) this.correlationId = options.correlationId;
  }
}

export function errorCode(error: unknown): ClientErrorCode {
  return error instanceof ApiClientError ? error.code : "NETWORK";
}

function codeFor(status: number | undefined, errorKind: string | undefined): ClientErrorCode {
  if (status === 401 || errorKind === "unauthorized") return "UNAUTHENTICATED";
  if (status === 403 || errorKind === "forbidden") return "FORBIDDEN";
  if (status === 404 || errorKind === "not_found") return "NOT_FOUND";
  if (status === 409 || errorKind === "invalid_state") return "CONFLICT";
  if (status === 400 || status === 422 || errorKind === "invalid_request") return "INVALID";
  if (status !== undefined && status >= 500) return "DEGRADED";
  if (status !== undefined && status >= 400) return "INVALID";
  return "NETWORK";
}

function fromApiError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  if (error instanceof ApiError) {
    return new ApiClientError(codeFor(error.status, error.errorKind), error.reason ?? error.message, {
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.requestId ? { correlationId: error.requestId } : {}),
    });
  }
  return new ApiClientError("NETWORK", error instanceof Error ? error.message : "Control Plane unreachable");
}

export async function request<T>(path: string, accessToken: string | null | undefined, init: RequestInit = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, { method: "GET", ...init, accessToken });
  } catch (error) {
    throw fromApiError(error);
  }
}

export const enc = encodeURIComponent;

/** Query strings only ever carry filters and ids, never a credential or personal data. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

export interface CommandResult {
  command: string;
  outcome: "executed" | "denied" | "rejected";
  ok: boolean;
  errorKind?: "forbidden" | "not_found" | "invalid_state" | "invalid_request" | "command_failure";
  reason: string;
  resourceId?: string;
  correlationId: string;
  details: Record<string, unknown>;
  auditEventId: string;
  timestamp: string;
}

/**
 * The only mutation path. A denied or rejected result is thrown as an error carrying the server's own `reason`, so the
 * refusal text is always what the Control Plane said.
 */
export async function postCommand(command: string, body: Record<string, unknown>, token?: string | null): Promise<CommandResult> {
  const result = await request<CommandResult>(`${API}/commands/${command}`, token, { method: "POST", body: JSON.stringify(body) });
  if (!result || result.ok === false) {
    const message = result?.reason && result.reason.length > 0 ? result.reason : "The command was not accepted.";
    const code = codeFor(undefined, result?.errorKind);
    throw new ApiClientError(code === "NETWORK" ? "DEGRADED" : code, message, {
      ...(result?.correlationId ? { correlationId: result.correlationId } : {}),
    });
  }
  return result;
}
