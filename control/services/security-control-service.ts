/**
 * TrustControlService — governance, trust and security for the Control Center.
 *
 * Reads need `view` (and project access for anything project-scoped). Commands
 * need `manage_security` — except approval decisions (`approve`) — and the
 * sensitive ones are administrator-only: lifting a suspension, resuming after
 * an emergency stop, editing model/tool trust, closing HIGH/CRITICAL alerts,
 * accepting a configuration baseline. The UI is a client of this service; the
 * rules live in the governor, the approvals engine and the emergency stop.
 */
import {
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  operatorCan,
  operatorCanAccessProject,
  type CommandOptions,
  type ControlCommand,
  type ControlCommandResult,
  type ControlErrorKind,
  type OperatorPrincipal,
} from "../../contracts/index.js";
import {
  ACTION_CLASSES,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  GOV_ENVIRONMENTS,
  SECURITY_COMMANDS,
  TRUST_STATES,
  type ActionClass,
  type AlertStatus,
  type GovApprovalState,
  type GovEnvironment,
  type GovPolicy,
  type LedgerEntry,
  type SecurityAlert,
  type TrustState,
} from "../../contracts/security-governance.js";
import {
  AlertError,
  EmergencyError,
  GovernanceApprovalError,
  GovernanceError,
  HALT_BANNER,
  LocalNpmAuditRunner,
  type DependencyAuditRunner,
  type ProjectFileSource,
  type SecuritySystem,
} from "../../core/index.js";
import type { AuditLog } from "../../core/index.js";
import { resolveCorrelationId } from "../correlation.js";
import { redact } from "../redaction.js";

type Body = Record<string, unknown>;

export interface TrustControlDeps {
  security: SecuritySystem;
  audit: AuditLog;
  knownAgentIds: () => string[];
  projectExists: (projectId: string) => boolean;
  sourceFor?: (projectId: string) => Promise<ProjectFileSource | undefined>;
  /** A dependency audit runner for a project with a registered local workspace. */
  auditRunnerFor?: (
    projectId: string,
  ) => Promise<DependencyAuditRunner | undefined>;
  clock?: () => string;
}

const str = (v: unknown, name: string, required = true): string | undefined => {
  if (v === undefined || v === null || v === "") {
    if (required) throw new ValidationError(`${name} is required`);
    return undefined;
  }
  if (typeof v !== "string")
    throw new ValidationError(`${name} must be a string`);
  return v;
};
const one = <T extends string>(
  v: unknown,
  list: readonly T[],
  name: string,
  required = true,
): T | undefined => {
  if (v === undefined || v === null || v === "") {
    if (required) throw new ValidationError(`${name} is required`);
    return undefined;
  }
  if (typeof v !== "string" || !(list as readonly string[]).includes(v))
    throw new ValidationError(`${name} must be one of: ${list.join(", ")}`);
  return v as T;
};
const csv = <T extends string>(
  v: string | null,
  list: readonly T[],
  name: string,
): T[] | undefined =>
  v ? v.split(",").map((x) => one(x.trim(), list, name)!) : undefined;

export class TrustControlService {
  private readonly clock: () => string;
  private readonly s: SecuritySystem;

  constructor(private readonly deps: TrustControlDeps) {
    this.s = deps.security;
    this.clock = deps.clock ?? (() => new Date().toISOString());
  }

  private reader(p: OperatorPrincipal): void {
    if (!operatorCan(p, "view"))
      throw new PermissionDeniedError("insufficient capabilities");
  }
  private project(p: OperatorPrincipal, projectId: string | undefined): void {
    if (projectId !== undefined && !operatorCanAccessProject(p, projectId))
      throw new NotFoundError("project not found");
  }
  private visibleProject(
    p: OperatorPrincipal,
    projectId: string | undefined,
  ): boolean {
    return projectId === undefined || operatorCanAccessProject(p, projectId);
  }

  /* ---------------------------- reads ---------------------------- */

