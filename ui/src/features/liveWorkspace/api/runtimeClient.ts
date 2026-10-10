import { apiRequest } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import type {
  EventsResponse, FileResponse, RuntimeCommand, RuntimeOverview, RuntimeSession, RuntimeSessionSummary, TreeResponse,
} from "../types";
import { SESSION_LIST_LIMIT } from "../types";

/** Same-origin Control Plane API only. The browser never touches the workspace or Firestore directly. */
const API = "/api";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export type RuntimeErrorCode =
  | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID" | "DEGRADED" | "NETWORK";

export class RuntimeClientError extends Error {
  readonly code: RuntimeErrorCode;
  readonly status?: number;
  readonly correlationId?: string;

  constructor(code: RuntimeErrorCode, message: string, options: { status?: number; correlationId?: string } = {}) {
    super(message);
    this.name = "RuntimeClientError";
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.correlationId) this.correlationId = options.correlationId;
  }
}

export function errorCode(error: unknown): RuntimeErrorCode {
  return error instanceof RuntimeClientError ? error.code : "NETWORK";
}

function codeFor(status: number | undefined, errorKind: string | undefined): RuntimeErrorCode {
  if (status === 401 || errorKind === "unauthorized") return "UNAUTHENTICATED";
  if (status === 403 || errorKind === "forbidden") return "FORBIDDEN";
  if (status === 404 || errorKind === "not_found") return "NOT_FOUND";
  if (status === 409 || errorKind === "invalid_state") return "CONFLICT";
  if (status === 400 || status === 422 || errorKind === "invalid_request") return "INVALID";
  if (status !== undefined && status >= 500) return "DEGRADED";
  if (status !== undefined && status >= 400) return "INVALID";
  return "NETWORK";
}

function fromApiError(error: unknown): RuntimeClientError {
  if (error instanceof RuntimeClientError) return error;
  if (error instanceof ApiError) {
    return new RuntimeClientError(codeFor(error.status, error.errorKind), error.reason ?? error.message, {
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.requestId ? { correlationId: error.requestId } : {}),
    });
  }
  return new RuntimeClientError("NETWORK", error instanceof Error ? error.message : "Control Plane unreachable");
}

async function request<T>(path: string, accessToken: string | null | undefined, init: RequestInit = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, { method: "GET", ...init, accessToken });
  } catch (error) {
    throw fromApiError(error);
  }
}

const enc = encodeURIComponent;

export function getOverview(accessToken?: string | null): Promise<RuntimeOverview> {
  return request<RuntimeOverview>(`${API}/runtime/overview`, accessToken);
}

export async function listSessions(accessToken?: string | null, filter: { projectId?: string; runId?: string } = {}): Promise<RuntimeSessionSummary[]> {
  const query = new URLSearchParams({ limit: String(SESSION_LIST_LIMIT) });
  if (filter.projectId) query.set("projectId", filter.projectId);
  if (filter.runId) query.set("runId", filter.runId);
  const body = await request<{ sessions: RuntimeSessionSummary[] }>(`${API}/runtime/sessions?${query.toString()}`, accessToken);
  return body.sessions ?? [];
}

export function getSession(executionId: string, accessToken?: string | null): Promise<RuntimeSession> {
  return request<RuntimeSession>(`${API}/runtime/sessions/${enc(executionId)}`, accessToken);
}

export async function getTree(executionId: string, dir: string, accessToken?: string | null): Promise<TreeResponse> {
  const query = dir ? `?dir=${enc(dir)}` : "";
  const body = await request<TreeResponse>(`${API}/runtime/sessions/${enc(executionId)}/tree${query}`, accessToken);
  return { entries: body.entries ?? [], truncated: Boolean(body.truncated) };
}

export function getFile(executionId: string, path: string, accessToken?: string | null): Promise<FileResponse> {
  return request<FileResponse>(`${API}/runtime/sessions/${enc(executionId)}/file?path=${enc(path)}`, accessToken);
}

/**
 * Long-poll for events after `after`. Uses fetch directly: the shared client aborts at 15 s, which is
 * shorter than the 20 s server wait, and it cannot be cancelled from outside. The caller's signal is honoured.
 */
export async function getEvents(
  executionId: string,
  after: number,
  waitMs: number,
  accessToken: string | null | undefined,
  signal?: AbortSignal,
): Promise<EventsResponse> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}${API}/runtime/sessions/${enc(executionId)}/events?after=${after}&wait=${waitMs}`,
      { method: "GET", headers, ...(signal ? { signal } : {}) },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new RuntimeClientError("NETWORK", error instanceof Error ? error.message : "Control Plane unreachable");
  }
  const body: unknown = await response.json().catch(() => null);
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (!response.ok) {
    const reason = typeof record.reason === "string" ? record.reason : typeof record.message === "string" ? record.message : `HTTP ${response.status}`;
    throw new RuntimeClientError(codeFor(response.status, typeof record.errorKind === "string" ? record.errorKind : undefined), reason, {
      status: response.status,
    });
  }
  if (!Array.isArray(record.events) || typeof record.status !== "string") {
    throw new RuntimeClientError("DEGRADED", "The Control Plane returned an unreadable event batch.");
  }
  return { events: record.events as EventsResponse["events"], status: record.status as EventsResponse["status"], done: Boolean(record.done) };
}

interface CommandResultBody { ok?: boolean; errorKind?: string; reason?: string; correlationId?: string }

/** The only mutation path: a fixed allow-list of three runtime commands. There is no way to send a shell command. */
export async function runRuntimeCommand(command: RuntimeCommand, executionId: string, accessToken?: string | null): Promise<void> {
  const result = await request<CommandResultBody>(`${API}/commands/${command}`, accessToken, {
    method: "POST",
    body: JSON.stringify({ executionId }),
  });
  if (!result || result.ok === false) {
    const message = result?.reason && result.reason.length > 0 ? result.reason : "The command was not accepted.";
    const code = codeFor(undefined, result?.errorKind);
    throw new RuntimeClientError(code === "NETWORK" ? "DEGRADED" : code, message, {
      ...(result?.correlationId ? { correlationId: result.correlationId } : {}),
    });
  }
}
