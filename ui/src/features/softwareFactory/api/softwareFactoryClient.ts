import { apiRequest } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import type {
  AddWorkstreamTaskInput,
  CreateProgramInput,
  CreateWorkstreamInput,
  SoftwareFactoryCommandResult,
  SoftwareFactoryClientErrorCode,
  SoftwareFactoryOverview,
  SoftwareFactoryProgramDetail,
  TickSoftwareFactoryInput,
} from "./softwareFactoryTypes";

/**
 * EO-5.1 Software Factory: same-origin Control Plane API only; `apiRequest`
 * forwards the Firebase ID token. Reads are served by the Workforce query
 * service; every write is a governed Control Plane command that the backend
 * authorizes, validates and audits.
 */
const API = "/api";

export class SoftwareFactoryClientError extends Error {
  readonly code: SoftwareFactoryClientErrorCode;

  constructor(code: SoftwareFactoryClientErrorCode, message: string) {
    super(message);
    this.name = "SoftwareFactoryClientError";
    this.code = code;
  }
}

function toClientError(error: unknown): SoftwareFactoryClientError {
  if (error instanceof ApiError) {
    const code: SoftwareFactoryClientErrorCode =
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
    return new SoftwareFactoryClientError(code, error.message);
  }
  return new SoftwareFactoryClientError("NETWORK", error instanceof Error ? error.message : "Control Plane unreachable");
}

async function request<T>(path: string, accessToken: string | null | undefined, init: RequestInit = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, { method: "GET", ...init, accessToken });
  } catch (error) {
    throw toClientError(error);
  }
}

/** `GET /api/software-factory` — every program, summarized for the list view. */
export function getSoftwareFactoryOverview(
  projectId?: string,
  accessToken?: string | null,
): Promise<SoftwareFactoryOverview> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return request<SoftwareFactoryOverview>(`${API}/software-factory${query}`, accessToken);
}

/** `GET /api/software-factory/programs/:programId` — workstreams, graph, routes. */
export function getSoftwareFactoryProgramDetail(
  projectId: string,
  programId: string,
  accessToken?: string | null,
): Promise<SoftwareFactoryProgramDetail> {
  return request<SoftwareFactoryProgramDetail>(
    `${API}/software-factory/programs/${encodeURIComponent(programId)}?projectId=${encodeURIComponent(projectId)}`,
    accessToken,
  );
}

/* ------------------------------------------------------------------ */
/* Commands — dispatch stays fully server-side (no execution bypass).   */
/* ------------------------------------------------------------------ */

export type SoftwareFactoryCommand =
  | { kind: "create-program"; request: CreateProgramInput }
  | { kind: "create-workstream"; request: CreateWorkstreamInput }
  | { kind: "add-workstream-task"; request: AddWorkstreamTaskInput }
  | { kind: "tick"; request: TickSoftwareFactoryInput };

const COMMAND_PATH: Record<SoftwareFactoryCommand["kind"], string> = {
  "create-program": "create-program",
  "create-workstream": "create-workstream",
  "add-workstream-task": "add-workstream-task",
  tick: "tick-software-factory",
};

export function runSoftwareFactoryCommand(
  command: SoftwareFactoryCommand,
  accessToken?: string | null,
): Promise<SoftwareFactoryCommandResult> {
  return request<SoftwareFactoryCommandResult>(`${API}/commands/${COMMAND_PATH[command.kind]}`, accessToken, {
    method: "POST",
    body: JSON.stringify(command.request),
  });
}