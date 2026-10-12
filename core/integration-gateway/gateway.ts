/**
 * Tool Gateway — the only path from an agent or workflow to an external capability.
 *
 *   request → validate → candidates (project mapping, trust, health, sandbox) → selection
 *     → resource ownership → Layer 7 governor (policy, permission, risk, approval)
 *     → connector-trust escalation → rate limit / circuit → execute (retry by failure kind)
 *     → fallback (approved, same family, never weaker) / queue (safe operations only)
 *     → normalized result → audit, activity log, usage
 *
 * Agents pass a capability name and parameters. They never see a provider URL, a client or a
 * credential: the secret exists only inside `vault.use` while the request is being sent.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Repository } from "../../contracts/persistence.js";
import type { UsageDraft } from "../../contracts/cost-center.js";
import {
  HUB_LIMITS,
  type ActivityRecord,
  type FailureKind,
  type HubConnector,
  type HubErrorKind,
  type HubRequest,
  type HubResult,
  type OperationClass,
  type ProjectIntegrationMapping,
} from "../../contracts/integration-gateway.js";
import type {
  ActionClass,
  GovEnvironment,
  SecurityDecision,
  TrustState,
} from "../../contracts/security-governance.js";
import { SyncCache } from "../knowledge-memory/memory-service.js";
import {
  containsSecret,
  maskSecrets,
} from "../prompt-intelligence/secret-scan.js";
import type { SecuritySystem } from "../security-governance/index.js";
import type { McpGateway } from "./mcp.js";
import { HubRegistry, hubToolId } from "./registry.js";
import {
  RateLimiter,
  HealthMonitor,
  retryDelayMs,
  shouldRetryCall,
} from "./resilience.js";
import {
  callRest,
  validateParams,
  type FetchLike,
  type RestCapability,
  type RestOutcome,
} from "./rest.js";
import { CredentialVault, OAuthManager, VaultError } from "./vault.js";

const ACTION_OF: Record<OperationClass, ActionClass> = {
  READ: "READ",
  DRAFT: "CREATE",
  WRITE: "UPDATE",
  PUBLISH: "PUBLISH",
  SEND: "SHARE",
  DEPLOY: "DEPLOY",
  DELETE: "DELETE",
};
const TRUST_RANK: Record<TrustState, number> = {
  DISABLED: 0,
  SUSPENDED: 0,
  REVIEW_REQUIRED: 1,
  LIMITED: 2,
  TRUSTED: 3,
};
const FALLBACK_KINDS: FailureKind[] = [
  "NETWORK",
  "PROVIDER_ERROR",
  "TRANSIENT",
  "RATE_LIMIT",
];

export interface QueuedRequest {
  id: string;
  request: HubRequest;
  capability: string;
  connectorId: string;
  enqueuedAt: string;
  attempts: number;
  nextAttemptAt: string;
  status: "QUEUED" | "DONE" | "FAILED";
  lastError?: string;
}

/** Deployment is a hand-off: the gateway never builds or runs deploy commands itself. */
export interface DeploymentExecutor {
  readonly available: boolean;
  prepare(input: {
    projectId: string;
    environment: string;
    resource: string;
  }): Promise<{ reference: string; summary: string }>;
  execute(input: {
    projectId: string;
    environment: string;
    resource: string;
  }): Promise<{ reference: string }>;
}

export interface GatewayDeps {
  registry: HubRegistry;
  vault: CredentialVault;
  oauth: OAuthManager;
  security: SecuritySystem;
  health: HealthMonitor;
  limiter: RateLimiter;
  activity: Repository<ActivityRecord>;
  queue: Repository<QueuedRequest>;
  fetchImpl: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  deployment?: DeploymentExecutor;
  mcp?: McpGateway;
  recordUsage?: (draft: UsageDraft) => void;
  newId?: () => string;
}

interface Candidate {
  connector: HubConnector;
  cap: RestCapability;
  mapping: ProjectIntegrationMapping;
  score: number;
  reasons: string[];
}

const hashOf = (v: unknown): string =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 10);

function summarize(params: Record<string, unknown>): string {
  return Object.entries(params)
    .map(
      ([k, v]) =>
        `${k}=${maskSecrets(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 60)}`,
    )
    .join(" ")
    .slice(0, 160);
}

export class ToolGateway {
  private readonly activity: Repository<ActivityRecord>;
  private readonly queue: Repository<QueuedRequest>;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly newId: () => string;

