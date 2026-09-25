/**
 * EO-4.7 Execution Control Center read models — authoritative only.
 *
 * Everything here is derived from recorded backend state (sessions,
 * receipts, audit, verifications, source-control and release receipts,
 * the environment adapter registry). Nothing is estimated or synthesized:
 * an absent subsystem is reported as `configured: false`, an absent event
 * is simply not in the timeline. Every read is project-scoped by the
 * underlying services (another project's data is 404) and bounded.
 */
import {
  NotFoundError,
  requireExecutionId,
  type AuditEvent,
  type ExecutionReceipt,
  type ExecutionSession,
  type ExecutionSessionStatus,
  type OperatorPrincipal,
  type ReleaseReceipt,
  type VerificationResult,
} from "../../contracts/index.js";
import type { ControlPlaneContext } from "../context.js";
import { redact, redactText } from "../redaction.js";

const MAX_TIMELINE = 200;
const MAX_RECEIPTS = 50;
const MAX_SESSIONS = 100;

export interface ExecutionSessionSummaryView {
  sessionId: string;
  projectId: string;
  plan: ExecutionSession["plan"];
  stageId: string;
  stageKind: ExecutionSession["stageKind"];
  operationId: string;
  status: ExecutionSessionStatus;
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

function summarize(s: ExecutionSession): ExecutionSessionSummaryView {
  return {
    sessionId: s.sessionId,
    projectId: s.projectId,
    plan: s.plan,
    stageId: s.stageId,
    stageKind: s.stageKind,
    operationId: s.operationId,
    status: s.status,
    agentId: s.agentId,
    environmentInstanceId: s.environmentInstanceId,
    ...(s.sandbox
      ? { runner: { providerId: s.sandbox.providerId, kind: s.sandbox.kind } }
      : {}),
    workspaceId: s.workspace.workspaceId,
    approvalIds: s.approvalIds,
    reasonCodes: s.reasons.map((r) => r.code),
    attempts: s.attempts.length,
    createdAt: s.createdAt,
    ...(s.startedAt ? { startedAt: s.startedAt } : {}),
    ...(s.endedAt ? { endedAt: s.endedAt } : {}),
  };
}

export async function listExecutionSessions(
  ctx: ControlPlaneContext,
  principal: OperatorPrincipal,
  projectId: string,
  query: { status?: string; limit?: number; offset?: number } = {},
) {
  if (!ctx.execution) return undefined;
  const all = await ctx.execution.listSessions(
    principal,
    requireExecutionId(projectId, "projectId"),
  );
  // Newest first; ties keep creation order reversed (deterministic paging).
  const filtered = all
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => !query.status || s.status === query.status)
    .sort(
      (a, b) => b.s.createdAt.localeCompare(a.s.createdAt) || b.index - a.index,
    )
    .map(({ s }) => s);
  const limit = Math.min(Math.max(1, query.limit ?? 25), MAX_SESSIONS);
  const offset = Math.max(0, query.offset ?? 0);
  return {
    items: filtered.slice(offset, offset + limit).map(summarize),
    total: filtered.length,
    limit,
    offset,
  };
}

export async function getExecutionOverview(
  ctx: ControlPlaneContext,
  principal: OperatorPrincipal,
  projectId: string,
) {
  if (!ctx.execution) return undefined;
  const sessions = await ctx.execution.listSessions(
    principal,
    requireExecutionId(projectId, "projectId"),
  );
  const byStatus: Partial<Record<ExecutionSessionStatus, number>> = {};
  for (const s of sessions) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  const awaitingApproval = sessions.filter((s) =>
    s.reasons.some((r) => r.code === "APPROVAL_REQUIRED"),
  ).length;
  const verifications = ctx.verification
    ? ctx.verification.history(principal, projectId)
    : undefined;
  const releases = ctx.deployments
    ? ctx.deployments.listReleases(principal, projectId, 200)
    : undefined;
  const count = <T extends { status: string }>(items: readonly T[]) =>
    items.reduce<Record<string, number>>(
      (acc, i) => ({ ...acc, [i.status]: (acc[i.status] ?? 0) + 1 }),
      {},
    );
  return {
    projectId,
    sessions: { total: sessions.length, byStatus, awaitingApproval },
    verifications: verifications
      ? {
          configured: true,
          total: verifications.length,
          byStatus: count(verifications),
        }
      : { configured: false },
    releases: releases
      ? { configured: true, total: releases.length, byStatus: count(releases) }
      : { configured: false },
  };
}

function receiptView(r: ExecutionReceipt) {
  return {
    receiptId: r.receiptId,
    attemptId: r.attemptId,
    operationId: r.operationId,
    toolId: r.toolId,
    outcome: r.outcome,
    exitClass: r.exitClass,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    reasons: (r.reasons ?? []).map((x) => ({
      code: x.code,
      detail: redactText(x.detail),
    })),
    resources: r.resources,
    simulated: r.simulated,
    ...(r.changeSetId ? { changeSetId: r.changeSetId } : {}),
    ...(r.changes
      ? {
          changes: r.changes.map((c) => ({
            path: c.path,
            change: c.change,
            ...(c.fromPath ? { fromPath: c.fromPath } : {}),
          })),
        }
      : {}),
    ...(r.environment ? { environment: r.environment } : {}),
  };
}

function timelineView(e: AuditEvent) {
  const { action, actor, ...rest } = (e.data ?? {}) as Record<string, unknown>;
  return {
    id: e.id,
    timestamp: e.timestamp,
    action: typeof action === "string" ? action : e.type,
    ...(typeof actor === "string" ? { actor } : {}),
    // Free-form audit data: redacted + bounded (defence in depth).
    data: redact(rest),
  };
}

