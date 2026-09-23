import { apiRequest } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import type { WorkflowView, WorkflowsClientErrorCode, WorkflowsPage } from "./workflowsTypes";
import {
  getDevelopmentWorkflowFallback,
  getDevelopmentWorkflowsFallback,
} from "./workflowsDevelopmentData";

const WORKFLOWS_PATH = import.meta.env.VITE_WORKFLOWS_PATH || "/api/workflows";

/** Backend `MAX_PAGE_SIZE` (control/derive.ts). */
const LIST_LIMIT = 200;

export class WorkflowsClientError extends Error {
  readonly code: WorkflowsClientErrorCode;
  readonly retryable: boolean;

  constructor(code: WorkflowsClientErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "WorkflowsClientError";
    this.code = code;
    this.retryable = retryable;
  }
}

function toClientError(error: unknown, notFoundMessage: string): WorkflowsClientError | null {
  if (!(error instanceof ApiError)) {
    return null;
  }
  if (error.status === 401 || error.status === 403) {
    return new WorkflowsClientError(
      "UNAUTHORIZED",
      "You do not have permission to view workflow data.",
      false,
    );
  }
  if (error.status === 404) {
    return new WorkflowsClientError("NOT_FOUND", notFoundMessage, false);
  }
  if (error.status === 500 || error.status === 502 || error.status === 503) {
    return new WorkflowsClientError(
      "DEGRADED",
      "Workflow service is temporarily unavailable or degraded.",
      true,
    );
  }
  return null;
}

export async function getWorkflows(accessToken?: string | null): Promise<WorkflowsPage> {
  if (import.meta.env.DEV && !import.meta.env.VITE_WORKFLOWS_PATH) {
    return getDevelopmentWorkflowsFallback();
  }

  try {
    return await apiRequest<WorkflowsPage>(`${WORKFLOWS_PATH}?limit=${LIST_LIMIT}`, {
      method: "GET",
      accessToken,
    });
  } catch (error) {
    const clientError = toClientError(error, "The workflow registry was not found.");
    if (clientError && clientError.code !== "NOT_FOUND") {
      throw clientError;
    }
    if (import.meta.env.DEV) {
      return getDevelopmentWorkflowsFallback();
    }
    throw (
      clientError ??
      new WorkflowsClientError(
        "NETWORK",
        "Unable to communicate with the Control Plane workflow service.",
        true,
      )
    );
  }
}

export async function getWorkflow(
  workflowId: string,
  accessToken?: string | null,
): Promise<WorkflowView> {
  const notFound = `Workflow '${workflowId}' was not found.`;

  if (import.meta.env.DEV && !import.meta.env.VITE_WORKFLOWS_PATH) {
    const fallback = getDevelopmentWorkflowFallback(workflowId);
    if (!fallback) {
      throw new WorkflowsClientError("NOT_FOUND", notFound, false);
    }
    return fallback;
  }

  try {
    return await apiRequest<WorkflowView>(
      `${WORKFLOWS_PATH}/${encodeURIComponent(workflowId)}`,
      { method: "GET", accessToken },
    );
  } catch (error) {
    const clientError = toClientError(error, notFound);
    if (clientError && clientError.code !== "NOT_FOUND") {
      throw clientError;
    }
    if (import.meta.env.DEV) {
      const fallback = getDevelopmentWorkflowFallback(workflowId);
      if (fallback) {
        return fallback;
      }
    }
    throw (
      clientError ??
      new WorkflowsClientError(
        "NETWORK",
        "Unable to communicate with the Control Plane workflow service.",
        true,
      )
    );
  }
}