  overview(p: OperatorPrincipal, projectId?: string) {
    this.reader(p);
    this.project(p, projectId);
    this.s.approvals.expireStale();
    const emergency = this.s.emergency.record;
    return {
      banner: this.s.emergency.halted() ? HALT_BANNER : null,
      emergency,
      dashboard: this.s.dashboard(projectId),
      trustScore: this.s.trustScore(projectId),
      auditorFindings: this.s.auditor.run(),
      ledger: this.s.ledger.verify(),
      capabilities: {
        policyEngine: "deterministic (no model calls)",
        outboundNetworkDetection: false,
        dependencyScanning: Boolean(this.deps.auditRunnerFor),
        canManage: operatorCan(p, "manage_security"),
        isAdmin: p.role === "admin",
      },
      generatedAt: this.clock(),
    };
  }

  policies(p: OperatorPrincipal) {
    this.reader(p);
    return {
      layers: this.s.governor.layers(),
      policies: this.s.policies.all().map((x) => this.policyView(x)),
    };
  }

  private policyView(x: GovPolicy) {
    return {
      policyId: x.policyId,
      name: x.name,
      description: x.description,
      layer: x.layer,
      priority: x.priority,
      scope: x.scope,
      conditions: x.conditions,
      effect: x.effect,
      approvalRequirement: x.approvalRequirement ?? null,
      securityRequirement: x.securityRequirement ?? null,
      status: x.status,
      builtin: x.builtin,
      critical: x.critical,
      version: x.version,
      updatedAt: x.updatedAt,
      updatedBy: x.updatedBy,
    };
  }

  policy(p: OperatorPrincipal, policyId: string) {
    this.reader(p);
    const x = this.s.policies.get(policyId);
    if (!x) throw new NotFoundError("policy not found");
    return this.policyView(x);
  }

  trust(p: OperatorPrincipal) {
    this.reader(p);
    return {
      agents: this.s.trust.listAgents(this.deps.knownAgentIds()),
      models: this.s.trust.listModels(),
      defaultModelPolicy: this.s.trust.modelRecord("openai", "*"),
      tools: this.s.trust.listTools(),
      states: TRUST_STATES,
    };
  }

  approvals(p: OperatorPrincipal, params: URLSearchParams) {
    this.reader(p);
    const projectId = params.get("projectId") ?? undefined;
    this.project(p, projectId);
    this.s.approvals.expireStale();
    const state = csv(
      params.get("state"),
      [
        "PENDING",
        "APPROVED",
        "DENIED",
        "EXPIRED",
        "CANCELLED",
      ] as GovApprovalState[],
      "state",
    );
    return {
      approvals: this.s.approvals
        .list({
          ...(state ? { state } : {}),
          ...(projectId ? { projectId } : {}),
        })
        .filter((a) => this.visibleProject(p, a.projectId || undefined))
        .slice(0, 200),
    };
  }

  approval(p: OperatorPrincipal, id: string) {
    this.reader(p);
    const a = this.s.approvals.get(id);
    if (!a || !this.visibleProject(p, a.projectId || undefined))
      throw new NotFoundError("approval not found");
    return a;
  }

  alerts(p: OperatorPrincipal, params: URLSearchParams) {
    this.reader(p);
    const projectId = params.get("projectId") ?? undefined;
    this.project(p, projectId);
    const status = csv(params.get("status"), ALERT_STATUSES, "status");
    const severity = csv(params.get("severity"), ALERT_SEVERITIES, "severity");
    const rows = this.s.alerts
      .list({
        ...(status ? { status } : {}),
        ...(severity ? { severity } : {}),
        ...(projectId ? { projectId } : {}),
        ...(params.get("open") === "1" ? { openOnly: true } : {}),
      })
      .filter((a) => this.visibleProject(p, a.projectId));
    return { alerts: rows.slice(0, 300).map((a) => this.alertView(a)) };
  }

  private alertView(a: SecurityAlert) {
    return { ...a };
  }

  alert(p: OperatorPrincipal, id: string) {
    this.reader(p);
    const a = this.s.alerts.get(id);
    if (!a || !this.visibleProject(p, a.projectId))
      throw new NotFoundError("alert not found");
    return this.alertView(a);
  }

