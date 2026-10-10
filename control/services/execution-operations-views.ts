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

/**
 * A release source counts as CONFIGURED for the Operations views only when the CAPABILITY behind it
 * exists. A composed-but-inert pipeline (records readable, nothing able to run) must keep reading
 * "not configured", not "0 verifications": NOT CONNECTED != EMPTY. A context that does not declare
 * capabilities keeps the original meaning (the service is present or it is not).
 */
function releaseSources(ctx: ControlPlaneContext) {
  const caps = ctx.releaseCapabilities;
  return {
    verification: caps && !caps.verification ? undefined : ctx.verification,
    sourceControl: caps && !caps.sourceControl ? undefined : ctx.sourceControl,
    deployments:
      caps && caps.deploymentAdapters.length === 0
        ? undefined
        : ctx.deployments,
  };
}

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
  const rel = releaseSources(ctx);
  const verifications = rel.verification
    ? await rel.verification.listHistory(principal, projectId, 200)
    : undefined;
  const releases = rel.deployments
    ? await rel.deployments.listReleases(principal, projectId, 200)
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
  // EO-4.8: durable receipts (every instance, survives restarts) when configured.
  const receipts = (
    ctx.executionRecords
      ? await ctx.executionRecords.listBy<ExecutionReceipt>(
          "sessionId",
          sessionId,
          {
            kind: "receipt",
            limit: MAX_RECEIPTS,
          },
        )
      : (ctx.executionReceipts?.forSession(sessionId) ?? [])
  )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, MAX_RECEIPTS)
    .map(receiptView);
  const changeSet = await ctx.execution
    .getChangeSet(principal, sessionId)
    .catch(() => undefined);
  const agent = ctx.agents.get(session.agentId);
  const instance = ctx.environments?.getInstance(session.environmentInstanceId);
  const verifications: VerificationResult[] = releaseSources(ctx).verification
    ? (
        await releaseSources(ctx).verification!.listHistory(
          principal,
          projectId,
          200,
        )
      )
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
          // EO-8: this session belongs to `projectId` — the project-scoped status (most-specific-wins) is the one that actually governed dispatch.
          enabled: ctx.agentOps.isEnabled(agent.id, projectId),
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
  const verification = releaseSources(ctx).verification;
  if (!verification) return { configured: false as const, items: [] };
  const items = await verification.listHistory(principal, projectId, 50);
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

export async function getProjectReleases(
  ctx: ControlPlaneContext,
  principal: OperatorPrincipal,
  projectId: string,
) {
  requireExecutionId(projectId, "projectId");
  const rel = releaseSources(ctx);
  const sourceControl = rel.sourceControl
    ? await rel.sourceControl.activity(principal, projectId, 50)
    : undefined;
  const releases: ReleaseReceipt[] | undefined = rel.deployments
    ? await rel.deployments.listReleases(principal, projectId, 50)
    : undefined;
  const targets = rel.deployments
    ? rel.deployments.listTargets(principal, projectId)
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

/**
 * EO-6.2 — this project's usage, budget policy and evaluated status. The
 * ledger and budget gate are always composed (they need no model provider
 * to exist), so `configured: false` here means the Cost Center itself was
 * never wired into this deployment — not that no model call has happened.
 * Whether a call can EVER be governed is `capabilities.enforcement`
 * (CONNECTED != CAPABLE).
 */
export async function getProjectCostReport(
  ctx: ControlPlaneContext,
  principal: OperatorPrincipal,
  projectId: string,
) {
  const id = requireExecutionId(projectId, "projectId");
  if (!ctx.costCenter) return { configured: false as const };
  const [budgetPolicy, evaluation, usage] = await Promise.all([
    ctx.costCenter.budgetPolicy.get(principal, id),
    ctx.costCenter.enforcer.evaluate(principal, id),
    ctx.costCenter.usage.listByProject(principal, id, 50),
  ]);
  const caps = ctx.costCenterCapabilities;
  return {
    configured: true as const,
    budgetPolicy: budgetPolicy ?? null,
    evaluation,
    usage,
    capabilities: {
      enforcement: caps?.enforcement ?? false,
      providerIds: caps?.providerIds ?? [],
    },
  };
}

/**
 * EO-6.2 — RULE-BASED findings, recomputed fresh from the same authorized,
 * project-scoped reads the graph and Operations already use. A source this
 * deployment has not composed at all (verification / source control /
 * deployments / cost center) contributes no records rather than blocking the
 * whole read — the same "connected vs capable" honesty as `getProjectReleases`.
 */
export async function getProjectAuditFindings(
  ctx: ControlPlaneContext,
  principal: OperatorPrincipal,
  projectId: string,
) {
  const id = requireExecutionId(projectId, "projectId");
  if (!ctx.auditor) return { configured: false as const };
  const rel = releaseSources(ctx);
  const [releases, activity, verifications, sessions, usage] =
    await Promise.all([
      rel.deployments
        ? rel.deployments.listReleases(principal, id, 200)
        : Promise.resolve([]),
      rel.sourceControl
        ? rel.sourceControl.activity(principal, id, 200)
        : Promise.resolve(undefined),
      rel.verification
        ? rel.verification.listHistory(principal, id, 200)
        : Promise.resolve([]),
      ctx.execution
        ? ctx.execution.listSessions(principal, id)
        : Promise.resolve([]),
      ctx.costCenter
        ? ctx.costCenter.usage.listByProject(principal, id, 200)
        : Promise.resolve([]),
    ]);
  const result = ctx.auditor.run(id, {
    releases,
    commits: activity?.commits ?? [],
    verifications,
    sessions,
    usage,
    sourcesConnected: {
      verification: Boolean(rel.verification),
      sourceControl: Boolean(rel.sourceControl),
    },
  });
  return { configured: true as const, ...result };
}

/** EO-6.3 — this project's governance policy (provider/model allow-list, approval threshold). */
export async function getProjectGovernancePolicy(
  ctx: ControlPlaneContext,
  principal: OperatorPrincipal,
  projectId: string,
) {
  const id = requireExecutionId(projectId, "projectId");
  if (!ctx.governance) return { configured: false as const };
  const policy = await ctx.governance.policy.get(principal, id);
  return { configured: true as const, policy: policy ?? null };
}

/** EO-7 — this project's routing decision history (bounded, newest first). */
export async function getProjectRoutingDecisions(
  ctx: ControlPlaneContext,
  _principal: OperatorPrincipal,
  projectId: string,
) {
  const id = requireExecutionId(projectId, "projectId");
  if (!ctx.routing) return { configured: false as const };
  const decisions = await ctx.routing.router.listByProject(id);
  return { configured: true as const, decisions };
}

/** EO-7 — one routing decision, reconstructable (who requested it, what was rejected and why, what was selected). */
export async function getProjectRoutingDecision(
  ctx: ControlPlaneContext,
  _principal: OperatorPrincipal,
  projectId: string,
  routingDecisionId: string,
) {
  const id = requireExecutionId(projectId, "projectId");
  if (!ctx.routing) return undefined;
  const decision = await ctx.routing.router.get(
    id,
    requireExecutionId(routingDecisionId, "routingDecisionId"),
  );
  // A decision id that exists but belongs to a DIFFERENT project must read as "not found" —
  // never leak that it exists elsewhere. `get` is keyed only by decision id in the ledger, so the
  // project match is verified here, not assumed.
  if (!decision || decision.projectId !== id) return undefined;
  return { configured: true as const, decision };
}
