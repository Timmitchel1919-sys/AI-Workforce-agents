import { apiRequest } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import type { PromptRequestSummary, PromptRequestView } from "../types";

/** Same-origin Control Plane API only. The browser never writes prompt state directly. */
const API = "/api";

export type PromptErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID"
  | "DEGRADED"
  | "NETWORK";

export class PromptClientError extends Error {
  readonly code: PromptErrorCode;
  readonly correlationId?: string;

  constructor(code: PromptErrorCode, message: string, correlationId?: string) {
    super(message);
    this.name = "PromptClientError";
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

function fromResult(body: CommandResultBody): PromptClientError {
  const message = body.reason && body.reason.length > 0 ? body.reason : "The command was not accepted.";
  let code: PromptErrorCode;
  switch (body.errorKind) {
    case "forbidden": code = "FORBIDDEN"; break;
    case "unauthorized": code = "UNAUTHENTICATED"; break;
    case "not_found": code = "NOT_FOUND"; break;
    case "invalid_request": code = "INVALID"; break;
    case "invalid_state": code = "CONFLICT"; break;
    default: code = "DEGRADED";
  }
  return new PromptClientError(code, message, body.correlationId);
}

function fromApiError(error: unknown): PromptClientError {
  if (error instanceof PromptClientError) return error;
  if (error instanceof ApiError) {
    let code: PromptErrorCode;
    if (error.status === 401 || error.errorKind === "unauthorized") code = "UNAUTHENTICATED";
    else if (error.status === 403 || error.errorKind === "forbidden") code = "FORBIDDEN";
    else if (error.status === 404 || error.errorKind === "not_found") code = "NOT_FOUND";
    else if (error.status === 409 || error.errorKind === "invalid_state") code = "CONFLICT";
    else if (error.status === 400 || error.status === 422 || error.errorKind === "invalid_request") code = "INVALID";
    else if (error.status !== undefined && error.status >= 500) code = "DEGRADED";
    else code = "NETWORK";
    return new PromptClientError(code, error.reason ?? error.message, error.requestId);
  }
  return new PromptClientError("NETWORK", error instanceof Error ? error.message : "Control Plane unreachable");
}

async function request<T>(path: string, accessToken: string | null | undefined, init: RequestInit = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, { method: "GET", ...init, accessToken });
  } catch (error) {
    throw fromApiError(error);
  }
}

export async function listPromptRequests(accessToken?: string | null, projectId?: string): Promise<PromptRequestSummary[]> {
  const query = new URLSearchParams({ limit: "25" });
  if (projectId) query.set("projectId", projectId);
  const body = await request<{ requests: PromptRequestSummary[] }>(`${API}/prompt-intelligence?${query.toString()}`, accessToken);
  return body.requests ?? [];
}

export function getPromptRequest(requestId: string, accessToken?: string | null): Promise<PromptRequestView> {
  return request<PromptRequestView>(`${API}/prompt-intelligence/${encodeURIComponent(requestId)}`, accessToken);
}

export interface PrepareInput { request: string; projectId?: string; taskId?: string }

async function runCommand(command: string, body: Record<string, unknown>, accessToken?: string | null): Promise<PromptRequestView> {
  const result = await request<CommandResultBody>(`${API}/commands/${command}`, accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!result || result.ok === false) throw fromResult(result ?? {});
  const view = result.details?.view as PromptRequestView | undefined;
  if (!view || typeof view !== "object" || !view.record || !view.execution) {
    throw new PromptClientError("DEGRADED", "The Control Plane accepted the command but returned no prepared request.", result.correlationId);
  }
  return view;
}

/** `prompt_prepare`: analysis, context, prompt and validation all happen on the server. */
export function prepareRequest(input: PrepareInput, accessToken?: string | null): Promise<PromptRequestView> {
  return runCommand("prompt_prepare", {
    request: input.request,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
  }, accessToken);
}

/** `prompt_request_approval`: files the human approval; nothing is executed. */
export function requestApproval(requestId: string, accessToken?: string | null): Promise<PromptRequestView> {
  return runCommand("prompt_request_approval", { requestId }, accessToken);
}
