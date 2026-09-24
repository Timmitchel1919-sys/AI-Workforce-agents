import { apiRequest } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import type {
  ExecutionPlanSummary,
  ExecutionPlanView,
  PageResult,
  PlanClientErrorCode,
  PlanningRequestInput,
  ProjectDetail,
  ProjectSummary,
  TechnologyEntry,
} from "./executionPlanTypes";

/**
 * Same-origin Control Plane API only; `apiRequest` forwards the Firebase ID
 * token. Every read is project-scoped server-side; every write is a Control
 * Plane command that the backend authorizes, validates and audits.
 */
const API = "/api";
export const HISTORY_PAGE_SIZE = 10;

export class PlanClientError extends Error {
  readonly code: PlanClientErrorCode;

  constructor(code: PlanClientErrorCode, message: string) {
    super(message);
    this.name = "PlanClientError";
    this.code = code;
  }
}

function toClientError(error: unknown): PlanClientError {
  if (error instanceof ApiError) {
    const code: PlanClientErrorCode =
      error.status === 401
        ? "UNAUTHENTICATED"
        : error.status === 403
          ? "FORBIDDEN"
          : error.status === 404
            ? "NOT_FOUND"
            : error.status === 409
              ? "CONFLICT"
              : error.status === 400
                ? "INVALID"
                : error.status !== undefined && error.status >= 500
                  ? "DEGRADED"
                  : "NETWORK";
    return new PlanClientError(code, error.message);
  }
  return new PlanClientError("NETWORK", error instanceof Error ? error.message : "Control Plane unreachable");
}

async function request<T>(path: string, accessToken: string | null | undefined, init: RequestInit = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, { method: "GET", ...init, accessToken });
  } catch (error) {
    throw toClientError(error);
  }
}

const plansPath = (projectId: string) => `${API}/projects/${encodeURIComponent(projectId)}/execution-plans`;

export function getProjects(accessToken?: string | null): Promise<ProjectSummary[]> {
  return request<ProjectSummary[]>(`${API}/projects`, accessToken);
}

export function getProject(projectId: string, accessToken?: string | null): Promise<ProjectDetail> {
  return request<ProjectDetail>(`${API}/projects/${encodeURIComponent(projectId)}`, accessToken);
}

/** The project's current plan (newest series, highest version) or null. */
export async function getCurrentPlan(projectId: string, accessToken?: string | null): Promise<ExecutionPlanView | null> {
  const body = await request<{ plan: ExecutionPlanView | null }>(`${plansPath(projectId)}/current`, accessToken);
  return body.plan;
}

/** One specific revision of a plan series. */
export function getPlanVersion(
  projectId: string,
  planId: string,
  version: number,
  accessToken?: string | null,
): Promise<ExecutionPlanView> {
  return request<ExecutionPlanView>(
    `${plansPath(projectId)}/${encodeURIComponent(planId)}?version=${version}`,
    accessToken,
  );
}

/** One page of a series' revisions, newest first (server-filtered). */
export function getPlanHistory(
  projectId: string,
  planId: string,
  cursor: string | undefined,
  accessToken?: string | null,
): Promise<PageResult<ExecutionPlanSummary>> {
  const params = new URLSearchParams({ planId, limit: String(HISTORY_PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);
  return request<PageResult<ExecutionPlanSummary>>(`${plansPath(projectId)}?${params}`, accessToken);
}

export function getTechnologyCatalog(accessToken?: string | null): Promise<TechnologyEntry[]> {
  return request<TechnologyEntry[]>(`${API}/planning/technologies`, accessToken);
}

/** Display names for agent ids (real registry data only). */
export async function getAgentNames(accessToken?: string | null): Promise<Record<string, string>> {
  const agents = await request<readonly { agentId: string; name: string }[]>(`${API}/agents`, accessToken);
  return Object.fromEntries(agents.map((a) => [a.agentId, a.name]));
}

/* ------------------------------------------------------------------ */
/* Commands — planning and governance only; nothing executes a plan    */
/* ------------------------------------------------------------------ */

export type PlanCommand =
  | { kind: "create"; request: PlanningRequestInput }
  | { kind: "replan"; planId: string; expectedVersion: number }
  | { kind: "submit"; planId: string; expectedVersion: number }
  | { kind: "approve"; approvalId: string }
  | { kind: "reject"; approvalId: string; reason: string };

const COMMAND_PATH: Record<PlanCommand["kind"], string> = {
  create: "create-execution-plan",
  replan: "replan-execution-plan",
  submit: "submit-execution-plan",
  approve: "approve",
  reject: "reject",
};

export function runPlanCommand(command: PlanCommand, accessToken?: string | null): Promise<unknown> {
  const body =
    command.kind === "create"
      ? command.request
      : command.kind === "replan" || command.kind === "submit"
        ? { planId: command.planId, expectedVersion: command.expectedVersion }
        : command.kind === "approve"
          ? { approvalId: command.approvalId }
          : { approvalId: command.approvalId, reason: command.reason };
  return request(`${API}/commands/${COMMAND_PATH[command.kind]}`, accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
