/**
 * Control services for Layers 9–13 (Extension Platform, Business Operating Layer, Portfolio
 * Intelligence, Autonomous Operations, Analytics). They are thin: authorization, project-scoped
 * filtering, input hand-off to the core services, and an audited command result. Reads need
 * `view` (and project access for project-bound data); commands need the layer's capability, and
 * the consequential ones are administrator-only. The browser's own checks are never trusted.
 */
import {
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  operatorCan,
  operatorCanAccessProject,
  type CommandOptions,
  type ControlCapability,
  type ControlCommand,
  type ControlCommandResult,
  type ControlErrorKind,
  type OperatorPrincipal,
} from "../../contracts/index.js";
import {
  EXTENSION_COMMANDS,
  EXTENSION_PERMISSION_CATALOG,
  EXTENSION_TYPE_SUPPORT,
} from "../../contracts/extension-platform.js";
import { BUSINESS_COMMANDS } from "../../contracts/business-layer.js";
import { PORTFOLIO_COMMANDS } from "../../contracts/portfolio-intelligence.js";
import {
  AUTONOMY_COMMANDS,
  AUTONOMY_LEVEL_INFO,
} from "../../contracts/autonomy.js";
import { ANALYTICS_COMMANDS } from "../../contracts/analytics-intelligence.js";
import type { WhatIfScenario } from "../../contracts/analytics-intelligence.js";
import type { InstanceState } from "../../contracts/autonomy.js";
import type { AuditLog } from "../../core/index.js";
import {
  AnalyticsError,
  type AnalyticsIntelligence,
} from "../../core/analytics-intelligence/service.js";
import {
  AutonomyError,
  type AutonomyEngine,
} from "../../core/autonomy/engine.js";
import { actionOf } from "../../core/autonomy/catalog.js";
import {
  BusinessError,
  type BusinessService,
} from "../../core/business/service.js";
import {
  ExtensionError,
  type ExtensionPlatform,
} from "../../core/extension-platform/registry.js";
import {
  PortfolioError,
  type PortfolioIntelligence,
} from "../../core/portfolio-intelligence/service.js";
import { resolveCorrelationId } from "../correlation.js";
import { redact } from "../redaction.js";

type Body = Record<string, unknown>;

const str = (v: unknown, name: string, max = 4000): string => {
  if (typeof v !== "string" || v.trim() === "")
    throw new ValidationError(`${name} is required`);
  if (v.length > max) throw new ValidationError(`${name} is too long`);
  return v;
};