  /** Audit explorer: who, what, when, why (policy), result. */
  ledger(p: OperatorPrincipal, params: URLSearchParams) {
    this.reader(p);
    const projectId = params.get("projectId") ?? undefined;
    this.project(p, projectId);
    const limit = Number(params.get("limit") ?? "100");
    const rows = this.s.ledger
      .query({
        ...(projectId ? { projectId } : {}),
        ...(params.get("agentId") ? { agentId: params.get("agentId")! } : {}),
        ...(params.get("taskId") ? { taskId: params.get("taskId")! } : {}),
        ...(params.get("toolId") ? { toolId: params.get("toolId")! } : {}),
        ...(params.get("action") ? { action: params.get("action")! } : {}),
        ...(params.get("risk") ? { risk: params.get("risk")! } : {}),
        ...(params.get("policyId")
          ? { policyId: params.get("policyId")! }
          : {}),
        ...(params.get("result") ? { result: params.get("result")! } : {}),
        ...(params.get("operation")
          ? { operation: params.get("operation")! }
          : {}),
        ...(params.get("since") ? { since: params.get("since")! } : {}),
        ...(params.get("until") ? { until: params.get("until")! } : {}),
        limit: Number.isFinite(limit) ? limit : 100,
      })
      .filter((e) => this.visibleProject(p, e.projectId));
    return {
      entries: rows.map((e: LedgerEntry) => this.entryView(e)),
      verification: this.s.ledger.verify(),
    };
  }

  private entryView(e: LedgerEntry) {
    return {
      seq: e.seq,
      at: e.at,
      who: e.agentId ?? e.actor,
      actor: e.actor,
      what: `${e.operation}${e.action ? ` · ${e.action}` : ""}${e.resource ? ` · ${e.resource}` : ""}`,
      operation: e.operation,
      severity: e.severity ?? null,
      projectId: e.projectId ?? null,
      agentId: e.agentId ?? null,
      taskId: e.taskId ?? null,
      executionId: e.executionId ?? null,
      toolId: e.toolId ?? null,
      action: e.action ?? null,
      resource: e.resource ?? null,
      risk: e.risk ?? null,
      policyIds: e.policyIds ?? [],
      result: e.result,
      detail: e.detail,
      hash: e.hash.slice(0, 16),
    };
  }

  simulate(p: OperatorPrincipal, params: URLSearchParams) {
    this.reader(p);
    const projectId = str(params.get("projectId") ?? undefined, "projectId")!;
    this.project(p, projectId);
    const countN = params.get("count")
      ? Number(params.get("count"))
      : undefined;
    if (countN !== undefined && (!Number.isFinite(countN) || countN < 1))
      throw new ValidationError("count must be a positive number");
    const decision = this.s.governor.simulate({
      projectId,
      action: one(params.get("action"), ACTION_CLASSES, "action")!,
      resource: str(params.get("resource") ?? undefined, "resource")!.slice(
        0,
        300,
      ),
      ...(params.get("agentId")
        ? { agentId: params.get("agentId")! }
        : { principalId: p.id }),
      ...(params.get("taskType") ? { taskType: params.get("taskType")! } : {}),
      ...(params.get("environment")
        ? {
            environment: one(
              params.get("environment"),
              GOV_ENVIRONMENTS,
              "environment",
            )!,
          }
        : {}),
      ...(countN ? { count: countN } : {}),
      ...(params.get("toolId") ? { toolId: params.get("toolId")! } : {}),
    });
    return { decision, executed: false };
  }