  constructor(private readonly d: GatewayDeps) {
    this.activity = new SyncCache(d.activity);
    this.queue = new SyncCache(d.queue);
    this.now = d.now ?? Date.now;
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.newId = d.newId ?? (() => randomBytes(5).toString("hex"));
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  /* ------------------------------------------------------------------ */
  /* Discovery                                                           */
  /* ------------------------------------------------------------------ */

  /** What can be asked for in this project, and what each thing would require. */
  discover(projectId: string): {
    capability: string;
    description: string;
    operation: OperationClass;
    risk: string;
    providers: {
      connectorId: string;
      provider: string;
      status: string;
      mode: string;
      trust: string;
      resource: string;
      role: string;
    }[];
    approval: "none" | "likely" | "always";
    available: boolean;
    reason?: string;
  }[] {
    const out = new Map<string, ReturnType<ToolGateway["discover"]>[number]>();
    for (const m of this.d.registry.manifestsList()) {
      for (const cap of m.capabilities) {
        const connector = this.d.registry.get(m.connectorId);
        const existing = out.get(cap.capability);
        const base = existing ?? {
          capability: cap.capability,
          description: cap.description,
          operation: cap.operation,
          risk: cap.risk,
          providers: [],
          approval: (cap.operation === "READ"
            ? "none"
            : ["PUBLISH", "SEND", "DEPLOY", "DELETE"].includes(cap.operation)
              ? "always"
              : "likely") as "none" | "likely" | "always",
          available: false,
        };
        if (cap.unavailable) {
          if (!existing)
            out.set(cap.capability, { ...base, reason: cap.unavailable });
          continue;
        }
        if (connector) {
          for (const mp of this.d.registry.mappingFor(
            projectId,
            m.connectorId,
          )) {
            base.providers.push({
              connectorId: m.connectorId,
              provider: m.provider,
              status: connector.status,
              mode: connector.mode,
              trust: connector.trust,
              resource: mp.resource,
              role: mp.role,
            });
          }
        }
        base.available = base.providers.some(
          (p) =>
            !["DISABLED", "ERROR", "DISCOVERED", "DISCONNECTED"].includes(
              p.status,
            ),
        );
        out.set(cap.capability, base);
      }
    }
    for (const row of this.d.mcp?.capabilities(projectId) ?? [])
      out.set(row.capability, row);
    return [...out.values()].sort((a, b) =>
      a.capability.localeCompare(b.capability),
    );
  }

  /* ------------------------------------------------------------------ */
  /* Invoke                                                              */
  /* ------------------------------------------------------------------ */

  async invoke(
    req: HubRequest,
    internal: {
      substitutedFrom?: string;
      fallbackFrom?: string;
      skipQueue?: boolean;
    } = {},
  ): Promise<HubResult> {
    const started = this.now();
    const requestId = req.requestId ?? `req-${this.newId()}`;
    const capability = String(req.capability ?? "");
    const result = (
      partial: Partial<HubResult> & { success: boolean },
    ): HubResult => ({
      requestId,
      capability,
      ...partial,
      // Substitution and fallback are always disclosed, whichever path built the result.
      metadata: {
        durationMs: this.now() - started,
        attempts: 0,
        ...partial.metadata,
        ...(internal.substitutedFrom
          ? { substitutedFrom: internal.substitutedFrom }
          : {}),
        ...(internal.fallbackFrom
          ? { fallbackFrom: internal.fallbackFrom }
          : {}),
      },
    });
    const who = req.agentId ?? req.principalId ?? "unknown";
    const ledger = this.d.security.ledger;
    const log = (
      outcome: ActivityRecord["outcome"],
      extra: Partial<ActivityRecord> = {},
    ): void => {
      if (req.dryRun) return;
      const id = `act-${requestId}-${outcome}-${this.now()}`;
      this.activity.upsert({
        id,
        at: this.iso(),
        requestId,
        capability,
        projectId: req.projectId,
        ...(req.agentId ? { agentId: req.agentId } : {}),
        ...(req.taskId ? { taskId: req.taskId } : {}),
        outcome,
        durationMs: this.now() - started,
        ...extra,
      });
      const events = this.activity.list();
      if (events.length > 2000)
        for (const e of events.slice(0, events.length - 2000))
          this.activity.delete(e.id);
    };
    const deny = (
      kind: HubErrorKind,
      message: string,
      retryable = false,
      extra: Partial<HubResult> = {},
    ): HubResult => {
      log(
        kind === "APPROVAL_REQUIRED"
          ? "WAITING_APPROVAL"
          : kind === "POLICY_DENIED" || kind === "NOT_MAPPED"
            ? "DENIED"
            : "BLOCKED",
        {
          errorKind: kind,
          detail: message.slice(0, 200),
          ...(extra.connectorId ? { connectorId: extra.connectorId } : {}),
        },
      );
      if (
        !req.dryRun &&
        [
          "POLICY_DENIED",
          "NOT_MAPPED",
          "SANDBOX_BLOCKED",
          "NOT_AVAILABLE",
          "INVALID_REQUEST",
        ].includes(kind)
      )
        ledger.record("tool.denied", {
          actor: who,
          projectId: req.projectId,
          agentId: req.agentId,
          taskId: req.taskId,
          toolId: hubToolId(capability),
          result: kind,
          detail: { reason: message.slice(0, 200) },
        });
      return result({
        success: false,
        error: { kind, message: maskSecrets(message), retryable },
        ...extra,
      });
    };

    /* 1. Validate the request itself. */
    if (!/^[a-z][a-z0-9_.-]{2,100}$/.test(capability))
      return deny("INVALID_REQUEST", "invalid capability name");
    if (typeof req.projectId !== "string" || req.projectId === "")
      return deny("INVALID_REQUEST", "projectId is required");
    if (!req.agentId && !req.principalId)
      return deny("INVALID_REQUEST", "the request has no identity");
    const params = req.parameters ?? {};
    if (typeof params !== "object" || Array.isArray(params))
      return deny("INVALID_REQUEST", "parameters must be an object");
    const serialized = JSON.stringify(params);
    if (serialized.length > HUB_LIMITS.maxParamBytes)
      return deny("INVALID_REQUEST", "parameters are too large");
    if (
      containsSecret(serialized) ||
      (req.resource && containsSecret(req.resource))
    ) {
      this.d.security.secrets.screen(serialized, {
        where: "integration request parameters",
        agentId: req.agentId,
        projectId: req.projectId,
        taskId: req.taskId,
      });
      return deny(
        "INVALID_REQUEST",
        "request parameters must not contain credentials; connectors hold their own",
      );
    }
    if (!req.dryRun)
      ledger.record("tool.requested", {
        actor: who,
        projectId: req.projectId,
        agentId: req.agentId,
        taskId: req.taskId,
        executionId: req.executionId,
        toolId: hubToolId(capability),
        result: "REQUESTED",
        detail: { capability, parameters: summarize(params) },
      });

    /* 2. MCP-provided capabilities. */
    if (capability.startsWith("mcp."))
      return this.invokeMcp(
        req,
        requestId,
        started,
        params as Record<string, unknown>,
      );

    /* 3. Candidates. */
    const all = this.d.registry.providersFor(capability);
    if (all.length === 0) {
      const boundary = this.d.registry
        .manifestsList()
        .flatMap((m) =>
          m.capabilities
            .filter((c) => c.capability === capability && c.unavailable)
            .map((c) => c.unavailable!),
        );
      return deny(
        "NOT_AVAILABLE",
        boundary[0]
          ? `capability "${capability}" is not available: ${boundary[0]}`
          : `no connector provides "${capability}"`,
      );
    }
    const candidates: Candidate[] = [];
    const rejected: string[] = [];
    for (const { connector, cap } of all) {
      if (req.connectorId && connector.connectorId !== req.connectorId)
        continue;
      const why = this.rejectReason(
        connector,
        req.projectId,
        internal.skipQueue,
      );
      const mappings = this.d.registry.mappingFor(
        req.projectId,
        connector.connectorId,
      );
      if (why) {
        rejected.push(`${connector.name}: ${why}`);
        continue;
      }
      if (mappings.length === 0) {
        rejected.push(
          `${connector.name}: not mapped to project ${req.projectId}`,
        );
        continue;
      }
      const primary =
        mappings.find((m) => m.role === "PRIMARY") ?? mappings[0]!;
      const rank =
        (connector.status === "HEALTHY"
          ? 3
          : connector.status === "CONNECTED"
            ? 2
            : 1) *
          10 +
        TRUST_RANK[connector.trust] * 2 +
        (connector.costClass === "FREE" ? 1 : 0) +
        (primary.role === "PRIMARY" ? 20 : 0) +
        (req.connectorId === connector.connectorId ? 50 : 0);
      const latency = connector.health.latencyMs ?? 0;
      candidates.push({
        connector,
        cap,
        mapping: primary,
        score: rank - latency / 10000,
        reasons: [
          `status ${connector.status}`,
          `trust ${connector.trust}`,
          `${primary.role.toLowerCase()} mapping`,
          connector.costClass.toLowerCase(),
        ],
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    if (candidates.length === 0) {
      const mapped = all.some(
        ({ connector }) =>
          this.d.registry.mappingFor(req.projectId, connector.connectorId)
            .length > 0,
      );
      return deny(
        mapped ? "NOT_AVAILABLE" : "NOT_MAPPED",
        `no usable provider for "${capability}" in project ${req.projectId}: ${rejected.join("; ") || "none configured"}`,
        mapped,
      );
    }
    const chosen = candidates[0]!;
    const selection = [
      `selected ${chosen.connector.name} (${chosen.reasons.join(", ")})`,
      ...rejected.map((r) => `skipped ${r}`),
    ];
    const { connector, cap } = chosen;
    const meta = {
      connectorId: connector.connectorId,
      provider: connector.provider,
    };

    /* 4. Parameters and resource ownership. */
    const bad = validateParams(cap.params, params as Record<string, unknown>);
    if (bad) return deny("INVALID_REQUEST", bad, false, meta);
    const resolved = this.resolveResource(req, cap, chosen.mapping, connector);
    if ("error" in resolved) {
      if (resolved.crossProject) {
        // The identifier belongs to another project: a policy violation, not just a typo.
        this.d.security.governor.check(
          {
            projectId: req.projectId,
            action: "READ",
            resource: `project:${resolved.crossProject}`,
            ...(req.agentId
              ? { agentId: req.agentId }
              : { principalId: req.principalId! }),
            ...(req.taskType ? { taskType: req.taskType } : {}),
            ...(req.taskId ? { taskId: req.taskId } : {}),
          },
          { alerts: !req.dryRun, approvals: false },
        );
        if (!req.dryRun)
          ledger.record("integration.cross_project_denied", {
            actor: who,
            severity: "HIGH",
            projectId: req.projectId,
            agentId: req.agentId,
            resource: `${connector.connectorId}/${resolved.value}`,
            result: "DENIED",
          });
      }
      return deny("NOT_MAPPED", resolved.error, false, meta);
    }
    const resource = resolved.resource;
    const environment: GovEnvironment =
      req.environment ??
      chosen.mapping.environment ??
      connector.config.environment ??
      "DEVELOPMENT";

    /* 5. Sandbox: side effects are blocked or replaced by a safer capability. */
    if (connector.mode === "SANDBOX" && cap.operation !== "READ") {
      if (typeof cap.sandbox === "object") {
        if (internal.substitutedFrom)
          return deny(
            "SANDBOX_BLOCKED",
            "the sandbox substitute cannot itself be substituted",
            false,
            meta,
          );
        return this.invoke(
          { ...req, capability: cap.sandbox.substitute, requestId },
          { ...internal, substitutedFrom: capability },
        );
      }
      if (cap.sandbox === "DENY")
        return deny(
          "SANDBOX_BLOCKED",
          `"${capability}" is a ${cap.operation.toLowerCase()} operation and ${connector.name} is in sandbox mode; switch it to live mode to allow it`,
          false,
          meta,
        );
    }

    /* 6. Governance (Layer 7): identical pipeline for every consequential action. */
    const op = cap.operation;
    const content = op === "READ" ? undefined : serialized;
    const command = `${capability} ${summarize(params as Record<string, unknown>)} #${hashOf(params)}`;
    const actionReq = {
      projectId: req.projectId,
      action: ACTION_OF[op],
      resource:
        op === "DEPLOY"
          ? `deploy:${environment.toLowerCase()}`
          : `integration:${connector.connectorId}/${resource}`,
      ...(req.agentId
        ? { agentId: req.agentId }
        : { principalId: req.principalId! }),
      ...(req.executionId ? { executionId: req.executionId } : {}),
      ...(req.taskId ? { taskId: req.taskId } : {}),
      ...(req.taskType ? { taskType: req.taskType } : {}),
      toolId: hubToolId(capability),
      environment,
      command,
      ...(content ? { content } : {}),
      expectedScope: [`integration:${connector.connectorId}/${resource}`],
      ...(req.reason ? { reason: req.reason } : {}),
    };
    const decision = this.d.security.governor.check(
      { ...actionReq, ...(req.dryRun ? { dryRun: true } : {}) },
      req.dryRun
        ? { record: "simulated", approvals: false, alerts: false }
        : { record: "real", approvals: true, alerts: true },
    );
    const decisionView = {
      effect: decision.effect,
      risk: decision.risk.level,
      explanation: decision.explanation,
    };
    if (decision.effect === "DENY")
      return deny(
        "POLICY_DENIED",
        decision.reasons.at(-1) ?? "denied by policy",
        false,
        { ...meta, decision: decisionView },
      );
    let approvalId = decision.approval?.approvalId;
    const needsApproval =
      decision.effect === "REQUIRE_APPROVAL" ||
      decision.effect === "REQUIRE_SECURITY_REVIEW";
    // Connector trust can only add restriction. A REVIEW on an external side effect cannot be done
    // afterwards, so it becomes an approval. An approval already granted for this exact action counts.
    const trustNeeds =
      decision.approval?.state !== "APPROVED" &&
      ((connector.trust === "LIMITED" && op !== "READ" && op !== "DRAFT") ||
        (connector.trust === "REVIEW_REQUIRED" && op !== "READ") ||
        (decision.effect === "REQUIRE_REVIEW" && op !== "READ"));
    if (needsApproval || trustNeeds) {
      if (req.dryRun)
        return result({
          success: true,
          ...meta,
          data: {
            simulated: true,
            wouldExecute: false,
            requires: "APPROVAL",
            capability,
            operation: op,
            resource,
            environment,
          },
          decision: decisionView,
          metadata: {
            durationMs: this.now() - started,
            attempts: 0,
            operation: op,
            sandbox: connector.mode === "SANDBOX",
            selection,
          },
        });
      let granted = false;
      if (!needsApproval) {
        const already = this.d.security.approvals.approvedFor(actionReq);
        if (already) {
          this.d.security.approvals.consume(already);
          approvalId = already;
          granted = true;
        } else {
          const why: SecurityDecision = {
            ...decision,
            effect: "REQUIRE_APPROVAL",
            explanation: `${decision.explanation}
Connector trust: ${connector.name} is ${connector.trust}; external side effects need a human decision.`,
          };
          approvalId = this.d.security.approvals.request(
            actionReq,
            why,
          ).approvalId;
        }
      }
      if (!granted) {
        log("WAITING_APPROVAL", {
          ...meta,
          operation: op,
          resource,
          risk: decision.risk.level,
          ...(approvalId ? { approvalId } : {}),
        });
        return result({
          success: false,
          ...meta,
          error: {
            kind: "APPROVAL_REQUIRED",
            message: `waiting for a human decision (${decision.risk.level} risk ${op.toLowerCase()})`,
            retryable: false,
            ...(approvalId ? { approvalId } : {}),
          },
          decision: decisionView,
          metadata: {
            durationMs: this.now() - started,
            attempts: 0,
            operation: op,
            selection,
          },
        });
      }
    }

    if (req.dryRun)
      return result({
        success: true,
        ...meta,
        data: {
          simulated: true,
          wouldExecute: true,
          capability,
          operation: op,
          resource,
          environment,
        },
        decision: decisionView,
        metadata: {
          durationMs: this.now() - started,
          attempts: 0,
          operation: op,
          sandbox: connector.mode === "SANDBOX",
          selection,
        },
      });

    /* 7. Rate limit and circuit. */
    const unavailable = (
      why: string,
      retryable: boolean,
      kind: HubErrorKind,
    ): HubResult | Promise<HubResult> => {
      if (cap.queueable && !internal.skipQueue)
        return this.enqueue(
          req,
          requestId,
          connector,
          capability,
          why,
          started,
          meta,
          op,
          selection,
        );
      return deny(kind, why, retryable, { ...meta, decision: decisionView });
    };
    const taken = this.d.limiter.take(connector.connectorId);
    if (!taken.ok)
      return unavailable(
        `${taken.reason}; retry in ${Math.ceil(taken.retryAfterMs / 1000)}s`,
        true,
        "RATE_LIMIT",
      );
    if (this.d.health.isOpen(connector.connectorId))
      return unavailable(
        `${connector.name} is temporarily unavailable (repeated failures)`,
        true,
        "NETWORK",
      );

    /* 8. Execute with retry by failure kind. */
    ledger.record("tool.authorized", {
      actor: who,
      projectId: req.projectId,
      agentId: req.agentId,
      taskId: req.taskId,
      toolId: hubToolId(capability),
      action: ACTION_OF[op],
      resource: actionReq.resource,
      risk: decision.risk.level,
      result: "AUTHORIZED",
      detail: {
        connectorId: connector.connectorId,
        approvalId: approvalId ?? "",
      },
    });
    let outcome: RestOutcome | undefined;
    let attempts = 0;
    for (;;) {
      attempts++;
      outcome = await this.executeOnce(
        connector,
        cap,
        resolved.params,
        req,
        resource,
        environment,
      );
      this.d.health.record(connector.connectorId, {
        ok: outcome.ok,
        ...(outcome.failure
          ? { kind: outcome.failure.kind, message: outcome.failure.message }
          : {}),
        latencyMs: outcome.durationMs,
        ...(outcome.rateLimit ? { rateLimit: outcome.rateLimit } : {}),
      });
      this.d.limiter.observe(
        connector.connectorId,
        outcome.rateLimit,
        outcome.failure?.kind === "RATE_LIMIT"
          ? (outcome.failure.retryAfterMs ?? 1000)
          : undefined,
      );
      if (outcome.ok || !outcome.failure) break;
      if (!shouldRetryCall(outcome.failure.kind, op, attempts)) break;
      await this.sleep(
        retryDelayMs(
          outcome.failure.kind,
          attempts,
          outcome.failure.retryAfterMs,
        ),
      );
    }
    this.recordUsage(req, connector, capability, outcome.durationMs);

    if (outcome.ok) {
      ledger.record("tool.executed", {
        actor: who,
        projectId: req.projectId,
        agentId: req.agentId,
        taskId: req.taskId,
        toolId: hubToolId(capability),
        action: ACTION_OF[op],
        resource: actionReq.resource,
        risk: decision.risk.level,
        result: "SUCCESS",
        detail: {
          connectorId: connector.connectorId,
          attempts,
          durationMs: outcome.durationMs,
        },
      });
      log("SUCCESS", {
        ...meta,
        operation: op,
        resource,
        risk: decision.risk.level,
        ...(approvalId ? { approvalId } : {}),
      });
      return result({
        success: true,
        ...meta,
        data: outcome.data ?? null,
        decision: decisionView,
        metadata: {
          durationMs: this.now() - started,
          attempts,
          operation: op,
          sandbox: connector.mode === "SANDBOX",
          ...(outcome.rateLimit ? { rateLimit: outcome.rateLimit } : {}),
          selection,
        },
      });
    }

    const failure = outcome.failure!;
    ledger.record("tool.failed", {
      actor: who,
      projectId: req.projectId,
      agentId: req.agentId,
      taskId: req.taskId,
      toolId: hubToolId(capability),
      resource: actionReq.resource,
      result: failure.kind,
      detail: {
        connectorId: connector.connectorId,
        attempts,
        message: failure.message.slice(0, 160),
      },
    });
    if (failure.kind === "AUTHENTICATION" || failure.kind === "AUTHORIZATION")
      this.noteCredentialFailure(connector, req, failure.kind);

    /* 9. Fallback — read-only operations, approved fallback mappings only, never a weaker connector. */
    if (
      FALLBACK_KINDS.includes(failure.kind) &&
      (op === "READ" || op === "DRAFT") &&
      !internal.fallbackFrom
    ) {
      const next = candidates
        .slice(1)
        .find(
          (c) =>
            c.mapping.role === "FALLBACK" &&
            c.connector.family === connector.family &&
            TRUST_RANK[c.connector.trust] >= TRUST_RANK[connector.trust] &&
            c.connector.mode === connector.mode,
        );
      if (next) {
        ledger.record("integration.fallback", {
          actor: "integration-hub",
          severity: "MEDIUM",
          projectId: req.projectId,
          agentId: req.agentId,
          result: "FALLBACK",
          detail: {
            from: connector.connectorId,
            to: next.connector.connectorId,
            capability,
          },
        });
        const fb = await this.invoke(
          { ...req, requestId, connectorId: next.connector.connectorId },
          { ...internal, fallbackFrom: connector.connectorId },
        );
        if (fb.success) return fb;
      }
    }
    if (
      cap.queueable &&
      !internal.skipQueue &&
      ["NETWORK", "TRANSIENT", "PROVIDER_ERROR"].includes(failure.kind)
    )
      return this.enqueue(
        req,
        requestId,
        connector,
        capability,
        failure.message,
        started,
        meta,
        op,
        selection,
      );
    log("FAILED", {
      ...meta,
      operation: op,
      resource,
      errorKind: failure.kind,
      risk: decision.risk.level,
      detail: failure.message.slice(0, 160),
    });
    return result({
      success: false,
      ...meta,
      error: {
        kind: failure.kind,
        message: failure.message,
        retryable: shouldRetryCall(failure.kind, op, 0),
      },
      decision: decisionView,
      metadata: {
        durationMs: this.now() - started,
        attempts,
        operation: op,
        ...(outcome.rateLimit ? { rateLimit: outcome.rateLimit } : {}),
        selection,
      },
    });
  }

  /* ------------------------------------------------------------------ */

  private rejectReason(
    c: HubConnector,
    projectId: string,
    _skip?: boolean,
  ): string | undefined {
    void projectId;
    void _skip;
    if (!c.enabled) return "not enabled";
    if (c.trust === "SUSPENDED" || c.trust === "DISABLED")
      return `trust is ${c.trust}`;
    if (c.status === "DISABLED") return "disabled";
    if (c.status === "DISCOVERED" || c.status === "DISCONNECTED")
      return `not connected (${c.status})`;
    if (c.status === "ERROR" && c.health.lastError?.kind === "AUTHENTICATION")
      return "authentication failed; reconnect it";
    return undefined;
  }

  private resolveResource(
    req: HubRequest,
    cap: RestCapability,
    mapping: ProjectIntegrationMapping,
    connector: HubConnector,
  ):
    | { resource: string; params: Record<string, unknown> }
    | { error: string; crossProject?: string; value?: string } {
    const mine = this.d.registry.mappingFor(
      req.projectId,
      connector.connectorId,
    );
    const supplied = req.resource?.trim();
    let resource: string;
    if (supplied) {
      const match = mine.find((m) => m.resource === supplied);
      if (!match && !(cap.account && mine.some((m) => m.resource === "*"))) {
        const owner = this.d.registry
          .mappings_()
          .find(
            (m) =>
              m.connectorId === connector.connectorId &&
              m.resource === supplied &&
              m.projectId !== req.projectId &&
              m.status === "ACTIVE",
          );
        return {
          error:
            "Project resource mismatch: that resource is not mapped to this project",
          ...(owner ? { crossProject: owner.projectId } : {}),
          value: supplied,
        };
      }
      resource = match?.resource ?? supplied;
    } else resource = mapping.resource;
    const params: Record<string, unknown> = { ...(req.parameters ?? {}) };
    if (cap.resourcePattern) {
      const m = cap.resourcePattern.exec(resource);
      if (!m?.groups)
        return {
          error: `the mapped resource "${resource}" does not match ${cap.resourceHint ?? "the expected format"}`,
        };
      Object.assign(params, m.groups);
    }
    return { resource, params };
  }

  private async executeOnce(
    connector: HubConnector,
    cap: RestCapability,
    params: Record<string, unknown>,
    req: HubRequest,
    resource: string,
    environment: GovEnvironment,
  ): Promise<RestOutcome> {
    const started = this.now();
    const fail = (kind: FailureKind, message: string): RestOutcome => ({
      ok: false,
      status: 0,
      failure: { kind, message },
      durationMs: this.now() - started,
    });
    const manifest = this.d.registry.manifest(connector.connectorId)!;
    try {
      if (cap.port === "deployment") {
        const exec = this.d.deployment;
        if (!exec?.available)
          return fail(
            "PERMANENT",
            "the deployment executor is not configured in this deployment; deployment is only ever a governed hand-off",
          );
        const input = {
          projectId: req.projectId,
          environment: String(req.parameters?.["environment"] ?? environment),
          resource,
        };
        const r =
          cap.operation === "DEPLOY"
            ? await exec.execute(input)
            : await exec.prepare(input);
        return {
          ok: true,
          status: 200,
          data: r,
          durationMs: this.now() - started,
        };
      }
      const baseUrl = connector.config.baseUrl ?? manifest.baseUrl ?? "";
      const call = (secret: import("./vault.js").Secret | undefined) =>
        callRest({
          manifest: {
            ...manifest,
            allowedHosts: this.d.registry.allowedHosts(connector.connectorId),
          },
          cap,
          baseUrl,
          params,
          secret,
          fetchImpl: this.d.fetchImpl,
          now: this.now,
        });
      if (manifest.authMethod === "none") return await call(undefined);
      if (
        manifest.authMethod === "oauth2" &&
        this.d.vault.has(CredentialVault.refFor(connector.connectorId))
      )
        return await this.d.oauth.accessToken(
          connector.connectorId,
          manifest.oauth,
          (s) => call(s),
        );
      const ref = this.d.vault.has(
        CredentialVault.refFor(connector.connectorId),
      )
        ? CredentialVault.refFor(connector.connectorId)
        : manifest.defaultCredentialRef;
      if (!ref)
        return fail(
          "AUTHENTICATION",
          "no credential is configured for this connector",
        );
      return await this.d.vault.use(
        ref,
        `${connector.connectorId}:${cap.capability}`,
        (s) => call(s),
      );
    } catch (error) {
      if (error instanceof VaultError)
        return fail("AUTHENTICATION", error.message);
      return fail("PERMANENT", "the connector failed unexpectedly");
    }
  }

  private noteCredentialFailure(
    c: HubConnector,
    req: HubRequest,
    kind: FailureKind,
  ): void {
    this.d.security.ledger.record("credential.failed", {
      actor: "integration-hub",
      severity: "MEDIUM",
      projectId: req.projectId,
      result: kind,
      detail: { connectorId: c.connectorId },
    });
    const recent =
      this.d.registry.get(c.connectorId)?.health.consecutiveFailures ?? 0;
    if (kind === "AUTHENTICATION" || recent >= 3)
      this.d.security.alerts.raise({
        severity: kind === "AUTHENTICATION" ? "HIGH" : "MEDIUM",
        source: "THREAT_DETECTOR",
        event:
          kind === "AUTHENTICATION"
            ? "integration_credential_failure"
            : "integration_authorization_failures",
        description: `${c.name} rejected our credentials (${kind.toLowerCase()}); the connector will not retry until it is reconnected.`,
        projectId: req.projectId,
        evidence: { connectorId: c.connectorId, kind },
        dedupeKey: `integration-credential:${c.connectorId}:${kind}`,
      });
  }

  private recordUsage(
    req: HubRequest,
    c: HubConnector,
    capability: string,
    durationMs: number,
  ): void {
    try {
      this.d.recordUsage?.({
        projectId: req.projectId,
        ...(req.taskId ? { taskId: req.taskId } : {}),
        ...(req.agentId ? { agentId: req.agentId } : {}),
        provider: c.connectorId,
        model: capability,
        cost: {
          priced: false,
          reason: `integration API call (${c.costClass.toLowerCase()}), ${durationMs} ms; not priced`,
        },
      });
    } catch {
      /* cost bookkeeping never fails a call */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Queue (safe operations only)                                        */
  /* ------------------------------------------------------------------ */

  private enqueue(
    req: HubRequest,
    requestId: string,
    connector: HubConnector,
    capability: string,
    why: string,
    started: number,
    meta: { connectorId: string; provider: string },
    op: OperationClass,
    selection: string[],
  ): HubResult {
    const open = this.queue.list().filter((q) => q.status === "QUEUED");
    if (open.length >= 200)
      return {
        success: false,
        requestId,
        capability,
        ...meta,
        metadata: {
          durationMs: this.now() - started,
          attempts: 0,
          operation: op,
          selection,
        },
        error: {
          kind: "NETWORK",
          message: "the provider is unavailable and the retry queue is full",
          retryable: true,
        },
      };
    const id = `q-${this.newId()}`;
    this.queue.upsert({
      id,
      request: { ...req, requestId },
      capability,
      connectorId: connector.connectorId,
      enqueuedAt: this.iso(),
      attempts: 0,
      nextAttemptAt: new Date(this.now() + 30_000).toISOString(),
      status: "QUEUED",
      lastError: maskSecrets(why).slice(0, 160),
    });
    this.d.security.ledger.record("integration.queued", {
      actor: "integration-hub",
      projectId: req.projectId,
      agentId: req.agentId,
      result: "QUEUED",
      detail: { connectorId: connector.connectorId, capability, queuedId: id },
    });
    this.activity.upsert({
      id: `act-${requestId}-QUEUED`,
      at: this.iso(),
      requestId,
      capability,
      projectId: req.projectId,
      ...(req.agentId ? { agentId: req.agentId } : {}),
      connectorId: connector.connectorId,
      provider: connector.provider,
      operation: op,
      outcome: "QUEUED",
      errorKind: "QUEUED",
      detail: why.slice(0, 160),
    });
    return {
      success: false,
      requestId,
      capability,
      ...meta,
      metadata: {
        durationMs: this.now() - started,
        attempts: 0,
        operation: op,
        queuedId: id,
        selection,
      },
      error: {
        kind: "QUEUED",
        message: `the provider is unavailable; the request was queued and will be retried (${why.slice(0, 100)})`,
        retryable: true,
      },
    };
  }

  queued(): QueuedRequest[] {
    return this.queue
      .list()
      .sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));
  }

  /** Retry due queue entries. Each is re-evaluated by the full pipeline; nothing is replayed blindly. */
  async drainQueue(
    max = 10,
  ): Promise<{
    attempted: number;
    done: number;
    failed: number;
    requeued: number;
  }> {
    let attempted = 0;
    let done = 0;
    let failed = 0;
    let requeued = 0;
    for (const q of this.queued()) {
      if (attempted >= max) break;
      if (q.status !== "QUEUED" || Date.parse(q.nextAttemptAt) > this.now())
        continue;
      attempted++;
      const r = await this.invoke(q.request, { skipQueue: true });
      if (r.success) {
        this.queue.upsert({ ...q, status: "DONE", attempts: q.attempts + 1 });
        done++;
      } else if (r.error?.retryable && q.attempts + 1 < 5) {
        this.queue.upsert({
          ...q,
          attempts: q.attempts + 1,
          nextAttemptAt: new Date(
            this.now() + 30_000 * 2 ** q.attempts,
          ).toISOString(),
          lastError: r.error.message.slice(0, 160),
        });
        requeued++;
      } else {
        // Kept for inspection, never silently dropped.
        this.queue.upsert({
          ...q,
          status: "FAILED",
          attempts: q.attempts + 1,
          lastError: r.error?.message.slice(0, 160) ?? "failed",
        });
        failed++;
      }
    }
    return { attempted, done, failed, requeued };
  }

  /* ------------------------------------------------------------------ */
  /* MCP                                                                 */
  /* ------------------------------------------------------------------ */

  private async invokeMcp(
    req: HubRequest,
    requestId: string,
    started: number,
    params: Record<string, unknown>,
  ): Promise<HubResult> {
    const ledger = this.d.security.ledger;
    const who = req.agentId ?? req.principalId ?? "unknown";
    const capability = req.capability;
    const fail = (
      kind: HubErrorKind,
      message: string,
      extra: Partial<HubResult> = {},
    ): HubResult => {
      ledger.record("tool.denied", {
        actor: who,
        projectId: req.projectId,
        agentId: req.agentId,
        toolId: hubToolId(capability),
        result: kind,
        detail: { reason: message.slice(0, 160) },
      });
      return {
        success: false,
        requestId,
        capability,
        metadata: { durationMs: this.now() - started, attempts: 0 },
        error: { kind, message, retryable: false },
        ...extra,
      };
    };
    if (!this.d.mcp)
      return fail("NOT_AVAILABLE", "no MCP gateway is configured");
    const resolved = this.d.mcp.resolve(capability, req.projectId);
    if (!resolved.ok) return fail("POLICY_DENIED", resolved.reason);
    const { server, tool, operation, risk } = resolved;
    const environment = req.environment ?? "DEVELOPMENT";
    const actionReq = {
      projectId: req.projectId,
      action: ACTION_OF[operation],
      resource: `integration:mcp.${server.serverId}/${tool}`,
      ...(req.agentId
        ? { agentId: req.agentId }
        : { principalId: req.principalId! }),
      ...(req.taskId ? { taskId: req.taskId } : {}),
      ...(req.taskType ? { taskType: req.taskType } : {}),
      toolId: hubToolId(capability),
      environment,
      command: `${capability} ${summarize(params)} #${hashOf(params)}`,
      ...(operation === "READ" ? {} : { content: JSON.stringify(params) }),
      expectedScope: [`integration:mcp.${server.serverId}/${tool}`],
    };
    // MCP tools get a tool-trust record on first sight: registered servers are not an automatic trust boundary.
    this.d.security.trust.setTool(
      {
        toolId: hubToolId(capability),
        name: capability,
        capabilities: [capability],
        risk,
        permissions: server.permissions,
        environments: ["DEVELOPMENT", "TEST", "STAGING", "PRODUCTION"],
        allowedAgents: ["*"],
        approval: operation === "READ" ? "NONE" : "ALWAYS",
        securityRequirements: [`mcp:${server.serverId}`],
        status: "ENABLED",
      },
      "integration-hub",
    );
    const d = this.d.security.governor.check(
      { ...actionReq, ...(req.dryRun ? { dryRun: true } : {}) },
      req.dryRun
        ? { record: "simulated", approvals: false, alerts: false }
        : { record: "real", approvals: true, alerts: true },
    );
    const view = {
      effect: d.effect,
      risk: d.risk.level,
      explanation: d.explanation,
    };
    if (d.effect === "DENY")
      return fail("POLICY_DENIED", d.reasons.at(-1) ?? "denied by policy", {
        decision: view,
      });
    const trustEscalate =
      (server.trust === "LIMITED" || server.trust === "REVIEW_REQUIRED") &&
      operation !== "READ";
    if (
      d.effect === "REQUIRE_APPROVAL" ||
      d.effect === "REQUIRE_SECURITY_REVIEW" ||
      d.effect === "REQUIRE_REVIEW" ||
      trustEscalate
    ) {
      let approvalId = d.approval?.approvalId;
      if (!approvalId && !req.dryRun) {
        const granted = this.d.security.approvals.approvedFor(actionReq);
        if (granted) {
          this.d.security.approvals.consume(granted);
        } else
          approvalId = this.d.security.approvals.request(actionReq, {
            ...d,
            effect: "REQUIRE_APPROVAL",
          }).approvalId;
      }
      if (approvalId || req.dryRun)
        return {
          success: false,
          requestId,
          capability,
          metadata: {
            durationMs: this.now() - started,
            attempts: 0,
            operation,
          },
          error: {
            kind: "APPROVAL_REQUIRED",
            message: `waiting for a human decision (${d.risk.level} risk)`,
            retryable: false,
            ...(approvalId ? { approvalId } : {}),
          },
          decision: view,
        };
    }
    if (req.dryRun)
      return {
        success: true,
        requestId,
        capability,
        metadata: { durationMs: this.now() - started, attempts: 0, operation },
        data: { simulated: true },
        decision: view,
      };
    const r = await this.d.mcp.call(server.serverId, tool, params);
    ledger.record(r.ok ? "tool.executed" : "tool.failed", {
      actor: who,
      projectId: req.projectId,
      agentId: req.agentId,
      toolId: hubToolId(capability),
      result: r.ok ? "SUCCESS" : (r.kind ?? "FAILED"),
      detail: { serverId: server.serverId },
    });
    this.activity.upsert({
      id: `act-${requestId}-${this.now()}`,
      at: this.iso(),
      requestId,
      capability,
      projectId: req.projectId,
      ...(req.agentId ? { agentId: req.agentId } : {}),
      connectorId: `mcp.${server.serverId}`,
      provider: server.provider,
      operation,
      outcome: r.ok ? "SUCCESS" : "FAILED",
      risk: d.risk.level,
      durationMs: this.now() - started,
    });
    return r.ok
      ? {
          success: true,
          requestId,
          capability,
          provider: server.provider,
          connectorId: `mcp.${server.serverId}`,
          data: r.data,
          decision: view,
          metadata: {
            durationMs: this.now() - started,
            attempts: 1,
            operation,
          },
        }
      : {
          success: false,
          requestId,
          capability,
          connectorId: `mcp.${server.serverId}`,
          metadata: {
            durationMs: this.now() - started,
            attempts: 1,
            operation,
          },
          error: {
            kind: r.kind ?? "PROVIDER_ERROR",
            message: r.message ?? "the MCP server failed",
            retryable: false,
          },
          decision: view,
        };
  }

  /* ------------------------------------------------------------------ */

  activityLog(
    filter: {
      projectId?: string;
      connectorId?: string;
      outcome?: string;
      limit?: number;
    } = {},
  ): ActivityRecord[] {
    return this.activity
      .list()
      .filter((a) => !filter.projectId || a.projectId === filter.projectId)
      .filter(
        (a) => !filter.connectorId || a.connectorId === filter.connectorId,
      )
      .filter((a) => !filter.outcome || a.outcome === filter.outcome)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, Math.min(filter.limit ?? 100, 500));
  }

  /** The secret-free view of a connection test: one cheap READ through the normal pipeline. */
  async testConnection(
    connectorId: string,
    by: string,
  ): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const c = this.d.registry.require(connectorId);
    const m = this.d.registry.manifest(connectorId)!;
    if (m.kind === "environment")
      return {
        ok: false,
        message: "environment boundaries have nothing to test",
        latencyMs: 0,
      };
    const probeCap = m.capabilities.find((x) => x.capability === m.probe);
    if (!probeCap) {
      const ok = c.auth.credentialConfigured;
      return {
        ok,
        message: ok
          ? "credential is configured (this connector has no probe)"
          : "no credential is stored",
        latencyMs: 0,
      };
    }
    // The probe runs directly (not as an agent action): it is the administrator's own test of the credential.
    const mapping = this.d.registry
      .mappings_()
      .find((x) => x.connectorId === connectorId && x.status === "ACTIVE");
    const params: Record<string, unknown> = {};
    if (probeCap.resourcePattern) {
      const m2 = mapping
        ? probeCap.resourcePattern.exec(mapping.resource)
        : null;
      if (!m2?.groups)
        return {
          ok: false,
          message:
            "map this connector to a project resource first; the probe needs one",
          latencyMs: 0,
        };
      Object.assign(params, m2.groups);
    }
    const outcome = await this.executeOnce(
      c,
      probeCap,
      params,
      {
        capability: probeCap.capability,
        projectId: mapping?.projectId ?? "-",
        principalId: by,
      },
      mapping?.resource ?? "*",
      "DEVELOPMENT",
    );
    this.d.health.record(connectorId, {
      ok: outcome.ok,
      ...(outcome.failure
        ? { kind: outcome.failure.kind, message: outcome.failure.message }
        : {}),
      latencyMs: outcome.durationMs,
      ...(outcome.rateLimit ? { rateLimit: outcome.rateLimit } : {}),
    });
    this.d.registry.setStep(
      connectorId,
      "TEST_CONNECTION",
      outcome.ok ? "DONE" : "FAILED",
      outcome.failure?.message,
    );
    this.d.registry.recompute(this.d.registry.require(connectorId));
    this.d.security.ledger.record("integration.tested", {
      actor: by,
      result: outcome.ok ? "OK" : (outcome.failure?.kind ?? "FAILED"),
      detail: { connectorId },
    });
    return {
      ok: outcome.ok,
      message: outcome.ok
        ? "the provider accepted the credential"
        : (outcome.failure?.message ?? "the test failed"),
      latencyMs: outcome.durationMs,
    };
  }
}
