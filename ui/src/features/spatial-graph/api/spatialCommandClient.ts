import { apiRequest } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import { redactForDisplay } from "../../operations/operationsClient";
import type { NodeAction } from "../lib/nodeActions";

/**
 * The ONLY way the graph changes anything: an existing, allowlisted Control Plane command
 * (`POST /api/commands/:name`). The server authenticates, authorises (role + project scope),
 * re-checks the target's current state, executes through the domain subsystem and audits.
 * The graph never talks to Git / Firebase / a shell, and never invents a command.
 */
const API = "/api";

/** How a command failed — distinct so the operator is told the truth. */
export const COMMAND_FAILURE_KINDS = [
  "unauthenticated",
  "not_authorized",
  "invalid",
  /** The target is gone, or is no longer in the state the graph showed. */
  "stale_or_missing",
  "conflict",
  "approval",
  "execution_failure",
  "network",
  /** The request may or may not have been applied. Never auto-retried. */
  "unknown_outcome",
] as const;
export type CommandFailureKind = (typeof COMMAND_FAILURE_KINDS)[number];

export const FOLLOW_UP_ISSUES = ["task_resume", "plan_update", "workflow_resume"] as const;
export type FollowUpIssue = (typeof FOLLOW_UP_ISSUES)[number];
const FOLLOW_UP_KEYS: Readonly<Record<string, FollowUpIssue>> = {
  taskResumeError: "task_resume",
  executionPlanError: "plan_update",
  workflowResumeError: "workflow_resume",
};

export type CommandResult =
  | {
      ok: true;
      reason: string;
      correlationId: string;
      auditEventId?: string;
      /** cancel of a RUNNING session is accepted, not done: it moves to `cancelling` first. */
      inProgress: boolean;
      /** The target was already in the requested state: the command was accepted but changed nothing. */
      noChange: boolean;
      /**
       * The decision was recorded, but a follow-up step (resuming the task / plan / workflow) did
       * not complete. Success of the decision is not success of what it was meant to unblock.
       */
      followUpIssues: FollowUpIssue[];
    }
  | { ok: false; kind: CommandFailureKind; reason: string; correlationId: string };

/** Spatial-origin commands are tagged in the correlation id, so the audit trail shows where they began. */
export function newSpatialCorrelationId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  const id = c && "randomUUID" in c ? c.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `sg-${id}`;
}

const KIND_BY_ERROR_KIND: Readonly<Record<string, CommandFailureKind>> = {
  unauthorized: "unauthenticated",
  forbidden: "not_authorized",
  invalid_request: "invalid",
  not_found: "stale_or_missing",
  invalid_state: "conflict",
  approval_failure: "approval",
  command_failure: "execution_failure",
};

function classify(error: unknown): { kind: CommandFailureKind; reason: string } {
  if (error instanceof ApiError) {
    if (error.code === "timeout") {
      return { kind: "unknown_outcome", reason: error.message };
    }
    if (error.code === "network") return { kind: "network", reason: error.message };
    const byKind = error.errorKind ? KIND_BY_ERROR_KIND[error.errorKind] : undefined;
    const byStatus: CommandFailureKind | undefined =
      error.status === 401 ? "unauthenticated" : error.status === 403 ? "not_authorized" : error.status === 404 ? "stale_or_missing" : error.status === 409 ? "conflict" : error.status === 400 ? "invalid" : error.status && error.status >= 500 ? "execution_failure" : undefined;
    return { kind: byKind ?? byStatus ?? "execution_failure", reason: error.reason ?? error.message };
  }
  return { kind: "network", reason: "Unable to communicate with the Control Plane API." };
}

/** POST an allowlisted command for a node action. Resolves — never throws — with a typed result. */
export async function executeNodeCommand(
  action: NodeAction,
  reason: string,
  accessToken: string | null | undefined,
  correlationId: string = newSpatialCorrelationId(),
): Promise<CommandResult> {
  try {
    const body = await apiRequest<{
      outcome?: string;
      ok?: boolean;
      reason?: string;
      auditEventId?: string;
      details?: Record<string, unknown> & { outcome?: string };
    }>(`${API}/commands/${action.command}`, {
      method: "POST",
      body: JSON.stringify(action.body(reason.trim())),
      headers: { "x-correlation-id": correlationId },
      accessToken,
    });
    // REQUESTED != EXECUTED: only an authoritative `executed` outcome is success. Anything else
    // that slipped through with a 200 is reported as a failure, never as "Done".
    if (body?.outcome !== "executed" || body.ok !== true) {
      return { ok: false, kind: "execution_failure", reason: redactForDisplay(body?.reason ?? "The command was not executed."), correlationId };
    }
    return {
      ok: true,
      reason: redactForDisplay(body.reason ?? "Done."),
      correlationId,
      ...(body.auditEventId ? { auditEventId: body.auditEventId } : {}),
      inProgress: body.details?.outcome === "cancelling",
      noChange: typeof body.details?.outcome === "string" && body.details.outcome.startsWith("already_"),
      followUpIssues: Object.entries(FOLLOW_UP_KEYS)
        .filter(([key]) => body.details?.[key] !== undefined)
        .map(([, issue]) => issue),
    };
  } catch (error) {
    const c = classify(error);
    return { ok: false, kind: c.kind, reason: redactForDisplay(c.reason), correlationId };
  }
}