  secrets(p: OperatorPrincipal) {
    this.reader(p);
    const week = Date.now() - 7 * 86_400_000;
    const detections = this.s.ledger
      .all()
      .filter(
        (e) => e.operation === "secret.detected" && Date.parse(e.at) >= week,
      );
    const envNames = ["OPENAI_API_KEY", "AI_WORKFORCE_GITHUB_READ_TOKEN"];
    return {
      detectionsThisProcess: this.s.secrets.detections,
      detections7d: detections.length,
      recent: detections
        .slice(-10)
        .reverse()
        .map((e) => this.entryView(e)),
      protections: [
        "Secrets in model prompts are blocked before sending and in model output are redacted",
        "Writes whose content carries a credential are denied by system policy",
        "Credential files (.env, keys) cannot be read or written by agents",
        "Terminal output, diffs, audit data and memory are masked before storage",
      ],
      configured: envNames.map((name) => ({
        name,
        configured: Boolean(process.env[name]),
      })),
      note: "Values are never shown. Only whether a server-side credential is configured.",
    };
  }

  async projectSecurity(p: OperatorPrincipal, projectId: string) {
    this.reader(p);
    this.project(p, projectId);
    const base = this.s.config.get(projectId);
    const scan = this.s.deps.latest(projectId);
    return {
      projectId,
      configBaseline: base
        ? {
            establishedAt: base.establishedAt,
            files: Object.keys(base.files).length,
            pending: base.pending,
            acceptedAt: base.acceptedAt ?? null,
          }
        : null,
      dependencyScan: scan ?? null,
      openAlerts: this.s.alerts.list({ openOnly: true, projectId }).length,
      drift7d: this.s.ledger.query({
        projectId,
        operation: "execution.drift_detected",
        limit: 200,
      }).length,
    };
  }

  /* --------------------------- commands -------------------------- */

  async execute(
    command: string,
    principal: OperatorPrincipal,
    body: Body,
    options?: CommandOptions,
  ): Promise<ControlCommandResult> {
    const correlationId = resolveCorrelationId(options);
    const resourceId =
      typeof body?.["agentId"] === "string"
        ? (body["agentId"] as string)
        : typeof body?.["approvalId"] === "string"
          ? (body["approvalId"] as string)
          : typeof body?.["policyId"] === "string"
            ? (body["policyId"] as string)
            : typeof body?.["alertId"] === "string"
              ? (body["alertId"] as string)
              : typeof body?.["projectId"] === "string"
                ? (body["projectId"] as string)
                : undefined;
    try {
      if (!(SECURITY_COMMANDS as readonly string[]).includes(command))
        throw new NotFoundError(`unknown command: ${command}`);
      const needsApprove =
        command === "security_decide_approval" ||
        command === "security_cancel_approval";
      if (
        needsApprove
          ? !operatorCan(principal, "approve")
          : !operatorCan(principal, "manage_security")
      )
        throw new PermissionDeniedError(
          `role "${principal.role}" may not run ${command}`,
        );
      const details = await this.run(command, principal, body ?? {});
      return this.result(
        principal,
        command as ControlCommand,
        "executed",
        undefined,
        "ok",
        resourceId,
        correlationId,
        details,
      );
    } catch (error) {
      const { outcome, kind } = classify(error);
      return this.result(
        principal,
        command as ControlCommand,
        outcome,
        kind,
        errorText(error),
        resourceId,
        correlationId,
        {},
      );
    }
  }

  private admin(p: OperatorPrincipal, what: string): void {
    if (p.role !== "admin")
      throw new PermissionDeniedError(`only an administrator may ${what}`);
  }

