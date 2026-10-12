import { apiRequest } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import type {
  CommandResult, ContextPackage, ContextRole, Conflict, Finding, GraphResponse, KnowledgeCommandName, KnowledgeDocument,
  KnowledgeHealth, KnowledgeOverview, MemoryDetail, MemoryFilters, MemorySummary, SearchHit,
} from "../types";

/** Same-origin Control Plane API only. The browser never touches the knowledge store directly. */
const API = "/api";

export type KnowledgeErrorCode =
  | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID" | "DEGRADED" | "NETWORK";

export class KnowledgeClientError extends Error {
  readonly code: KnowledgeErrorCode;
  readonly status?: number;
  readonly correlationId?: string;

  constructor(code: KnowledgeErrorCode, message: string, options: { status?: number; correlationId?: string } = {}) {
    super(message);
    this.name = "KnowledgeClientError";
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.correlationId) this.correlationId = options.correlationId;
  }
}

export function errorCode(error: unknown): KnowledgeErrorCode {
  return error instanceof KnowledgeClientError ? error.code : "NETWORK";
}

function codeFor(status: number | undefined, errorKind: string | undefined): KnowledgeErrorCode {
  if (status === 401 || errorKind === "unauthorized") return "UNAUTHENTICATED";
  if (status === 403 || errorKind === "forbidden") return "FORBIDDEN";
  if (status === 404 || errorKind === "not_found") return "NOT_FOUND";
  if (status === 409 || errorKind === "invalid_state") return "CONFLICT";
  if (status === 400 || status === 422 || errorKind === "invalid_request") return "INVALID";
  if (status !== undefined && status >= 500) return "DEGRADED";
  if (status !== undefined && status >= 400) return "INVALID";
  return "NETWORK";
}

function fromApiError(error: unknown): KnowledgeClientError {
  if (error instanceof KnowledgeClientError) return error;
  if (error instanceof ApiError) {
    return new KnowledgeClientError(codeFor(error.status, error.errorKind), error.reason ?? error.message, {
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.requestId ? { correlationId: error.requestId } : {}),
    });
  }
  return new KnowledgeClientError("NETWORK", error instanceof Error ? error.message : "Control Plane unreachable");
}

async function request<T>(path: string, accessToken: string | null | undefined, init: RequestInit = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, { method: "GET", ...init, accessToken });
  } catch (error) {
    throw fromApiError(error);
  }
}

const enc = encodeURIComponent;

function qs(params: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

export const MEMORY_LIMIT = 100;

/** The query parameters shared by list and search, built from the filter state (empty values are omitted). */
export function filterParams(projectId: string | undefined, filters: MemoryFilters): Record<string, string | undefined> {
  return {
    projectId,
    type: filters.type,
    status: filters.status,
    source: filters.source,
    confidence: filters.confidence,
    importance: filters.importance,
    // A date input yields YYYY-MM-DD; the API takes an instant, so send the start of that day (UTC).
    since: /^\d{4}-\d{2}-\d{2}$/.test(filters.since) ? `${filters.since}T00:00:00.000Z` : filters.since,
  };
}

export function getOverview(projectId: string | undefined, accessToken?: string | null): Promise<KnowledgeOverview> {
  return request<KnowledgeOverview>(`${API}/knowledge/overview${qs({ projectId })}`, accessToken);
}

export function getHealth(projectId: string | undefined, accessToken?: string | null): Promise<KnowledgeHealth> {
  return request<KnowledgeHealth>(`${API}/knowledge/health${qs({ projectId })}`, accessToken);
}

export async function getFindings(projectId: string | undefined, accessToken?: string | null): Promise<Finding[]> {
  const body = await request<{ findings: Finding[] }>(`${API}/knowledge/findings${qs({ projectId })}`, accessToken);
  return body.findings ?? [];
}

/** Empty query → plain listing (`/knowledge/memories`); non-empty → ranked search (`/knowledge/search`). */
export async function listMemories(
  projectId: string | undefined,
  filters: MemoryFilters,
  accessToken?: string | null,
): Promise<{ memories: MemorySummary[]; total: number }> {
  const body = await request<{ memories: MemorySummary[]; total: number }>(
    `${API}/knowledge/memories${qs({ ...filterParams(projectId, filters), limit: MEMORY_LIMIT })}`,
    accessToken,
  );
  return { memories: body.memories ?? [], total: body.total ?? body.memories?.length ?? 0 };
}

export async function searchMemories(
  projectId: string | undefined,
  filters: MemoryFilters,
  accessToken?: string | null,
): Promise<SearchHit[]> {
  const body = await request<{ hits: SearchHit[] }>(
    `${API}/knowledge/search${qs({ q: filters.q.trim(), ...filterParams(projectId, filters), limit: MEMORY_LIMIT })}`,
    accessToken,
  );
  return body.hits ?? [];
}

export function getMemory(memoryId: string, accessToken?: string | null): Promise<MemoryDetail> {
  return request<MemoryDetail>(`${API}/knowledge/memories/${enc(memoryId)}`, accessToken);
}

export function getGraph(projectId: string, types: readonly string[], accessToken?: string | null): Promise<GraphResponse> {
  return request<GraphResponse>(
    `${API}/knowledge/graph${qs({ projectId, types: types.length > 0 ? types.join(",") : undefined, memories: 1 })}`,
    accessToken,
  );
}

export async function getConflicts(projectId: string | undefined, accessToken?: string | null): Promise<Conflict[]> {
  const body = await request<{ conflicts: Conflict[] }>(`${API}/knowledge/conflicts${qs({ projectId })}`, accessToken);
  return body.conflicts ?? [];
}

export async function getDocuments(projectId: string | undefined, accessToken?: string | null): Promise<KnowledgeDocument[]> {
  const body = await request<{ documents: KnowledgeDocument[] }>(`${API}/knowledge/documents${qs({ projectId })}`, accessToken);
  return body.documents ?? [];
}

export async function getDecisions(projectId: string | undefined, accessToken?: string | null): Promise<MemorySummary[]> {
  const body = await request<{ decisions: MemorySummary[] }>(`${API}/knowledge/decisions${qs({ projectId })}`, accessToken);
  return body.decisions ?? [];
}

export async function getCandidates(projectId: string | undefined, accessToken?: string | null): Promise<MemorySummary[]> {
  const body = await request<{ candidates: MemorySummary[] }>(`${API}/knowledge/candidates${qs({ projectId })}`, accessToken);
  return body.candidates ?? [];
}

export function getContext(projectId: string, q: string, role: ContextRole, accessToken?: string | null): Promise<ContextPackage> {
  return request<ContextPackage>(`${API}/knowledge/context${qs({ projectId, q, role })}`, accessToken);
}

/**
 * The only mutation path: a fixed allow-list of `knowledge_*` commands. A denied or rejected result is thrown as an
 * error carrying the server's own `reason`, so the operator sees exactly why it was refused.
 */
export async function runKnowledgeCommand(
  command: KnowledgeCommandName,
  body: Record<string, unknown>,
  accessToken?: string | null,
): Promise<CommandResult> {
  const result = await request<CommandResult>(`${API}/commands/${command}`, accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!result || result.ok === false) {
    const message = result?.reason && result.reason.length > 0 ? result.reason : "The command was not accepted.";
    const code = codeFor(undefined, result?.errorKind);
    throw new KnowledgeClientError(code === "NETWORK" ? "DEGRADED" : code, message, {
      ...(result?.correlationId ? { correlationId: result.correlationId } : {}),
    });
  }
  return result;
}
