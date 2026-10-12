import { apiRequest } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import type { OrchestrationCommand, PreparedRequestSummary, RunSummary, RunView } from "../types";
import { RUN_LIST_LIMIT } from "../types";

/** Same-origin Control Plane API only. The browser never writes run state directly. */
const API = "/api";

export type OrchErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID"
  | "DEGRADED"
  | "NETWORK";

export class OrchClientError extends Error {
  readonly code: OrchErrorCode;
  readonly correlationId?: string;

  constructor(code: OrchErrorCode, message: string, correlationId?: string) {
    super(message);
    this.name = "OrchClientError";
    this.code = code;
    if (correlationId) this.correlationId = correlationId;
  }
}

interface CommandResultBody {
  ok?: boolean;
  errorKind?: string;
  reason?: string;
  correlationId?: string;
  details?: Record<string, unknown>;
}

function fromResult(body: CommandResultBody): OrchClientError {
  const message = body.reason && body.reason.length > 0 ? body.reason : "The command was not accepted.";
  let code: OrchErrorCode;
  switch (body.errorKind) {
    case "forbidden": code = "FORBIDDEN"; break;
    case "unauthorized": code = "UNAUTHENTICATED"; break;
    case "not_found": code = "NOT_FOUND"; break;
    case "invalid_request": code = "INVALID"; break;
    case "invalid_state": code = "CONFLICT"; break;
    default: code = "DEGRADED";
  }
  return new OrchClientError(code, message, body.correlationId);
}

function fromApiError(error: unknown): OrchClientError {
  if (error instanceof OrchClientError) return error;
  if (error instanceof ApiError) {
    let code: OrchErrorCode;
    if (error.status === 401 || error.errorKind === "unauthorized") code = "UNAUTHENTICATED";
    else if (error.status === 403 || error.errorKind === "forbidden") code = "FORBIDDEN";
    else if (error.status === 404 || error.errorKind === "not_found") code = "NOT_FOUND";
    else if (error.status === 409 || error.errorKind === "invalid_state") code = "CONFLICT";
    else if (error.status === 400 || error.status === 422 || error.errorKind === "invalid_request") code = "INVALID";
    else if (error.status !== undefined && error.status >= 500) code = "DEGRADED";
    else code = "NETWORK";
    return new OrchClientError(code, error.reason ?? error.message, error.requestId);
  }
  return new OrchClientError("NETWORK", error instanceof Error ? error.message : "Control Plane unreachable");
}

async function request<T>(path: string, accessToken: string | null | undefined, init: RequestInit = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, { method: "GET", ...init, accessToken });
  } catch (error) {
    throw fromApiError(error);
  }
}

export async function listRuns(accessToken?: string | null, projectId?: string): Promise<RunSummary[]> {
  const query = new URLSearchParams({ limit: String(RUN_LIST_LIMIT) });
  if (projectId) query.set("projectId", projectId);
  const body = await request<{ runs: RunSummary[] }>(`${API}/execution-runs?${query.toString()}`, accessToken);
  return body.runs ?? [];
}

export function getRun(runId: string, accessToken?: string | null): Promise<RunView> {
  return request<RunView>(`${API}/execution-runs/${encodeURIComponent(runId)}`, accessToken);
}

export async function listPreparedRequests(accessToken?: string | null): Promise<PreparedRequestSummary[]> {
  const body = await request<{ requests: PreparedRequestSummary[] }>(`${API}/prompt-intelligence?limit=25`, accessToken);
  return body.requests ?? [];
}

/** The only mutation path: a fixed allow-list of orchestration commands. No arbitrary command is ever sent. */
export async function runCommand(
  command: OrchestrationCommand,
  body: Record<string, string>,
  accessToken?: string | null,
): Promise<RunView> {
  const result = await request<CommandResultBody>(`${API}/commands/${command}`, accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!result || result.ok === false) throw fromResult(result ?? {});
  const view = result.details?.view as RunView | undefined;
  if (!view || typeof view !== "object" || !view.run || !view.progress) {
    throw new OrchClientError("DEGRADED", "The Control Plane accepted the command but returned no run.", result.correlationId);
  }
  return view;
}