  private async run(
    command: string,
    p: OperatorPrincipal,
    b: Body,
  ): Promise<Record<string, unknown>> {
    const s = this.s;
    const isAdmin = p.role === "admin";
    switch (command) {
      case "security_set_agent_trust": {
        const agentId = str(b["agentId"], "agentId")!;
        const state = one(b["state"], TRUST_STATES, "state")!;
        s.governor.setAgentTrust(
          agentId,
          state as TrustState,
          p.id,
          isAdmin,
          str(b["reason"], "reason", false),
        );
        return { agentId, state };
      }
      case "security_set_model_trust": {
        this.admin(p, "change model trust");
        const provider = str(b["provider"], "provider")!;
        const model = str(b["model"], "model")!;
        const cur = s.trust.modelRecord(provider, model);
        const next = s.trust.setModel(
          {
            provider,
            model,
            riskClass:
              (b["riskClass"] as typeof cur.riskClass) ?? cur.riskClass,
            approvedTaskTypes: Array.isArray(b["approvedTaskTypes"])
              ? (b["approvedTaskTypes"] as unknown[]).filter(
                  (x): x is string => typeof x === "string",
                )
              : cur.approvedTaskTypes,
            maxDataClass:
              one(
                b["maxDataClass"],
                [
                  "PUBLIC",
                  "INTERNAL",
                  "CONFIDENTIAL",
                  "RESTRICTED",
                  "SECRET",
                ] as const,
                "maxDataClass",
                false,
              ) ?? cur.maxDataClass,
            external:
              typeof b["external"] === "boolean" ? b["external"] : cur.external,
            dataHandling:
              str(b["dataHandling"], "dataHandling", false) ?? cur.dataHandling,
            status: b["status"] === "DISABLED" ? "DISABLED" : "ENABLED",
          },
          p.id,
        );
        s.ledger.record("model.trust_changed", {
          actor: p.id,
          severity: "HIGH",
          result: next.status,
          detail: { model: next.id, maxDataClass: next.maxDataClass },
        });
        return { id: next.id };
      }
      case "security_set_tool_trust": {
        this.admin(p, "change tool trust");
        const toolId = str(b["toolId"], "toolId")!;
        const cur = s.trust.toolRecord(toolId);
        if (!cur) throw new NotFoundError("tool not found");
        const next = s.trust.setTool(
          {
            ...cur,
            approval:
              one(
                b["approval"],
                ["NONE", "HIGH_RISK", "ALWAYS"] as const,
                "approval",
                false,
              ) ?? cur.approval,
            status: b["status"] === "DISABLED" ? "DISABLED" : "ENABLED",
            allowedAgents: Array.isArray(b["allowedAgents"])
              ? (b["allowedAgents"] as unknown[]).filter(
                  (x): x is string => typeof x === "string",
                )
              : cur.allowedAgents,
          },
          p.id,
        );
        s.ledger.record("tool.trust_changed", {
          actor: p.id,
          severity: "HIGH",
          toolId,
          result: next.status,
        });
        return { toolId };
      }
      case "security_create_policy": {
        const created = s.policies.create(this.policyInput(b), p.id, isAdmin);
        s.ledger.record("policy.created", {
          actor: p.id,
          severity: "HIGH",
          result: created.effect,
          detail: { policyId: created.policyId, name: created.name },
        });
        return { policyId: created.policyId };
      }
      case "security_update_policy": {
        const policyId = str(b["policyId"], "policyId")!;
        const patch = this.policyInput(b, true);
        const next = s.policies.update(policyId, patch, p.id, isAdmin);
        s.ledger.record("policy.updated", {
          actor: p.id,
          severity: "HIGH",
          result: next.effect,
          detail: { policyId, version: next.version },
        });
        return { policyId, version: next.version };
      }
      case "security_set_policy_status": {
        const policyId = str(b["policyId"], "policyId")!;
        const status = one(
          b["status"],
          ["ENABLED", "DISABLED"] as const,
          "status",
        )!;
        const next = s.policies.setStatus(policyId, status, p.id, isAdmin);
        s.ledger.record("policy.status_changed", {
          actor: p.id,
          severity: "HIGH",
          result: status,
          detail: { policyId },
        });
        return { policyId, status: next.status };
      }
      case "security_decide_approval": {
        const decision = one(
          b["decision"],
          ["approve", "deny"] as const,
          "decision",
        )!;
        const v = s.approvals.decide(
          str(b["approvalId"], "approvalId")!,
          decision,
          p,
          str(b["note"], "note", false),
        );
        return {
          approvalId: v.approvalId,
          state: v.state,
          projectId: v.projectId,
        };
      }
      case "security_cancel_approval": {
        const v = s.approvals.cancel(str(b["approvalId"], "approvalId")!, p);
        return {
          approvalId: v.approvalId,
          state: v.state,
          projectId: v.projectId,
        };
      }
      case "security_alert_transition": {
        const a = s.alerts.transition(
          str(b["alertId"], "alertId")!,
          one(b["status"], ALERT_STATUSES, "status")! as AlertStatus,
          p.id,
          {
            admin: isAdmin,
            ...(typeof b["note"] === "string" ? { note: b["note"] } : {}),
          },
        );
        return {
          alertId: a.alertId,
          status: a.status,
          ...(a.projectId ? { projectId: a.projectId } : {}),
        };
      }
      case "security_emergency_stop": {
        const r = s.emergency.engage(p.id, str(b["reason"], "reason")!);
        return { state: r.state, banner: HALT_BANNER };
      }
      case "security_emergency_advance": {
        const to = one(
          b["to"],
          ["INVESTIGATING", "RECOVERY_REQUIRED"] as const,
          "to",
        )!;
        return {
          state: s.emergency.advance(p.id, to, str(b["note"], "note", false))
            .state,
        };
      }
      case "security_emergency_resume": {
        return {
          state: s.emergency.resume(p.id, isAdmin, str(b["note"], "note")!)
            .state,
        };
      }
      case "security_scan_config":
      case "security_accept_config": {
        const projectId = str(b["projectId"], "projectId")!;
        this.project(p, projectId);
        if (!this.deps.projectExists(projectId))
          throw new NotFoundError("project not found");
        const source = await this.deps.sourceFor?.(projectId);
        if (!source)
          throw new StateTransitionError(
            "no readable source is available for this project (no workspace is registered and no repository could be read)",
          );
        if (command === "security_accept_config") {
          this.admin(p, "accept a security configuration baseline");
          await s.config.accept(projectId, source, p.id);
          return { projectId, accepted: true };
        }
        const r = await s.config.scan(projectId, source, p.id);
        return {
          projectId,
          established: r.established,
          changes: r.changes.length,
          files: r.files,
        };
      }
      case "security_scan_dependencies": {
        const projectId = str(b["projectId"], "projectId")!;
        this.project(p, projectId);
        if (!this.deps.projectExists(projectId))
          throw new NotFoundError("project not found");
        const runner = await this.deps.auditRunnerFor?.(projectId);
        const r = await s.deps.scan(projectId, runner, p.id);
        if (!r.ok) throw new StateTransitionError(r.error);
        return { projectId, ...r.scan.counts };
      }
    }
    throw new NotFoundError(`unknown command: ${command}`);
  }

