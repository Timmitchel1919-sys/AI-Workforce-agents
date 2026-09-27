import { apiRequest } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import type {
  AutonomyLevel,
  CostPolicy,
  GitPolicy,
  OnboardingCapabilitiesView,
  OnboardingCommand,
  OnboardingIdentity,
  OnboardingKind,
  OnboardingMode,
  OnboardingOverride,
  OnboardingSession,
  OnboardingSessionSummary,
  OnboardingSource,
} from "../types";

/** Same-origin Control Plane API only. The browser never writes onboarding state directly. */
const API = "/api";

export type OnboardingErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DUPLICATE"
  | "INVALID"
  | "DEGRADED"
  | "NETWORK";

export class OnboardingClientError extends Error {
  readonly code: OnboardingErrorCode;
  readonly currentRevision?: number;
  readonly correlationId?: string;

  constructor(code: OnboardingErrorCode, message: string, extra: { currentRevision?: number; correlationId?: string } = {}) {
    super(message);
    this.name = "OnboardingClientError";
    this.code = code;
    if (extra.currentRevision !== undefined) this.currentRevision = extra.currentRevision;
    if (extra.correlationId !== undefined) this.correlationId = extra.correlationId;
  }
}

interface CommandResultBody {
  ok?: boolean;
  outcome?: string;
  errorKind?: string;
  reason?: string;
  correlationId?: string;
  details?: Record<string, unknown>;
}

function classifyText(text: string): OnboardingErrorCode | undefined {
  if (/duplicate/i.test(text)) return "DUPLICATE";
  if (/revision|stale|conflict/i.test(text)) return "CONFLICT";
  return undefined;
}

function fromResult(body: CommandResultBody): OnboardingClientError {
  const message = body.reason && body.reason.length > 0 ? body.reason : "The command was not accepted.";
  const detailCode = typeof body.details?.code === "string" ? body.details.code : undefined;
  const currentRevision = typeof body.details?.currentRevision === "number" ? body.details.currentRevision : undefined;
  const extra = {
    ...(currentRevision !== undefined ? { currentRevision } : {}),
    ...(body.correlationId ? { correlationId: body.correlationId } : {}),
  };
  let code: OnboardingErrorCode;
  if (detailCode === "revision_conflict") code = "CONFLICT";
  else if (detailCode === "duplicate_project") code = "DUPLICATE";
  else if (body.errorKind === "forbidden") code = "FORBIDDEN";
  else if (body.errorKind === "unauthorized") code = "UNAUTHENTICATED";
  else if (body.errorKind === "not_found") code = "NOT_FOUND";
  else if (body.errorKind === "invalid_request") code = "INVALID";
  else if (body.errorKind === "invalid_state") code = classifyText(message) ?? "INVALID";
  else code = "DEGRADED";
  return new OnboardingClientError(code, message, extra);
}

function fromApiError(error: unknown): OnboardingClientError {
  if (error instanceof OnboardingClientError) return error;
  if (error instanceof ApiError) {
    const text = `${error.reason ?? ""} ${error.message}`;
    let code: OnboardingErrorCode;
    if (error.status === 401 || error.errorKind === "unauthorized") code = "UNAUTHENTICATED";
    else if (error.status === 403 || error.errorKind === "forbidden") code = "FORBIDDEN";
    else if (error.status === 404 || error.errorKind === "not_found") code = "NOT_FOUND";
    else if (error.status === 409) code = classifyText(text) === "DUPLICATE" ? "DUPLICATE" : "CONFLICT";
    else if (error.errorKind === "invalid_state") code = classifyText(text) ?? "INVALID";
    else if (error.status === 400 || error.errorKind === "invalid_request") code = "INVALID";
    else if (error.status !== undefined && error.status >= 500) code = "DEGRADED";
    else code = "NETWORK";
    return new OnboardingClientError(code, error.reason ?? error.message, error.requestId ? { correlationId: error.requestId } : {});
  }
  return new OnboardingClientError("NETWORK", error instanceof Error ? error.message : "Control Plane unreachable");
}

async function request<T>(path: string, accessToken: string | null | undefined, init: RequestInit = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, { method: "GET", ...init, accessToken });
  } catch (error) {
    throw fromApiError(error);
  }
}

export function getCapabilities(accessToken?: string | null): Promise<OnboardingCapabilitiesView> {
  return request<OnboardingCapabilitiesView>(`${API}/onboarding/capabilities`, accessToken);
}

export async function listSessions(accessToken?: string | null): Promise<OnboardingSessionSummary[]> {
  const body = await request<{ sessions: OnboardingSessionSummary[] }>(`${API}/onboarding`, accessToken);
  return body.sessions ?? [];
}

export function getSession(id: string, accessToken?: string | null): Promise<OnboardingSession> {
  return request<OnboardingSession>(`${API}/onboarding/${encodeURIComponent(id)}`, accessToken);
}

/* ------------------------------------------------------------------ */
/* Commands                                                           */
/* ------------------------------------------------------------------ */

export interface OnboardingPatch {
  identity?: Partial<OnboardingIdentity>;
  source?: Partial<OnboardingSource>;
  overrides?: OnboardingOverride[];
  autonomyLevel?: AutonomyLevel;
  gitPolicy?: Partial<GitPolicy>;
  costPolicy?: Partial<CostPolicy>;
}

export type OnboardingCommandInput =
  | { command: "onboarding_create"; mode: OnboardingMode; kind: OnboardingKind; identity?: Partial<OnboardingIdentity>; source?: Partial<OnboardingSource> }
  | { command: "onboarding_update"; id: string; expectedRevision: number; patch: OnboardingPatch }
  | { command: "onboarding_analyze"; id: string; expectedRevision: number }
  | { command: "onboarding_plan"; id: string; expectedRevision: number }
  | { command: "onboarding_approve_plan"; id: string; expectedRevision: number; planVersion: number; planHash: string }
  | { command: "onboarding_provision"; id: string; expectedRevision: number; planHash: string }
  | { command: "onboarding_revalidate"; id: string; expectedRevision: number }
  | { command: "onboarding_cancel"; id: string; expectedRevision: number; reason?: string };

const COMMAND_NAMES: readonly OnboardingCommand[] = [
  "onboarding_create",
  "onboarding_update",
  "onboarding_analyze",
  "onboarding_plan",
  "onboarding_approve_plan",
  "onboarding_provision",
  "onboarding_revalidate",
  "onboarding_cancel",
];

/**
 * Issue one governed command. Resolves with the updated full session;
 * rejects with an OnboardingClientError for every failure (never swallowed).
 */
export async function runOnboardingCommand(
  input: OnboardingCommandInput,
  accessToken?: string | null,
): Promise<OnboardingSession> {
  const { command, ...body } = input;
  if (!COMMAND_NAMES.includes(command)) {
    throw new OnboardingClientError("INVALID", `Unknown onboarding command ${command}`);
  }
  const result = await request<CommandResultBody>(`${API}/commands/${command}`, accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!result || result.ok === false) throw fromResult(result ?? {});
  const session = result.details?.session as OnboardingSession | undefined;
  if (!session || typeof session !== "object") {
    throw new OnboardingClientError("DEGRADED", "The Control Plane accepted the command but returned no session.", {
      ...(result.correlationId ? { correlationId: result.correlationId } : {}),
    });
  }
  return session;
}