export async function getExecutionSessionDetail(
  ctx: ControlPlaneContext,
  principal: OperatorPrincipal,
  projectId: string,
  sessionId: string,
  query: { timelineLimit?: number; timelineOffset?: number } = {},
) {
  if (!ctx.execution) return undefined;
  const session = await ctx.execution.getSession(
    principal,
    requireExecutionId(sessionId, "sessionId"),
  );
  // Session ids are global: never reveal another project's session.
  if (session.projectId !== projectId)
    throw new NotFoundError("resource not found");
  const events = ctx.audit
    .query({ type: "execution_event", projectId })
    .filter(
      (e) =>
        (e.data as Record<string, unknown> | undefined)?.execution ===
        sessionId,
    )
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const tLimit = Math.min(
    Math.max(1, query.timelineLimit ?? 100),
    MAX_TIMELINE,
  );
  const tOffset = Math.max(0, query.timelineOffset ?? 0);
  const receipts = (ctx.executionReceipts?.forSession(sessionId) ?? [])
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, MAX_RECEIPTS)
    .map(receiptView);
  const changeSet = await ctx.execution
    .getChangeSet(principal, sessionId)
    .catch(() => undefined);
  const agent = ctx.agents.get(session.agentId);
  const instance = ctx.environments?.getInstance(session.environmentInstanceId);
  const verifications: VerificationResult[] = ctx.verification
    ? ctx.verification
        .history(principal, projectId)
        .filter((v) => v.sourceSessionId === sessionId)
        .slice(0, 20)
    : [];
  return {
    session: {
      ...summarize(session),
      reasons: session.reasons.map((x) => ({
        code: x.code,
        detail: redactText(x.detail),
      })),
      limits: session.limits,
      network: session.network,
      policy: session.policy,
      risk: session.risk,
      grants: session.grants.map((g) => ({
        capability: g.capability,
        expiresAt: g.expiresAt,
      })),
      workspace: {
        workspaceId: session.workspace.workspaceId,
        mode: session.workspace.mode,
        status: session.workspace.status,
      },
      ...(session.cancellation
        ? {
            cancellation: {
              kind: session.cancellation.kind,
              requestedAt: session.cancellation.requestedAt,
              requestedBy: session.cancellation.requestedBy,
            },
          }
        : {}),
    },
    // AGENT ≠ MODEL: the workforce identity and the model policy are separate.
    agent: agent
      ? {
          agentId: agent.id,
          name: agent.name,
          capabilities: agent.capabilities,
          enabled: ctx.agentOps.isEnabled(agent.id),
        }
      : { agentId: session.agentId, registered: false },
    model: agent?.modelPolicy
      ? {
          provider: agent.modelPolicy.provider,
          ...(agent.modelPolicy.model
            ? { model: agent.modelPolicy.model }
            : {}),
        }
      : undefined,
    environment: instance
      ? {
          environmentInstanceId: instance.id,
          name: instance.name,
          environmentType: instance.environmentType,
          availability: instance.availability,
          toolchains: instance.toolchains.map((t) => ({
            kind: t.kind,
            ...(t.version
              ? {
                  version: `${t.version.major}.${t.version.minor}.${t.version.patch}`,
                }
              : {}),
          })),
        }
      : {
          environmentInstanceId: session.environmentInstanceId,
          registered: false,
        },
    changeSet: changeSet
      ? {
          changeSetId: changeSet.changeSetId,
          status: changeSet.status,
          ...(changeSet.baseRevision
            ? { baseRevision: changeSet.baseRevision }
            : {}),
          baselineCount: changeSet.baseline.length,
          entries: changeSet.entries.map((e) => ({
            path: e.path,
            change: e.change,
            ...(e.fromPath ? { fromPath: e.fromPath } : {}),
            risk: e.risk,
            sizeDelta: e.sizeDelta,
          })),
          updatedAt: changeSet.updatedAt,
        }
      : undefined,
    verifications,
    receipts,
    timeline: {
      items: events.slice(tOffset, tOffset + tLimit).map(timelineView),
      total: events.length,
      limit: tLimit,
      offset: tOffset,
    },
  };
}

export async function getProjectVerifications(
  ctx: ControlPlaneContext,
  principal: OperatorPrincipal,
  projectId: string,
) {
  requireExecutionId(projectId, "projectId");
  if (!ctx.verification) return { configured: false as const, items: [] };
  const items = ctx.verification.history(principal, projectId).slice(0, 50);
  // Source consistency: a passed verification is CURRENT only if the
  // project's source still has the verified fingerprint.
  const current = await ctx.workspaceControl
    ?.sourceFingerprint?.(projectId)
    .catch(() => undefined);
  return {
    configured: true as const,
    currentSourceFingerprint: current?.fingerprint,
    items: items.map((v) => ({
      ...v,
      sourceCurrent: current
        ? current.fingerprint === v.sourceFingerprint
        : undefined,
    })),
  };
}

export function getProjectReleases(
  ctx: ControlPlaneContext,
  principal: OperatorPrincipal,
  projectId: string,
) {
  requireExecutionId(projectId, "projectId");
  const sourceControl = ctx.sourceControl
    ? ctx.sourceControl.activity(principal, projectId, 50)
    : undefined;
  const releases: ReleaseReceipt[] | undefined = ctx.deployments
    ? ctx.deployments.listReleases(principal, projectId, 50)
    : undefined;
  const targets = ctx.deployments
    ? ctx.deployments.listTargets(principal, projectId)
    : undefined;
  return {
    sourceControl: sourceControl
      ? { configured: true as const, ...sourceControl }
      : { configured: false as const },
    deployments: releases
      ? { configured: true as const, releases, targets: targets ?? [] }
      : { configured: false as const },
  };
}