  private policyInput(b: Body, partial = false): Partial<GovPolicy> {
    const out: Partial<GovPolicy> = {};
    if (!partial || b["name"] !== undefined) out.name = str(b["name"], "name")!;
    if (b["description"] !== undefined)
      out.description = str(b["description"], "description", false) ?? "";
    if (!partial || b["layer"] !== undefined)
      out.layer = one(
        b["layer"],
        [
          "PROJECT_SECURITY",
          "PROJECT_ARCHITECTURE",
          "WORKFLOW",
          "TASK",
          "AGENT",
          "USER_REQUEST",
          "SYSTEM_SECURITY",
        ] as const,
        "layer",
      )!;
    if (!partial || b["effect"] !== undefined)
      out.effect = one(
        b["effect"],
        [
          "ALLOW",
          "REQUIRE_REVIEW",
          "REQUIRE_SECURITY_REVIEW",
          "REQUIRE_APPROVAL",
          "DENY",
        ] as const,
        "effect",
      )!;
    if (typeof b["priority"] === "number") out.priority = b["priority"];
    if (typeof b["critical"] === "boolean") out.critical = b["critical"];
    if (b["scope"] && typeof b["scope"] === "object")
      out.scope = b["scope"] as GovPolicy["scope"];
    if (b["conditions"] && typeof b["conditions"] === "object") {
      const c = b["conditions"] as Record<string, unknown>;
      const actions = Array.isArray(c["actions"])
        ? (c["actions"] as unknown[]).map((x) =>
            one(x, ACTION_CLASSES, "actions")!,
          )
        : undefined;
      const environments = Array.isArray(c["environments"])
        ? (c["environments"] as unknown[]).map((x) =>
            one(x, GOV_ENVIRONMENTS, "environments")!,
          )
        : undefined;
      out.conditions = {
        ...(actions ? { actions: actions as ActionClass[] } : {}),
        ...(environments
          ? { environments: environments as GovEnvironment[] }
          : {}),
        ...(Array.isArray(c["resourceKinds"])
          ? {
              resourceKinds: (c["resourceKinds"] as unknown[]).filter(
                (
                  x,
                ): x is GovPolicy["conditions"]["resourceKinds"] extends
                  (infer K)[] | undefined
                  ? K
                  : never => typeof x === "string",
              ),
            }
          : {}),
        ...(Array.isArray(c["resourceIncludes"])
          ? {
              resourceIncludes: (c["resourceIncludes"] as unknown[]).filter(
                (x): x is string => typeof x === "string",
              ),
            }
          : {}),
        ...(typeof c["minCount"] === "number"
          ? { minCount: c["minCount"] }
          : {}),
        ...(typeof c["minRisk"] === "string"
          ? {
              minRisk: one(
                c["minRisk"],
                ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const,
                "minRisk",
              )!,
            }
          : {}),
      };
    }
    if (
      typeof out.scope?.projectId === "string" &&
      !this.deps.projectExists(out.scope.projectId)
    )
      throw new NotFoundError("project not found");
    return out;
  }

