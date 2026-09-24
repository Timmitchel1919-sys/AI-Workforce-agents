/**
 * EO-4.1 execution readiness (pre-flight only). Same-origin Control Plane;
 * the request carries references (project, plan revision, stage) — never a
 * command. The backend authorizes, re-validates every gate and audits. There
 * is no execute call in the UI.
 */
import { apiRequest } from "../../api/client";
import { ApiError } from "../../api/errors";

export type PreflightCode =
  | "POLICY_DENIED"
  | "AUTHORIZATION_DENIED"
  | "APPROVAL_REQUIRED"
  | "STALE_PLAN"
  | "PLAN_NOT_EXECUTABLE"
  | "AGENT_NOT_QUALIFIED"
  | "ENVIRONMENT_UNAVAILABLE"
  | "WORKSPACE_VIOLATION"
  | "TOOL_NOT_ALLOWED"
  | "INVALID_TOOL_INPUT"
  | "SANDBOX_UNAVAILABLE"
  | "RESOURCE_LIMIT"
  | "TIMEOUT"
  | "CANCELLED"
  | "SANDBOX_FAILURE"
  | "INTERNAL_ERROR";

/** contracts/execution.ts `PreflightResult` (fields the UI shows). */
export interface PreflightResult {
  decision: "ELIGIBLE" | "DENIED";
  reasons: readonly { code: PreflightCode; detail: string }[];
  stageId: string;
  policy?: { policyId: string; version: number };
  requiredApprovals: readonly { reason: string; approvalId?: string; state: string }[];
  executionAvailable: false;
}

export interface PreflightRequest {
  projectId: string;
  planId: string;
  planVersion: number;
  stageId: string;
}

export type PreflightFailure = "unauthenticated" | "forbidden" | "not_found" | "invalid" | "unavailable";

export class PreflightError extends Error {
  readonly failure: PreflightFailure;
  constructor(failure: PreflightFailure, message: string) {
    super(message);
    this.name = "PreflightError";
    this.failure = failure;
  }
}

export async function runPreflight(request: PreflightRequest, accessToken?: string | null): Promise<PreflightResult> {
  try {
    return await apiRequest<PreflightResult>("/api/execution/preflight", {
      method: "POST",
      body: JSON.stringify(request),
      accessToken,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const failure: PreflightFailure =
        error.status === 401
          ? "unauthenticated"
          : error.status === 403
            ? "forbidden"
            : error.status === 404
              ? "not_found"
              : error.status === 400
                ? "invalid"
                : "unavailable";
      throw new PreflightError(failure, error.message);
    }
    throw new PreflightError("unavailable", "Control Plane unreachable");
  }
}
