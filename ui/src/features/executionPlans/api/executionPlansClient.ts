import { apiRequest } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import type {
  ExecutionPlanSummary,
  ExecutionPlanView,
  PageResult,
  PlanClientErrorCode,
  ProjectSummary,
} from "./executionPlanTypes";

/** Same-origin Control Plane API; Firebase ID token forwarded by apiRequest. */
const API = "/api";
const HISTORY_LIMIT = 25;

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
    if (error.status === 401) return new PlanClientError("UNAUTHENTICATED", error.message);
    if (error.status === 403) return new PlanClientError("FORBIDDEN", error.message);
    if (error.status === 404) return new PlanClientError("NOT_FOUND", error.message);
    if (error.status !== undefined && error.status >= 500) {
      return new PlanClientError("DEGRADED", error.message);
    }
  }
  return new PlanClientError(
    "NETWORK",
    error instanceof Error ? error.message : "Control Plane unreachable",
  );
}

export async function getProjects(accessToken?: string | null): Promise<ProjectSummary[]> {
  try {
    return await apiRequest<ProjectSummary[]>(`${API}/projects`, {
      method: "GET",
      accessToken,
    });
  } catch (error) {
    throw toClientError(error);
  }
}

export interface ProjectExecutionPlan {
  /** Current version of the newest plan series, or null when none exists. */
  plan: ExecutionPlanView | null;
  history: readonly ExecutionPlanSummary[];
}

export async function getProjectExecutionPlan(
  projectId: string,
  accessToken?: string | null,
): Promise<ProjectExecutionPlan> {
  const base = `${API}/projects/${encodeURIComponent(projectId)}/execution-plans`;
  try {
    const page = await apiRequest<PageResult<ExecutionPlanSummary>>(
      `${base}?limit=${HISTORY_LIMIT}`,
      { method: "GET", accessToken },
    );
    const latest = page.items.find((item) => item.current);
    if (!latest) return { plan: null, history: page.items };
    const plan = await apiRequest<ExecutionPlanView>(
      `${base}/${encodeURIComponent(latest.planId)}`,
      { method: "GET", accessToken },
    );
    return { plan, history: page.items };
  } catch (error) {
    throw toClientError(error);
  }
}