  private result(
    principal: OperatorPrincipal,
    command: ControlCommand,
    outcome: ControlCommandResult["outcome"],
    errorKind: ControlErrorKind | undefined,
    reason: string,
    resourceId: string | undefined,
    correlationId: string,
    details: Record<string, unknown>,
  ): ControlCommandResult {
    const event = this.deps.audit.record("control_command", {
      projectId:
        typeof details["projectId"] === "string"
          ? details["projectId"]
          : undefined,
      data: {
        ...redact(details),
        command,
        outcome,
        errorKind,
        correlationId,
        actor: principal?.id ?? "unknown",
        actorRole: principal?.role ?? "unknown",
        resourceId,
        reason,
      },
    });
    return {
      command,
      outcome,
      ok: outcome === "executed",
      errorKind,
      reason,
      resourceId,
      correlationId,
      details: redact(details) as Record<string, unknown>,
      auditEventId: event.id,
      timestamp: this.clock(),
    };
  }
}

function classify(error: unknown): {
  outcome: ControlCommandResult["outcome"];
  kind: ControlErrorKind;
} {
  const code = (error as { code?: string })?.code;
  if (error instanceof PermissionDeniedError)
    return { outcome: "denied", kind: "forbidden" };
  if (
    error instanceof GovernanceError ||
    error instanceof GovernanceApprovalError ||
    error instanceof AlertError ||
    error instanceof EmergencyError
  ) {
    if (code === "forbidden") return { outcome: "denied", kind: "forbidden" };
    if (code === "not_found") return { outcome: "rejected", kind: "not_found" };
    if (code === "invalid_state")
      return { outcome: "rejected", kind: "invalid_state" };
    return { outcome: "rejected", kind: "invalid_request" };
  }
  if (error instanceof NotFoundError)
    return { outcome: "rejected", kind: "not_found" };
  if (error instanceof StateTransitionError)
    return { outcome: "rejected", kind: "invalid_state" };
  if (error instanceof ValidationError)
    return { outcome: "rejected", kind: "invalid_request" };
  return { outcome: "rejected", kind: "command_failure" };
}

function errorText(error: unknown): string {
  if (
    error instanceof PermissionDeniedError ||
    error instanceof NotFoundError ||
    error instanceof StateTransitionError ||
    error instanceof ValidationError ||
    error instanceof GovernanceError ||
    error instanceof GovernanceApprovalError ||
    error instanceof AlertError ||
    error instanceof EmergencyError
  )
    return error.message;
  return "the command failed";
}

export { LocalNpmAuditRunner };
