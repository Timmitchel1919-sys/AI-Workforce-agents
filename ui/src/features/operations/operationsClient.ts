/**
 * EO-4.7 Execution Control Center client. Same-origin Control Plane only
 * (never Firestore, GitHub, Firebase Admin, a runner or a deploy provider).
 * Reads are project-scoped; the only mutations are the typed, audited
 * cancel / kill commands. There is no execute call and nothing here accepts
 * a command string, an executable, a destination or a credential.
 */
import { apiRequest } from "../../api/client";
import { ApiError } from "../../api/errors";

export type SessionStatus =
  | "created"
  | "validating"
  | "ready"
  | "running"
  | "cancelling"
  | "cancelled"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "denied";

export const TERMINAL_SESSION_STATUSES: readonly SessionStatus[] = ["cancelled", "succeeded", "failed", "timed_out", "denied"];

export interface Reason {
  code: string;
  detail: string;
}

export interface SessionSummary {
  sessionId: string;
  projectId: string;
  plan: { planId: string; version: number; executionPlanId: string };
  stageId: string;
  stageKind: string;
  operationId: string;
  status: SessionStatus;
  agentId: string;
  environmentInstanceId: string;
  runner?: { providerId: string; kind: string };
  workspaceId: string;
  approvalIds: readonly string[];
  reasonCodes: readonly string[];
  attempts: number;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface SessionPage {
  items: SessionSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface EnvironmentEvidence {
  environmentInstanceId: string;
  adapterId: string;
  adapterVersion: string;
  runnerId: string;
  runnerClass: string;
  toolchains: readonly { kind: string; version?: string }[];
  sourceFingerprint?: string;
  simulated: boolean;
}

export interface StageRun {
  stageId: string;
  stageKind: string;
  category?: string;
  operationId?: string;
  required: boolean;
  status: "not_run" | "running" | "passed" | "failed" | "blocked" | "timed_out" | "cancelled" | "error";
  failure?: { kind: string; detail: string };
  attempts: number;
  log?: { text: string; truncated: boolean };
  findings?: readonly { rule: string; severity: string; count: number }[];
  environment?: EnvironmentEvidence;
  startedAt?: string;
  endedAt?: string;
  artifactIds: readonly string[];
}

export interface Verification {
  verificationId: string;
  projectId: string;
  plan: { planId: string; version: number };
  sourceSessionId?: string;
  changeSetId?: string;
  sourceFingerprint: string;
  status: "pending" | "running" | "passed" | "failed" | "blocked" | "cancelled" | "timed_out";
  stages: readonly StageRun[];
  reasons: readonly Reason[];
  unverifiedStageIds: readonly string[];
  isolation: { filesystem: boolean; network: boolean } | "none_ran";
  createdAt: string;
  completedAt?: string;
  /** false → the source changed after verification (reverification required). */
  sourceCurrent?: boolean;
}

export interface SessionDetail {
  session: SessionSummary & {
    reasons: readonly Reason[];
    risk: string;
    policy: { policyId: string; version: number };
    workspace: { workspaceId: string; mode: string; status: string };
    grants: readonly { capability: string; expiresAt: string }[];
    cancellation?: { kind: "cancel" | "kill"; requestedAt: string; requestedBy: string };
  };
  agent: { agentId: string; name?: string; capabilities?: readonly string[]; enabled?: boolean; registered?: false };
  model?: { provider?: string; model?: string };
  environment: {
    environmentInstanceId: string;
    name?: string;
    environmentType?: string;
    availability?: string;
    toolchains?: readonly { kind: string; version?: string }[];
    registered?: false;
  };
  changeSet?: {
    changeSetId: string;
    status: string;
    baseRevision?: string;
    baselineCount: number;
    entries: readonly { path: string; change: string; fromPath?: string; risk: string; sizeDelta: number }[];
    updatedAt: string;
  };
  verifications: readonly Verification[];
  receipts: readonly {
    receiptId: string;
    operationId: string;
    outcome: string;
    exitClass: string;
    startedAt: string;
    endedAt: string;
    reasons: readonly Reason[];
    resources: { wallClockMs: number; outputBytes: number; outputTruncated: boolean };
    simulated: boolean;
    environment?: EnvironmentEvidence;
  }[];
  timeline: {
    items: readonly { id: string; timestamp: string; action: string; actor?: string; data: Record<string, unknown> }[];
    total: number;
    limit: number;
    offset: number;
  };
}

export interface ExecutionOverview {
  projectId: string;
  sessions: { total: number; byStatus: Partial<Record<SessionStatus, number>>; awaitingApproval: number };
  verifications: { configured: false } | { configured: true; total: number; byStatus: Record<string, number> };
  releases: { configured: false } | { configured: true; total: number; byStatus: Record<string, number> };
}

export interface FamilyStatus {
  family: string;
  adapters: readonly { adapterId: string; version: string }[];
  status: "available" | "busy" | "offline" | "stale" | "not_configured" | "unsupported";
  realRunners: number;
  simulatedRunners: number;
}

export type ReleaseStatus = "pending" | "deploying" | "deployed" | "verifying" | "healthy" | "degraded" | "failed" | "rolled_back";

export interface ReleaseReceipt {
  releaseId: string;
  candidateId: string;
  commitSha: string;
  targetId: string;
  targetClass: "development" | "preview" | "staging" | "production";
  adapterId: string;
  status: ReleaseStatus;
  reasons: readonly Reason[];
  postDeploy?: { reachable: boolean; reportedVersion?: string; versionMatches: boolean; checkedAt: string; detail: string };
  rollback?: { fromReleaseId: string; toReleaseId: string; automatic: boolean };
  /** Per-resource outcome; a non-empty `failed` = partial deployment. */
  resources?: { completed: readonly string[]; failed: readonly string[] };
  simulated: boolean;
  startedAt: string;
  endedAt?: string;
}

export interface ProjectReleases {
  sourceControl:
    | { configured: false }
    | {
        configured: true;
        reviews: readonly { reviewId: string; status: string; reviewerId: string; reviewerKind: string; changeSetId: string; createdAt: string }[];
        stageSets: readonly { stageSetId: string; changeSetId: string; files: readonly { path: string }[]; createdAt: string }[];
        commits: readonly { receiptId: string; commitSha: string; branch: string; changeSetId: string; message: string; createdAt: string }[];
        pushes: readonly { receiptId: string; commitSha: string; branch: string; result: string; pullRequestRequired: boolean; createdAt: string }[];
        pullRequests: readonly { pullRequestId: string; number?: number; status: string; checks: string; sourceBranch: string; targetBranch: string }[];
      };
  deployments: { configured: false } | { configured: true; releases: readonly ReleaseReceipt[]; targets: readonly { targetId: string; targetClass: string; resources: readonly string[] }[] };
}

export type OperationsFailure = "unauthenticated" | "forbidden" | "not_found" | "conflict" | "invalid" | "unavailable";

export class OperationsError extends Error {
  readonly failure: OperationsFailure;
  constructor(failure: OperationsFailure, message: string) {
    super(message);
    this.name = "OperationsError";
    this.failure = failure;
  }
}

function toFailure(error: unknown): OperationsError {
  if (error instanceof ApiError) {
    const failure: OperationsFailure =
      error.status === 401
        ? "unauthenticated"
        : error.status === 403
          ? "forbidden"
          : error.status === 404
            ? "not_found"
            : error.status === 409
              ? "conflict"
              : error.status === 400 || error.status === 422
                ? "invalid"
                : "unavailable";
    return new OperationsError(failure, error.message);
  }
  return new OperationsError("unavailable", "Control Plane unreachable");
}

async function get<T>(path: string, token?: string | null): Promise<T> {
  try {
    return await apiRequest<T>(path, { method: "GET", accessToken: token });
  } catch (error) {
    throw toFailure(error);
  }
}

const project = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;

export const getExecutionOverview = (projectId: string, token?: string | null) =>
  get<ExecutionOverview>(`${project(projectId)}/execution-overview`, token);

export function getExecutionSessions(
  projectId: string,
  query: { status?: string; limit?: number; offset?: number },
  token?: string | null,
) {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  params.set("limit", String(query.limit ?? 25));
  params.set("offset", String(query.offset ?? 0));
  return get<SessionPage>(`${project(projectId)}/executions?${params.toString()}`, token);
}

export const getExecutionSessionDetail = (projectId: string, sessionId: string, timelineLimit: number, token?: string | null) =>
  get<SessionDetail>(`${project(projectId)}/executions/${encodeURIComponent(sessionId)}?timelineLimit=${timelineLimit}`, token);

export const getProjectVerifications = (projectId: string, token?: string | null) =>
  get<{ configured: boolean; items: Verification[] }>(`${project(projectId)}/verifications`, token);

export const getProjectReleases = (projectId: string, token?: string | null) =>
  get<ProjectReleases>(`${project(projectId)}/releases`, token);

export const getExecutionEnvironments = (token?: string | null) =>
  get<{ configured: boolean; families: FamilyStatus[] }>(`/api/execution/environments`, token);

/** Typed, audited session control. `kill` is the administrators-only emergency stop. */
export async function stopExecution(
  kind: "cancel" | "kill",
  sessionId: string,
  reason: string,
  token?: string | null,
): Promise<{ outcome?: string; details?: { outcome?: string } }> {
  try {
    return await apiRequest(`/api/commands/${kind === "kill" ? "kill-execution" : "cancel-execution"}`, {
      method: "POST",
      body: JSON.stringify({ sessionId, reason }),
      accessToken: token,
    });
  } catch (error) {
    throw toFailure(error);
  }
}

const SECRET_SHAPES = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /(bearer\s+)[A-Za-z0-9._-]{16,}/gi,
];

/** Defence in depth: the server redacts; the UI never renders a secret shape either. */
export function redactForDisplay(text: string): string {
  return SECRET_SHAPES.reduce((acc, re) => acc.replace(re, "[redacted]"), text);
}