function classify(error: unknown): {
  outcome: ControlCommandResult["outcome"];
  kind: ControlErrorKind;
} {
  if (error instanceof PermissionDeniedError)
    return { outcome: "denied", kind: "forbidden" };
  const code = (error as { code?: string } | undefined)?.code;
  const isDomain =
    error instanceof ExtensionError ||
    error instanceof BusinessError ||
    error instanceof PortfolioError ||
    error instanceof AutonomyError ||
    error instanceof AnalyticsError;
  if (isDomain) {
    if (code === "forbidden") return { outcome: "denied", kind: "forbidden" };
    if (code === "not_found") return { outcome: "rejected", kind: "not_found" };
    if (code === "invalid_state" || code === "conflict")
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
function messageOf(error: unknown): string {
  if (
    error instanceof Error &&
    [
      "PermissionDeniedError",
      "NotFoundError",
      "StateTransitionError",
      "ValidationError",
      "ExtensionError",
      "BusinessError",
      "PortfolioError",
      "AutonomyError",
      "AnalyticsError",
    ].includes(error.name)
  )
    return error.message;
  return "the command failed";
}

interface Common {
  audit: AuditLog;
  clock?: () => string;
}

abstract class Base {
  protected readonly clock: () => string;
  constructor(
    protected readonly common: Common,
    private readonly names: readonly string[],
    private readonly capability: ControlCapability,
  ) {
    this.clock = common.clock ?? (() => new Date().toISOString());
  }
  protected view(p: OperatorPrincipal): void {
    if (!operatorCan(p, "view"))
      throw new PermissionDeniedError("insufficient capabilities");
  }
  protected admin(p: OperatorPrincipal, what: string): void {
    if (p.role !== "admin")
      throw new PermissionDeniedError(`only an administrator may ${what}`);
  }
  protected access = (p: OperatorPrincipal) => (projectId: string) =>
    operatorCanAccessProject(p, projectId);
  protected needProject(
    p: OperatorPrincipal,
    projectId: string | undefined,
  ): void {
    if (projectId !== undefined && !operatorCanAccessProject(p, projectId))
      throw new NotFoundError("project not found");
  }
  protected abstract run(
    command: string,
    principal: OperatorPrincipal,
    body: Body,
  ): Promise<Record<string, unknown>>;

  async execute(
    command: string,
    principal: OperatorPrincipal,
    body: Body,
    options?: CommandOptions,
  ): Promise<ControlCommandResult> {
    const correlationId = resolveCorrelationId(options);
    const resourceId = [
      "extensionId",
      "id",
      "objectiveId",
      "instanceId",
      "projectId",
      "recommendationId",
      "departmentId",
    ]
      .map((k) => body?.[k])
      .find((v): v is string => typeof v === "string");
    try {
      if (!this.names.includes(command))
        throw new NotFoundError(`unknown command: ${command}`);
      if (!operatorCan(principal, this.capability))
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
        messageOf(error),
        resourceId,
        correlationId,
        {},
      );
    }
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
    const event = this.common.audit.record("control_command", {
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

/* ============================== Layer 9 ============================== */

export class ExtensionControlService extends Base {
  constructor(
    common: Common,
    private readonly platform: ExtensionPlatform,
  ) {
    super(common, EXTENSION_COMMANDS, "manage_extensions");
  }
  overview(p: OperatorPrincipal) {
    this.view(p);
    const list = this.platform.list();
    const count = (h: string) => list.filter((x) => x.health === h).length;
    return {
      extensions: list,
      summary: {
        total: list.length,
        installed: count("INSTALLED"),
        active: count("ACTIVE"),
        disabled: count("DISABLED"),
        incompatible: count("INCOMPATIBLE"),
        failed: count("FAILED"),
        updateAvailable: count("UPDATE_AVAILABLE"),
      },
      types: Object.entries(EXTENSION_TYPE_SUPPORT).map(([type, v]) => ({
        type,
        ...v,
      })),
      permissions: EXTENSION_PERMISSION_CATALOG,
      recentAudit: this.platform.audit(undefined, 20),
      generatedAt: this.clock(),
    };
  }
  extension(p: OperatorPrincipal, id: string) {
    this.view(p);
    const view = this.platform.get(id);
    const rec = this.platform.record(id);
    return {
      ...view,
      manifests:
        rec?.versions.map((v) => ({
          version: v.version,
          manifest: v.manifest,
          test: v.test ?? null,
          review: v.review ?? null,
        })) ?? [],
      dependents: this.platform.dependentsOf(id),
      audit: this.platform.audit(id, 50),
    };
  }
  audit(p: OperatorPrincipal, extensionId?: string) {
    this.view(p);
    return { events: this.platform.audit(extensionId, 200) };
  }
  protected async run(
    command: string,
    p: OperatorPrincipal,
    b: Body,
  ): Promise<Record<string, unknown>> {
    const pl = this.platform;
    const id = () => str(b["extensionId"], "extensionId", 80);
    switch (command) {
      case "extension_register": {
        this.admin(p, "register an extension");
        const v = pl.register(b["manifest"], p.id);
        return { extensionId: v.extensionId, health: v.health };
      }
      case "extension_register_version": {
        this.admin(p, "register an extension version");
        const v = pl.registerVersion(b["manifest"], p.id);
        return { extensionId: v.extensionId, latestVersion: v.latestVersion };
      }
      case "extension_test": {
        const v = pl.test(
          id(),
          p.id,
          typeof b["version"] === "string" ? b["version"] : undefined,
        );
        return {
          extensionId: v.extensionId,
          tested: v.versions.at(-1)?.tested ?? null,
        };
      }
      case "extension_review": {
        const v = pl.review(
          id(),
          p.id,
          typeof b["version"] === "string" ? b["version"] : undefined,
        );
        return {
          extensionId: v.extensionId,
          review: v.versions.at(-1)?.review ?? null,
        };
      }
      case "extension_approve_review": {
        this.admin(p, "approve a security review");
        const v = pl.approveReview(
          id(),
          p.id,
          typeof b["version"] === "string" ? b["version"] : undefined,
        );
        return { extensionId: v.extensionId };
      }
      case "extension_grant_permission": {
        this.admin(p, "grant a permission to an extension");
        const v = pl.grant(id(), str(b["scope"], "scope", 80), p.id);
        return { extensionId: v.extensionId, granted: v.grantedPermissions };
      }
      case "extension_revoke_permission": {
        const v = pl.revoke(id(), str(b["scope"], "scope", 80), p.id);
        return { extensionId: v.extensionId, granted: v.grantedPermissions };
      }
      case "extension_enable": {
        this.admin(p, "enable an extension");
        const v = pl.enable(id(), p.id, {
          ...(typeof b["version"] === "string"
            ? { version: b["version"] }
            : {}),
          acknowledgeBreaking: b["acknowledgeBreaking"] === true,
        });
        return {
          extensionId: v.extensionId,
          activeVersion: v.activeVersion ?? "",
          health: v.health,
        };
      }
      case "extension_disable": {
        const v = pl.disable(id(), p.id);
        return { extensionId: v.extensionId, status: v.status };
      }
      case "extension_rollback": {
        this.admin(p, "roll an extension back");
        const v = pl.rollback(id(), str(b["version"], "version", 20), p.id);
        return {
          extensionId: v.extensionId,
          activeVersion: v.activeVersion ?? "",
        };
      }
      case "extension_configure": {
        const v = pl.configure(
          id(),
          (b["config"] && typeof b["config"] === "object"
            ? b["config"]
            : {}) as Body,
          p.id,
        );
        return { extensionId: v.extensionId, config: v.config };
      }
      case "extension_remove": {
        this.admin(p, "remove an extension");
        pl.remove(id(), p.id);
        return { extensionId: id() };
      }
    }
    throw new NotFoundError(`unknown command: ${command}`);
  }
}

/* ============================== Layer 10 ============================== */

export class BusinessControlService extends Base {
  constructor(
    common: Common,
    private readonly business: BusinessService,
  ) {
    super(common, BUSINESS_COMMANDS, "manage_business");
  }
  overview(p: OperatorPrincipal) {
    this.view(p);
    return {
      board: this.business.board(),
      organization: this.business.organization(),
      departments: this.business.listDepartments(),
    };
  }
  objectives(p: OperatorPrincipal, params: URLSearchParams) {
    this.view(p);
    const projectId = params.get("projectId") ?? undefined;
    this.needProject(p, projectId);
    const acc = this.access(p);
    return {
      objectives: this.business
        .listObjectives({
          ...(params.get("status")
            ? { status: params.get("status") as never }
            : {}),
          ...(projectId ? { projectId } : {}),
        })
        .filter((o) => !o.projectId || acc(o.projectId))
        .map((o) => ({ ...o, kpiStatus: this.business.kpiStatuses(o) })),
    };
  }
  objective(p: OperatorPrincipal, id: string) {
    this.view(p);
    const o = this.business.objective(id);
    this.needProject(p, o.projectId);
    return {
      ...o,
      kpiStatus: this.business.kpiStatuses(o),
      initiatives: this.business.listInitiatives(id),
      decisions: this.business.listDecisions({ objectiveId: id }),
    };
  }
  initiatives(p: OperatorPrincipal, objectiveId?: string) {
    this.view(p);
    const acc = this.access(p);
    return {
      initiatives: this.business
        .listInitiatives(objectiveId)
        .filter((i) => i.projectIds.every(acc)),
    };
  }
  decisions(p: OperatorPrincipal, params: URLSearchParams) {
    this.view(p);
    const projectId = params.get("projectId") ?? undefined;
    this.needProject(p, projectId);
    const acc = this.access(p);
    return {
      decisions: this.business
        .listDecisions({
          ...(projectId ? { projectId } : {}),
          ...(params.get("objectiveId")
            ? { objectiveId: params.get("objectiveId")! }
            : {}),
        })
        .filter((d) => !d.links.projectId || acc(d.links.projectId)),
    };
  }
  protected async run(
    command: string,
    p: OperatorPrincipal,
    b: Body,
  ): Promise<Record<string, unknown>> {
    const s = this.business;
    const acc = this.access(p);
    const proj = (v: unknown) => {
      if (typeof v === "string" && v) this.needProject(p, v);
    };
    switch (command) {
      case "business_configure":
        this.admin(p, "change the business profile");
        return { name: s.configure(b, p.id).name };
      case "business_create_department":
        return { departmentId: s.createDepartment(b, p.id).departmentId };
      case "business_update_department":
        return {
          departmentId: s.updateDepartment(
            str(b["departmentId"], "departmentId"),
            b,
            p.id,
          ).departmentId,
        };
      case "business_archive_department":
        this.admin(p, "archive a department");
        return {
          departmentId: s.archiveDepartment(
            str(b["departmentId"], "departmentId"),
            p.id,
          ).departmentId,
        };
      case "business_assign_agent":
        return {
          departmentId: s.assignAgent(
            str(b["departmentId"], "departmentId"),
            str(b["agentId"], "agentId"),
            p.id,
          ).departmentId,
        };
      case "business_unassign_agent":
        return {
          departmentId: s.unassignAgent(
            str(b["departmentId"], "departmentId"),
            str(b["agentId"], "agentId"),
            p.id,
          ).departmentId,
        };
      case "business_set_manager":
        return {
          departmentId: s.setManager(
            str(b["departmentId"], "departmentId"),
            b,
            p.id,
          ).departmentId,
        };
      case "business_link_department_project":
        proj(b["projectId"]);
        return {
          departmentId: s.linkProject(
            str(b["departmentId"], "departmentId"),
            str(b["projectId"], "projectId"),
            p.id,
          ).departmentId,
        };
      case "business_create_objective":
        proj(b["projectId"]);
        return { objectiveId: s.createObjective(b, p.id).objectiveId };
      case "business_update_objective": {
        const o = s.objective(str(b["objectiveId"], "objectiveId"));
        proj(o.projectId);
        return {
          objectiveId: s.updateObjective(o.objectiveId, b, p.id).objectiveId,
        };
      }
      case "business_set_objective_status": {
        const o = s.objective(str(b["objectiveId"], "objectiveId"));
        proj(o.projectId);
        return {
          objectiveId: s.setObjectiveStatus(o.objectiveId, b["status"], p.id)
            .objectiveId,
        };
      }
      case "business_add_kpi": {
        const o = s.objective(str(b["objectiveId"], "objectiveId"));
        proj(o.projectId);
        proj(b["projectId"]);
        return { objectiveId: s.addKpi(o.objectiveId, b, p.id).objectiveId };
      }
      case "business_record_kpi_reading": {
        const o = s.objective(str(b["objectiveId"], "objectiveId"));
        proj(o.projectId);
        return {
          objectiveId: s.recordReading(
            o.objectiveId,
            str(b["kpiId"], "kpiId"),
            b["value"],
            b["note"],
            p.id,
          ).objectiveId,
        };
      }
      case "business_create_initiative": {
        const o = s.objective(str(b["objectiveId"], "objectiveId"));
        proj(o.projectId);
        if (Array.isArray(b["projectIds"]))
          for (const x of b["projectIds"]) proj(x);
        return { initiativeId: s.createInitiative(b, p.id).initiativeId };
      }
      case "business_set_initiative_status":
        return {
          initiativeId: s.setInitiativeStatus(
            str(b["initiativeId"], "initiativeId"),
            b["status"],
            p.id,
          ).initiativeId,
        };
      case "business_propose_plan": {
        const i = s.initiative(str(b["initiativeId"], "initiativeId"));
        if (!i.projectIds.every(acc))
          throw new NotFoundError("project not found");
        proj(b["projectId"]);
        const plan = s.proposePlan(i.initiativeId, b, p.id);
        return {
          initiativeId: i.initiativeId,
          planId: plan.planId,
          needsProject: plan.needsProject,
          tasks: plan.tasks.length,
        };
      }
      case "business_decide_plan": {
        this.admin(p, "approve or reject an execution plan");
        const decision =
          b["decision"] === "APPROVED" || b["decision"] === "REJECTED"
            ? b["decision"]
            : undefined;
        if (!decision)
          throw new ValidationError("decision must be APPROVED or REJECTED");
        const i = s.decidePlan(
          str(b["initiativeId"], "initiativeId"),
          str(b["planId"], "planId"),
          decision,
          p.id,
        );
        return { initiativeId: i.initiativeId, decision };
      }
      case "business_record_decision":
        proj(b["projectId"]);
        return { decisionId: s.recordDecision(b, p.id).decisionId };
      case "business_adopt_decision":
        this.admin(p, "adopt a decision");
        return {
          decisionId: s.adoptDecision(str(b["decisionId"], "decisionId"), p.id)
            .decisionId,
        };
      case "business_supersede_decision": {
        this.admin(p, "supersede a decision");
        const r = s.supersedeDecision(
          str(b["decisionId"], "decisionId"),
          (b["replacement"] && typeof b["replacement"] === "object"
            ? b["replacement"]
            : {}) as Body,
          p.id,
        );
        return { decisionId: r.next.decisionId, supersedes: r.old.decisionId };
      }
    }
    throw new NotFoundError(`unknown command: ${command}`);
  }
}

/* ============================== Layer 11 ============================== */

export class PortfolioIntelligenceControlService extends Base {
  constructor(
    common: Common,
    private readonly portfolio: PortfolioIntelligence,
  ) {
    super(common, PORTFOLIO_COMMANDS, "manage_portfolio");
  }
  dashboard(p: OperatorPrincipal) {
    this.view(p);
    return this.portfolio.dashboard(this.access(p));
  }
  projects(p: OperatorPrincipal, includeArchived = false) {
    this.view(p);
    return {
      projects: this.portfolio.summaries(this.access(p), includeArchived),
    };
  }
  project(p: OperatorPrincipal, id: string) {
    this.view(p);
    return this.portfolio.summary(id, this.access(p));
  }
  health(p: OperatorPrincipal, id: string) {
    this.view(p);
    return this.portfolio.health(id, this.access(p));
  }
  priorities(p: OperatorPrincipal) {
    this.view(p);
    return {
      ranking: this.portfolio.priorities(this.access(p)),
      note: "A recommendation only. Priorities are never changed automatically.",
    };
  }
  conflicts(p: OperatorPrincipal) {
    this.view(p);
    return {
      conflicts: this.portfolio.conflicts(this.access(p)),
      claims: this.portfolio.listClaims(this.access(p)),
    };
  }
  dependencies(p: OperatorPrincipal) {
    this.view(p);
    return { dependencies: this.portfolio.listDependencies(this.access(p)) };
  }
  ask(p: OperatorPrincipal, question: string) {
    this.view(p);
    return this.portfolio.ask(question, this.access(p));
  }
  knowledge(p: OperatorPrincipal) {
    this.view(p);
    return { items: this.portfolio.reusableKnowledge(this.access(p)) };
  }
  protected async run(
    command: string,
    p: OperatorPrincipal,
    b: Body,
  ): Promise<Record<string, unknown>> {
    const s = this.portfolio;
    const acc = this.access(p);
    switch (command) {
      case "portfolio_set_profile": {
        const projectId = str(b["projectId"], "projectId", 120);
        this.needProject(p, projectId);
        return { projectId: s.setProfile(projectId, b, p.id).projectId };
      }
      case "portfolio_archive_project":
      case "portfolio_restore_project": {
        const projectId = str(b["projectId"], "projectId", 120);
        this.needProject(p, projectId);
        return {
          projectId: s.setArchived(
            projectId,
            command === "portfolio_archive_project",
            p.id,
          ).projectId,
        };
      }
      case "portfolio_add_dependency": {
        const d = s.addDependency(b, p.id, acc);
        return { dependencyId: d.id, from: d.from, to: d.to };
      }
      case "portfolio_remove_dependency":
        s.removeDependency(str(b["dependencyId"], "dependencyId"), p.id, acc);
        return { dependencyId: b["dependencyId"] as string };
      case "portfolio_claim_resource": {
        const c = s.claim(b, p.id, acc);
        return { claimId: c.id, projectId: c.projectId };
      }
      case "portfolio_release_resource":
        s.release(str(b["claimId"], "claimId"), p.id, acc);
        return { claimId: b["claimId"] as string };
    }
    throw new NotFoundError(`unknown command: ${command}`);
  }
}

/* ============================== Layer 12 ============================== */

export class AutonomyControlService extends Base {
  constructor(
    common: Common,
    private readonly engine: AutonomyEngine,
  ) {
    super(common, AUTONOMY_COMMANDS, "manage_autonomy");
  }
  operations(p: OperatorPrincipal) {
    this.view(p);
    return this.engine.operations(this.access(p));
  }
  instances(p: OperatorPrincipal, params: URLSearchParams) {
    this.view(p);
    const projectId = params.get("projectId") ?? undefined;
    this.needProject(p, projectId);
    const states = params.get("states")?.split(",").filter(Boolean) as
      InstanceState[] | undefined;
    return {
      instances: this.engine
        .list({
          ...(projectId ? { projectId } : {}),
          ...(states ? { states } : {}),
        })
        .filter((i) => this.access(p)(i.projectId)),
    };
  }
  instance(p: OperatorPrincipal, id: string) {
    this.view(p);
    const i = this.engine.get(id);
    this.needProject(p, i.projectId);
    return {
      instance: i,
      audit: this.engine.auditTrail({ instanceId: id, limit: 100 }),
    };
  }
  catalog(p: OperatorPrincipal) {
    this.view(p);
    return {
      levels: Object.entries(AUTONOMY_LEVEL_INFO).map(([level, v]) => ({
        level: Number(level),
        ...v,
      })),
      actions: this.engine.actions(),
      definitions: this.engine.listDefinitions(),
      rules: this.engine.listRules().filter((r) => this.access(p)(r.projectId)),
      settings: this.engine
        .listSettings()
        .filter((s) => this.access(p)(s.projectId)),
      global: this.engine.globalState(),
    };
  }
  levelFor(p: OperatorPrincipal, projectId: string) {
    this.view(p);
    this.needProject(p, projectId);
    return this.engine.settingOf(projectId);
  }
  audit(p: OperatorPrincipal, params: URLSearchParams) {
    this.view(p);
    const projectId = params.get("projectId") ?? undefined;
    this.needProject(p, projectId);
    return {
      events: this.engine
        .auditTrail({
          ...(projectId ? { projectId } : {}),
          ...(params.get("instanceId")
            ? { instanceId: params.get("instanceId")! }
            : {}),
          limit: Number(params.get("limit") ?? "100") || 100,
        })
        .filter((e) => !e.projectId || this.access(p)(e.projectId)),
    };
  }
  protected async run(
    command: string,
    p: OperatorPrincipal,
    b: Body,
  ): Promise<Record<string, unknown>> {
    const e = this.engine;
    const instance = (): ReturnType<AutonomyEngine["get"]> => {
      const i = e.get(str(b["instanceId"], "instanceId"));
      this.needProject(p, i.projectId);
      return i;
    };
    switch (command) {
      case "autonomy_set_level": {
        // Changing how much runs without asking is the owner's decision, never an operator's or a workflow's.
        this.admin(p, "change an autonomy level");
        const projectId = str(b["projectId"], "projectId", 120);
        this.needProject(p, projectId);
        const s = e.setLevel(projectId, b["level"], p.id, {
          confirmHighest: b["confirmHighest"] === true,
          ...(typeof b["note"] === "string" ? { note: b["note"] } : {}),
        });
        return { projectId, level: s.level };
      }
      case "autonomy_pause_all":
        e.pauseAll(
          p.id,
          typeof b["reason"] === "string"
            ? b["reason"]
            : "paused by the operator",
        );
        return { paused: true };
      case "autonomy_resume_all":
        this.admin(p, "resume autonomous operation");
        e.resumeAll(p.id);
        return { paused: false };
      case "autonomy_create_definition":
        this.admin(p, "create an autonomous workflow definition");
        return { definitionId: e.createDefinition(b, p.id).definitionId };
      case "autonomy_add_rule": {
        this.admin(p, "add an automatic trigger");
        const projectId = str(b["projectId"], "projectId", 120);
        this.needProject(p, projectId);
        return { ruleId: e.addRule(b, p.id).ruleId };
      }
      case "autonomy_set_rule_enabled": {
        const rule = e.listRules().find((r) => r.ruleId === b["ruleId"]);
        if (!rule) throw new NotFoundError("rule not found");
        this.needProject(p, rule.projectId);
        if (b["enabled"] === true) this.admin(p, "enable an automatic trigger");
        return {
          ruleId: e.setRuleEnabled(rule.ruleId, b["enabled"] === true, p.id)
            .ruleId,
        };
      }
      case "autonomy_trigger": {
        const projectId = str(b["projectId"], "projectId", 120);
        this.needProject(p, projectId);
        const inst = await e.create(
          str(b["definitionId"], "definitionId", 80),
          projectId,
          {
            source: "user_command",
            summary:
              typeof b["summary"] === "string" && b["summary"]
                ? b["summary"].slice(0, 200)
                : "started by the owner",
            by: p.id,
          },
        );
        return { instanceId: inst.instanceId, projectId, state: inst.state };
      }
      case "autonomy_approve_plan": {
        this.admin(p, "approve a workflow plan");
        const i = instance();
        return {
          instanceId: e.approvePlan(i.instanceId, p.id).instanceId,
          projectId: i.projectId,
        };
      }
      case "autonomy_start": {
        const i = instance();
        const r = await e.start(i.instanceId, p.id);
        return {
          instanceId: r.instanceId,
          projectId: i.projectId,
          state: r.state,
        };
      }
      case "autonomy_decide_step": {
        const i = instance();
        const decision = b["decision"];
        if (
          decision !== "APPROVE" &&
          decision !== "REJECT" &&
          decision !== "EDIT" &&
          decision !== "CANCEL"
        )
          throw new ValidationError(
            "decision must be APPROVE, REJECT, EDIT or CANCEL",
          );
        const step = i.steps.find((s) => s.stepId === b["stepId"]);
        const action = step ? actionOf(step.actionId) : undefined;
        // High-risk and restricted actions are the owner's call.
        if (
          decision === "APPROVE" &&
          step &&
          (step.risk === "HIGH" ||
            step.risk === "CRITICAL" ||
            action?.restricted !== false)
        )
          this.admin(p, "approve a high-risk or restricted action");
        const r = await e.decideStep(
          i.instanceId,
          str(b["stepId"], "stepId", 60),
          decision,
          p.id,
          b["edit"] && typeof b["edit"] === "object"
            ? (b["edit"] as Body)
            : undefined,
        );
        return {
          instanceId: r.instanceId,
          projectId: i.projectId,
          state: r.state,
        };
      }
      case "autonomy_cancel": {
        const i = instance();
        return {
          instanceId: e.cancel(i.instanceId, p.id).instanceId,
          projectId: i.projectId,
        };
      }
      case "autonomy_rollback": {
        this.admin(p, "roll a workflow back");
        const i = instance();
        const r = await e.rollback(i.instanceId, p.id);
        return {
          instanceId: i.instanceId,
          projectId: i.projectId,
          results: r.results,
        };
      }
      case "autonomy_tick":
        return { ...(await e.tick()) };
    }
    throw new NotFoundError(`unknown command: ${command}`);
  }
}

/* ============================== Layer 13 ============================== */

export class AnalyticsControlService extends Base {
  constructor(
    common: Common,
    private readonly analytics: AnalyticsIntelligence,
  ) {
    super(common, ANALYTICS_COMMANDS, "manage_analytics");
  }
  overview(p: OperatorPrincipal) {
    this.view(p);
    return this.analytics.overview(this.access(p));
  }
  agents(p: OperatorPrincipal) {
    this.view(p);
    return { agents: this.analytics.agents(this.access(p)) };
  }
  workflows(p: OperatorPrincipal, projectId?: string) {
    this.view(p);
    this.needProject(p, projectId);
    return this.analytics.workflows(this.access(p), projectId);
  }
  project(p: OperatorPrincipal, projectId: string) {
    this.view(p);
    return this.analytics.project(projectId, this.access(p));
  }
  cost(p: OperatorPrincipal, projectId?: string) {
    this.view(p);
    this.needProject(p, projectId);
    return this.analytics.cost(this.access(p), projectId);
  }
  bottlenecks(p: OperatorPrincipal) {
    this.view(p);
    return { bottlenecks: this.analytics.bottlenecks(this.access(p)) };
  }
  predictions(p: OperatorPrincipal) {
    this.view(p);
    return {
      predictions: this.analytics.predictions(this.access(p)),
      note: "Predictions are ranges with a label, never certainties.",
    };
  }
  recommendations(p: OperatorPrincipal, status?: string) {
    this.view(p);
    return {
      recommendations: this.analytics.listRecommendations(
        this.access(p),
        status as never,
      ),
    };
  }
  lessons(p: OperatorPrincipal) {
    this.view(p);
    return { lessons: this.analytics.listLessons(this.access(p)) };
  }
  protected async run(
    command: string,
    p: OperatorPrincipal,
    b: Body,
  ): Promise<Record<string, unknown>> {
    const a = this.analytics;
    const acc = this.access(p);
    switch (command) {
      case "analytics_refresh_recommendations":
        return { count: a.refreshRecommendations(acc, p.id).length };
      case "analytics_decide_recommendation": {
        this.admin(p, "approve or reject a recommendation");
        const decision =
          b["decision"] === "APPROVED" || b["decision"] === "REJECTED"
            ? b["decision"]
            : undefined;
        if (!decision)
          throw new ValidationError("decision must be APPROVED or REJECTED");
        const r = a.decide(
          str(b["recommendationId"], "recommendationId", 60),
          decision,
          p.id,
          acc,
        );
        return { recommendationId: r.recommendationId, status: r.status };
      }
      case "analytics_mark_applied": {
        this.admin(p, "record that a recommendation was applied");
        const r = a.markApplied(
          str(b["recommendationId"], "recommendationId", 60),
          typeof b["note"] === "string" ? b["note"] : "",
          p.id,
          acc,
        );
        return { recommendationId: r.recommendationId, status: r.status };
      }
      case "analytics_measure_recommendation": {
        const r = a.measure(
          str(b["recommendationId"], "recommendationId", 60),
          acc,
        );
        return {
          recommendationId: r.recommendationId,
          verdict: r.measurement?.verdict ?? "NO_DATA",
        };
      }
      case "analytics_run_what_if": {
        const sc = b["scenario"] as WhatIfScenario | undefined;
        if (
          !sc ||
          typeof sc !== "object" ||
          !["PRIORITIZE", "PAUSE_PROJECT", "SWITCH_MODEL"].includes(sc.kind)
        )
          throw new ValidationError(
            "scenario.kind must be PRIORITIZE, PAUSE_PROJECT or SWITCH_MODEL",
          );
        const r = a.whatIf(sc, acc);
        return {
          simulated: true,
          summary: r.summary,
          impacts: r.impacts,
          assumptions: r.assumptions,
          confidence: r.confidence,
        };
      }
      case "analytics_capture_lessons":
        return { created: a.captureLessons(acc, p.id).length };
    }
    throw new NotFoundError(`unknown command: ${command}`);
  }
}
