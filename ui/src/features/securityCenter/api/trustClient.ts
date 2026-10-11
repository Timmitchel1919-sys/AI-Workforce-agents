import { apiRequest } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import type {
  Alert, Approval, AuditFilters, CommandResult, LedgerResponse, Overview, PoliciesResponse, Policy, ProjectSecurity,
  SecretsResponse, SecurityCommandName, SimulationRequest, SimulationResponse, TrustResponse,
} from "../types";

/** Same-origin Control Plane API only. The browser never touches security state directly. */
const API = "/api";

export type TrustErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID" | "DEGRADED" | "NETWORK";

export class TrustClientError extends Error {
  readonly code: TrustErrorCode;
  readonly status?: number;
  readonly correlationId?: string;

  constructor(code: TrustErrorCode, message: string, options: { status?: number; correlationId?: string } = {}) {
    super(message);
    this.name = "TrustClientError";
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.correlationId) this.correlationId = options.correlationId;
  }
}

export function errorCode(error: unknown): TrustErrorCode {
  return error instanceof TrustClientError ? error.code : "NETWORK";
}

function codeFor(status: number | undefined, errorKind: string | undefined): TrustErrorCode {
  if (status === 401 || errorKind === "unauthorized") return "UNAUTHENTICATED";
  if (status === 403 || errorKind === "forbidden") return "FORBIDDEN";
  if (status === 404 || errorKind === "not_found") return "NOT_FOUND";
  if (status === 409 || errorKind === "invalid_state") return "CONFLICT";
  if (status === 400 || status === 422 || errorKind === "invalid_request") return "INVALID";
  if (status !== undefined && status >= 500) return "DEGRADED";
  if (status !== undefined && status >= 400) return "INVALID";
  return "NETWORK";
}

function fromApiError(error: unknown): TrustClientError {
  if (error instanceof TrustClientError) return error;
  if (error instanceof ApiError) {
    return new TrustClientError(codeFor(error.status, error.errorKind), error.reason ?? error.message, {
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.requestId ? { correlationId: error.requestId } : {}),
    });
  }
  return new TrustClientError("NETWORK", error instanceof Error ? error.message : "Control Plane unreachable");
}

async function request<T>(path: string, accessToken: string | null | undefined, init: RequestInit = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, { method: "GET", ...init, accessToken });
  } catch (error) {
    throw fromApiError(error);
  }
}

const enc = encodeURIComponent;

export function qs(params: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** A date input yields YYYY-MM-DD; the API takes an instant. `until` covers the whole day. */
export function toInstant(value: string, endOfDay = false): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : value;
}

export const LEDGER_LIMIT = 200;

export function ledgerParams(projectId: string | undefined, filters: AuditFilters): Record<string, string | number | undefined> {
  return {
    projectId,
    agentId: filters.agentId.trim(),
    taskId: filters.taskId.trim(),
    toolId: filters.toolId.trim(),
    action: filters.action,
    risk: filters.risk,
    policyId: filters.policyId.trim(),
    result: filters.result.trim(),
    operation: filters.operation.trim(),
    since: toInstant(filters.since),
    until: toInstant(filters.until, true),
    limit: LEDGER_LIMIT,
  };
}

export function getOverview(projectId: string | undefined, token?: string | null): Promise<Overview> {
  return request<Overview>(`${API}/trust/overview${qs({ projectId })}`, token);
}
export function getPolicies(token?: string | null): Promise<PoliciesResponse> {
  return request<PoliciesResponse>(`${API}/trust/policies`, token);
}
export function getPolicy(policyId: string, token?: string | null): Promise<Policy> {
  return request<Policy>(`${API}/trust/policies/${enc(policyId)}`, token);
}
export function getTrust(token?: string | null): Promise<TrustResponse> {
  return request<TrustResponse>(`${API}/trust/trust`, token);
}
export async function getApprovals(states: readonly string[], projectId: string | undefined, token?: string | null): Promise<Approval[]> {
  const body = await request<{ approvals: Approval[] }>(`${API}/trust/approvals${qs({ state: states.join(","), projectId })}`, token);
  return body.approvals ?? [];
}
export async function getAlerts(
  filters: { status: string; severity: string; open: boolean }, projectId: string | undefined, token?: string | null,
): Promise<Alert[]> {
  const body = await request<{ alerts: Alert[] }>(
    `${API}/trust/alerts${qs({ status: filters.status, severity: filters.severity, projectId, open: filters.open ? 1 : undefined })}`, token,
  );
  return body.alerts ?? [];
}
export function getAlert(alertId: string, token?: string | null): Promise<Alert> {
  return request<Alert>(`${API}/trust/alerts/${enc(alertId)}`, token);
}
export function getLedger(projectId: string | undefined, filters: AuditFilters, token?: string | null): Promise<LedgerResponse> {
  return request<LedgerResponse>(`${API}/trust/ledger${qs(ledgerParams(projectId, filters))}`, token);
}
export function simulate(req: SimulationRequest, token?: string | null): Promise<SimulationResponse> {
  return request<SimulationResponse>(
    `${API}/trust/simulate${qs({
      projectId: req.projectId, action: req.action, resource: req.resource.trim(), agentId: req.agentId, taskType: req.taskType.trim(),
      environment: req.environment, count: req.count.trim(), toolId: req.toolId,
    })}`,
    token,
  );
}
export function getSecrets(token?: string | null): Promise<SecretsResponse> {
  return request<SecretsResponse>(`${API}/trust/secrets`, token);
}
export function getProjectSecurity(projectId: string, token?: string | null): Promise<ProjectSecurity> {
  return request<ProjectSecurity>(`${API}/trust/project${qs({ projectId })}`, token);
}

/**
 * The only mutation path: a fixed allow-list of `security_*` commands. A denied or rejected result is thrown as an
 * error carrying the server's own `reason`, so the operator sees exactly why it was refused.
 */
export async function runSecurityCommand(
  command: SecurityCommandName, body: Record<string, unknown>, token?: string | null,
): Promise<CommandResult> {
  const result = await request<CommandResult>(`${API}/commands/${command}`, token, { method: "POST", body: JSON.stringify(body) });
  if (!result || result.ok === false) {
    const message = result?.reason && result.reason.length > 0 ? result.reason : "The command was not accepted.";
    const code = codeFor(undefined, result?.errorKind);
    throw new TrustClientError(code === "NETWORK" ? "DEGRADED" : code, message, {
      ...(result?.correlationId ? { correlationId: result.correlationId } : {}),
    });
  }
  return result;
}
