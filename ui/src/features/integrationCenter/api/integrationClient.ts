import { apiRequest } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import type {
  ActivityFilters, ActivityRecord, AuditEntry, CapabilitiesResponse, CommandResult, ConnectorDetail, EventFilters, EventsResponse,
  HealthResponse, IntegrationCommandName, McpServer, Overview,
} from "../types";

/** Same-origin Control Plane API only. The browser never talks to a provider. */
const API = "/api";

export type IntegrationErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID" | "DEGRADED" | "NETWORK";

export class IntegrationClientError extends Error {
  readonly code: IntegrationErrorCode;
  readonly status?: number;
  readonly correlationId?: string;

  constructor(code: IntegrationErrorCode, message: string, options: { status?: number; correlationId?: string } = {}) {
    super(message);
    this.name = "IntegrationClientError";
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.correlationId) this.correlationId = options.correlationId;
  }
}

export function errorCode(error: unknown): IntegrationErrorCode {
  return error instanceof IntegrationClientError ? error.code : "NETWORK";
}

function codeFor(status: number | undefined, errorKind: string | undefined): IntegrationErrorCode {
  if (status === 401 || errorKind === "unauthorized") return "UNAUTHENTICATED";
  if (status === 403 || errorKind === "forbidden") return "FORBIDDEN";
  if (status === 404 || errorKind === "not_found") return "NOT_FOUND";
  if (status === 409 || errorKind === "invalid_state") return "CONFLICT";
  if (status === 400 || status === 422 || errorKind === "invalid_request") return "INVALID";
  if (status !== undefined && status >= 500) return "DEGRADED";
  if (status !== undefined && status >= 400) return "INVALID";
  return "NETWORK";
}

function fromApiError(error: unknown): IntegrationClientError {
  if (error instanceof IntegrationClientError) return error;
  if (error instanceof ApiError) {
    return new IntegrationClientError(codeFor(error.status, error.errorKind), error.reason ?? error.message, {
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.requestId ? { correlationId: error.requestId } : {}),
    });
  }
  return new IntegrationClientError("NETWORK", error instanceof Error ? error.message : "Control Plane unreachable");
}

async function request<T>(path: string, accessToken: string | null | undefined, init: RequestInit = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, { method: "GET", ...init, accessToken });
  } catch (error) {
    throw fromApiError(error);
  }
}

const enc = encodeURIComponent;

/** Query strings only ever carry filters and ids, never a credential or personal data. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** A date input yields YYYY-MM-DD; the API takes an instant. */
export function toInstant(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
}

const BASE = `${API}/integration-center`;

export function getOverview(projectId: string | undefined, token?: string | null): Promise<Overview> {
  return request<Overview>(`${BASE}/overview${qs({ projectId })}`, token);
}
export function getConnector(connectorId: string, token?: string | null): Promise<ConnectorDetail> {
  return request<ConnectorDetail>(`${BASE}/connectors/${enc(connectorId)}`, token);
}
export function getCapabilities(q: string, projectId: string | undefined, token?: string | null): Promise<CapabilitiesResponse> {
  return request<CapabilitiesResponse>(`${BASE}/capabilities${qs({ q: q.trim(), projectId })}`, token);
}
export function getEvents(filters: EventFilters, projectId: string | undefined, token?: string | null): Promise<EventsResponse> {
  return request<EventsResponse>(
    `${BASE}/events${qs({ provider: filters.provider.trim(), type: filters.type.trim(), status: filters.status, since: toInstant(filters.since), projectId })}`,
    token,
  );
}
export async function getActivity(filters: ActivityFilters, projectId: string | undefined, token?: string | null): Promise<ActivityRecord[]> {
  const body = await request<{ activity: ActivityRecord[] }>(
    `${BASE}/activity${qs({ projectId, connectorId: filters.connectorId, outcome: filters.outcome, limit: 100 })}`, token,
  );
  return body.activity ?? [];
}
export function getHealth(token?: string | null): Promise<HealthResponse> {
  return request<HealthResponse>(`${BASE}/health`, token);
}
export async function getMcp(token?: string | null): Promise<McpServer[]> {
  const body = await request<{ servers: McpServer[] }>(`${BASE}/mcp`, token);
  return body.servers ?? [];
}
export async function getAudit(projectId: string | undefined, token?: string | null): Promise<AuditEntry[]> {
  const body = await request<{ entries: AuditEntry[] }>(`${BASE}/audit${qs({ projectId, limit: 100 })}`, token);
  return body.entries ?? [];
}

/**
 * The only mutation path: a fixed allow-list of `integration_*` commands. A denied or rejected result is thrown as an
 * error carrying the server's own `reason`. A credential value is only ever passed in the single store command body.
 */
export async function runIntegrationCommand(
  command: IntegrationCommandName, body: Record<string, unknown>, token?: string | null,
): Promise<CommandResult> {
  const result = await request<CommandResult>(`${API}/commands/${command}`, token, { method: "POST", body: JSON.stringify(body) });
  if (!result || result.ok === false) {
    const message = result?.reason && result.reason.length > 0 ? result.reason : "The command was not accepted.";
    const code = codeFor(undefined, result?.errorKind);
    throw new IntegrationClientError(code === "NETWORK" ? "DEGRADED" : code, message, {
      ...(result?.correlationId ? { correlationId: result.correlationId } : {}),
    });
  }
  return result;
}
