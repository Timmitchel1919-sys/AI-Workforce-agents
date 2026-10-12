import {
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
  operatorCan,
  operatorCanAccessProject,
  type OperatorPrincipal,
} from "../../contracts/index.js";
import type {
  ActiveEmergencyLock,
  EmergencyControlAction,
  EmergencyControlState,
  TrustCenterSummary,
  TrustEntity,
  TrustEvent,
  GovernanceTrustLevel,
  UnifiedApprovalItem,
  UnifiedApprovalStatus,
} from "../../contracts/trust-governance.js";
import type { Repository } from "../../contracts/persistence.js";
import { createId, now } from "../../core/index.js";
import type { AuditLog } from "../../core/index.js";
import {
  TrustEngine,
  type ActionGovernanceContext,
  type PolicyEvaluationResult,
} from "../../core/trust/trust-engine.js";

export interface CreateApprovalItemRequest {
  action: string;
  requester: {
    actorId: string;
    actorType: "human" | "agent" | "system";
    agentId?: string;
  };
  projectId?: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  affectedResources: readonly string[];
  reason: string;
  proposedChange: Record<string, unknown>;
  rollbackAvailable?: boolean;
}

export class TrustControlService {
  private readonly engine: TrustEngine;
  private emergencyState: EmergencyControlState = {
    automationLockedDown: false,
    activeLocks: [],
    updatedAt: now(),
    updatedBy: "system",
  };

  constructor(
    private readonly trustEntities: Repository<TrustEntity>,
    private readonly approvals: Repository<UnifiedApprovalItem>,
    private readonly trustEvents: Repository<TrustEvent>,
    private readonly audit?: AuditLog,
    engine?: TrustEngine,
  ) {
    this.engine = engine ?? new TrustEngine();
    this.rehydrateEmergencyState();
  }

  /**
   * Rebuilds active emergency locks from the append-only trust event log so a
   * lockdown survives process restarts / cold starts on other instances.
   */
  private rehydrateEmergencyState(): void {
    const events = this.trustEvents
      .list()
      .filter((e) => e.type === "emergency_control_executed")
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    let locks: ActiveEmergencyLock[] = [];
    let updatedAt = this.emergencyState.updatedAt;
    let updatedBy = this.emergencyState.updatedBy;
    for (const e of events) {
      const d = e.details as Record<string, unknown>;
      if (typeof d.releasedLockId === "string") {
        locks = locks.filter((l) => l.id !== d.releasedLockId);
      } else if (typeof d.lockId === "string" && typeof d.action === "string") {
        locks.push({
          id: d.lockId,
          action: d.action as EmergencyControlAction,
          targetId: typeof d.targetId === "string" ? d.targetId : undefined,
          lockedAt: e.timestamp,
          lockedBy: e.actor,
          reason: typeof d.reason === "string" ? d.reason : "",
        });
      }
      updatedAt = e.timestamp;
      updatedBy = e.actor;
    }
    this.emergencyState = {
      automationLockedDown: locks.some((l) => l.action === "pause_automation"),
      activeLocks: locks,
      updatedAt,
      updatedBy,
    };
  }

  /**
   * Server-side verification of a claimed approval. A caller-supplied approval
   * id is only honoured when it exists, is APPROVED, matches the action and
   * target, and is visible to the principal's project scope.
   */
  private verifyApproval(
    principal: OperatorPrincipal,
    context: ActionGovernanceContext,
  ): string | undefined {
    const id = context.hasApprovedApprovalId;
    if (!id) return undefined;
    const item = this.approvals.findById(id);
    if (!item || item.status !== "approved") return undefined;
    if (item.action !== context.action) return undefined;
    if (!item.affectedResources.includes(context.targetResource)) return undefined;
    if ((item.projectId ?? undefined) !== (context.projectId ?? undefined)) return undefined;
    if (item.projectId && !operatorCanAccessProject(principal, item.projectId)) return undefined;
    return id;
  }

  private requireReader(principal: OperatorPrincipal): void {
    if (!operatorCan(principal, "view")) {
      throw new PermissionDeniedError("insufficient capabilities to access trust center");
    }
  }

  private requireOperator(principal: OperatorPrincipal): void {
    if (principal.role !== "admin" && principal.role !== "operator") {
      throw new PermissionDeniedError("requires operator or admin role to perform trust governance operations");
    }
  }

  private requireAdmin(principal: OperatorPrincipal): void {
    if (principal.role !== "admin") {
      throw new PermissionDeniedError("requires administrative role for high-impact emergency governance controls");
    }
  }

  private requireProjectAccess(principal: OperatorPrincipal, projectId?: string): void {
    if (projectId && !operatorCanAccessProject(principal, projectId)) {
      throw new PermissionDeniedError("no access to the specified project");
    }
  }

  // -------------------------------------------------------------
  // TRUST ENTITIES MANAGEMENT
  // -------------------------------------------------------------

  public listTrustEntities(
    principal: OperatorPrincipal,
    entityType?: TrustEntity["entityType"],
  ): TrustEntity[] {
    this.requireReader(principal);
    const all = this.trustEntities.list();
    if (entityType) {
      return all.filter((e) => e.entityType === entityType);
    }
    return all;
  }

  public getTrustEntity(
    principal: OperatorPrincipal,
    entityId: string,
  ): TrustEntity | undefined {
    this.requireReader(principal);
    return this.trustEntities.findById(entityId);
  }

  public upsertTrustEntity(
    principal: OperatorPrincipal,
    entity: Omit<TrustEntity, "id" | "lastEvaluatedAt" | "usageCount" | "failureCount" | "securityFindingsCount"> & {
      id?: string;
      usageCount?: number;
      failureCount?: number;
      securityFindingsCount?: number;
    },
  ): TrustEntity {
    this.requireOperator(principal);
    const existing = entity.id ? this.trustEntities.findById(entity.id) : undefined;
    const targetId = entity.id ?? entity.entityId;

    const updated: TrustEntity = {
      ...entity,
      id: targetId,
      entityId: entity.entityId,
      usageCount: entity.usageCount ?? existing?.usageCount ?? 0,
      failureCount: entity.failureCount ?? existing?.failureCount ?? 0,
      securityFindingsCount: entity.securityFindingsCount ?? existing?.securityFindingsCount ?? 0,
      lastEvaluatedAt: now(),
    };

    this.trustEntities.upsert(updated);

    this.recordTrustEvent({
      type: "trust_level_changed",
      severity: updated.trustLevel === "untrusted" ? "high" : "info",
      actor: principal.id,
      target: updated.entityId,
      summary: `Trust tier for ${updated.entityType} ${updated.displayName} set to ${updated.trustLevel.toUpperCase()}`,
      details: {
        entityId: updated.entityId,
        entityType: updated.entityType,
        trustLevel: updated.trustLevel,
        permissions: updated.permissions,
      },
    });

    return updated;
  }

  // -------------------------------------------------------------
  // ACTION EVALUATION & GOVERNANCE GATEWAY
  // -------------------------------------------------------------

  public evaluateAndGovernAction(
    principal: OperatorPrincipal,
    context: ActionGovernanceContext,
  ): {
    allowed: boolean;
    evaluation: PolicyEvaluationResult;
    approvalItem?: UnifiedApprovalItem;
  } {
    this.requireOperator(principal);
    this.requireProjectAccess(principal, context.projectId);

    // Never trust a client-claimed approval: replace with the verified value.
    const verifiedApprovalId = this.verifyApproval(principal, context);
    if (context.hasApprovedApprovalId && !verifiedApprovalId) {
      this.recordTrustEvent({
        type: "policy_violation_blocked",
        severity: "high",
        actor: context.actorId,
        projectId: context.projectId,
        target: context.targetResource,
        summary: `Rejected unverifiable approval reference for "${context.action}"`,
        details: { action: context.action, claimedApprovalId: context.hasApprovedApprovalId },
      });
    }
    context = { ...context, hasApprovedApprovalId: verifiedApprovalId };

    const agentEntity = context.agentId
      ? this.trustEntities.findById(context.agentId)
      : undefined;
    const toolEntity = context.toolId
      ? this.trustEntities.findById(context.toolId)
      : undefined;

    const evaluation = this.engine.evaluateAction(context, {
      agentEntity,
      toolEntity,
      emergencyLockedDown:
        this.emergencyState.automationLockedDown && context.actorType !== "human",
      activeLocks: this.emergencyState.activeLocks,
    });

    if (evaluation.decision === "deny") {
      this.recordTrustEvent({
        type: "policy_violation_blocked",
        severity: evaluation.isPrivilegedAction ? "critical" : "high",
        actor: context.actorId,
        projectId: context.projectId,
        target: context.targetResource,
        summary: `Action "${context.action}" was BLOCKED by governance policy: ${evaluation.reason}`,
        details: {
          action: context.action,
          agentId: context.agentId,
          matchedPolicies: evaluation.matchedPolicies,
          riskLevel: context.riskLevel,
        },
      });

      return { allowed: false, evaluation };
    }

    if (evaluation.decision === "approval_required") {
      const explanation = this.engine.generateApprovalExplanation(context, evaluation);
      const approvalItem = this.createApprovalRequest(principal, {
        action: context.action,
        requester: {
          actorId: context.actorId,
          actorType: context.actorType,
          agentId: context.agentId,
        },
        projectId: context.projectId,
        riskLevel: context.riskLevel,
        affectedResources: [context.targetResource],
        reason: context.action,
        proposedChange: { action: context.action, target: context.targetResource },
        rollbackAvailable: !evaluation.isPrivilegedAction,
      }, explanation);

      this.recordTrustEvent({
        type: "privileged_action_intercepted",
        severity: "medium",
        actor: context.actorId,
        projectId: context.projectId,
        target: context.targetResource,
        summary: `Action "${context.action}" paused awaiting human approval (${approvalItem.approvalId})`,
        details: {
          approvalId: approvalItem.approvalId,
          riskLevel: context.riskLevel,
          requiredLevel: evaluation.requiredApprovalLevel,
        },
      });

      return { allowed: false, evaluation, approvalItem };
    }

    // Allowed
    return { allowed: true, evaluation };
  }

  // -------------------------------------------------------------
  // UNIFIED APPROVAL CENTER
  // -------------------------------------------------------------

  public createApprovalRequest(
    principal: OperatorPrincipal,
    request: CreateApprovalItemRequest,
    explanationOverride?: import("../../contracts/trust-governance.js").ApprovalExplanation,
  ): UnifiedApprovalItem {
    this.requireOperator(principal);
    this.requireProjectAccess(principal, request.projectId);

    const approvalId = createId("appr");
    const explanation = explanationOverride ?? {
      what: `Execute action "${request.action}" on resources: ${request.affectedResources.join(", ")}`,
      why: request.reason,
      basedOn: "Direct action dispatch invocation",
      expectedResult: "Target state modification upon operator confirmation",
      risks: [
        `Risk tier classified as ${request.riskLevel.toUpperCase()}`,
        "Irreversible if rollback capability is unavailable",
      ],
      confidence: "high",
      requiredApprovalLevel: request.riskLevel === "critical" ? "privileged" : "standard",
    };

    const item: UnifiedApprovalItem = {
      id: approvalId,
      approvalId,
      action: request.action,
      requester: request.requester,
      projectId: request.projectId,
      riskLevel: request.riskLevel,
      affectedResources: request.affectedResources,
      reason: request.reason,
      explanation,
      proposedChange: request.proposedChange,
      rollbackAvailable: request.rollbackAvailable ?? false,
      status: "pending",
      createdAt: now(),
      updatedAt: now(),
    };

    this.approvals.upsert(item);
    return item;
  }

  public listApprovals(
    principal: OperatorPrincipal,
    options: { projectId?: string; status?: UnifiedApprovalStatus } = {},
  ): UnifiedApprovalItem[] {
    this.requireReader(principal);
    this.requireProjectAccess(principal, options.projectId);

    return this.approvals
      .list()
      .filter((a) => {
        if (a.projectId && !operatorCanAccessProject(principal, a.projectId)) {
          return false;
        }
        if (options.projectId && a.projectId !== options.projectId) {
          return false;
        }
        if (options.status && a.status !== options.status) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public decideApproval(
    principal: OperatorPrincipal,
    approvalId: string,
    decision: "approve" | "reject" | "modify" | "defer" | "cancel",
    notes?: string,
    modifiedPayload?: Record<string, unknown>,
  ): UnifiedApprovalItem {
    this.requireOperator(principal);

    const item = this.approvals.findById(approvalId);
    if (!item) {
      throw new NotFoundError(`Approval request not found: ${approvalId}`);
    }
    this.requireProjectAccess(principal, item.projectId);

    if (item.status !== "pending") {
      throw new ValidationError(`Approval request ${approvalId} is already resolved (${item.status})`);
    }

    const nextStatus: UnifiedApprovalStatus =
      decision === "approve"
        ? "approved"
        : decision === "reject"
          ? "rejected"
          : decision === "modify"
            ? "modified"
            : decision === "defer"
              ? "deferred"
              : "cancelled";

    const updated: UnifiedApprovalItem = {
      ...item,
      status: nextStatus,
      decisionNotes: notes,
      decidedBy: principal.id,
      decidedAt: now(),
      updatedAt: now(),
      proposedChange: modifiedPayload ?? item.proposedChange,
    };

    this.approvals.upsert(updated);

    this.recordTrustEvent({
      type: "approval_decided",
      severity: nextStatus === "approved" ? "info" : "medium",
      actor: principal.id,
      projectId: item.projectId,
      target: item.action,
      summary: `Approval ${approvalId} for "${item.action}" was ${nextStatus.toUpperCase()} by ${principal.id}`,
      details: {
        approvalId,
        status: nextStatus,
        notes,
      },
    });

    return updated;
  }

  // -------------------------------------------------------------
  // EMERGENCY CONTROLS
  // -------------------------------------------------------------

  public getEmergencyControlState(principal: OperatorPrincipal): EmergencyControlState {
    this.requireReader(principal);
    return { ...this.emergencyState };
  }

  public executeEmergencyControl(
    principal: OperatorPrincipal,
    input: {
      action: EmergencyControlAction;
      targetId?: string;
      reason: string;
    },
  ): EmergencyControlState {
    this.requireAdmin(principal);

    const lockId = createId("lock");
    const newLock: ActiveEmergencyLock = {
      id: lockId,
      action: input.action,
      targetId: input.targetId,
      lockedAt: now(),
      lockedBy: principal.id,
      reason: input.reason,
    };

    const isGlobalLock = input.action === "pause_automation";

    this.emergencyState = {
      automationLockedDown: isGlobalLock ? true : this.emergencyState.automationLockedDown,
      activeLocks: [...this.emergencyState.activeLocks, newLock],
      updatedAt: now(),
      updatedBy: principal.id,
    };

    this.recordTrustEvent({
      type: "emergency_control_executed",
      severity: "critical",
      actor: principal.id,
      target: input.targetId ?? input.action,
      summary: `EMERGENCY CONTROL ACTIVATED: ${input.action.toUpperCase()} (${input.reason})`,
      details: { lockId, action: input.action, targetId: input.targetId, reason: input.reason },
    });

    return { ...this.emergencyState };
  }

  public releaseEmergencyControl(
    principal: OperatorPrincipal,
    lockId: string,
  ): EmergencyControlState {
    this.requireAdmin(principal);

    const remainingLocks = this.emergencyState.activeLocks.filter((l) => l.id !== lockId);
    const hasGlobalLockRemaining = remainingLocks.some(
      (l) => l.action === "pause_automation",
    );

    this.emergencyState = {
      automationLockedDown: hasGlobalLockRemaining,
      activeLocks: remainingLocks,
      updatedAt: now(),
      updatedBy: principal.id,
    };

    this.recordTrustEvent({
      type: "emergency_control_executed",
      severity: "info",
      actor: principal.id,
      target: lockId,
      summary: `Emergency lock ${lockId} released by ${principal.id}`,
      details: { releasedLockId: lockId, remainingCount: remainingLocks.length },
    });

    return { ...this.emergencyState };
  }

  // -------------------------------------------------------------
  // IMMUTABLE TRUST AUDIT & OVERVIEW
  // -------------------------------------------------------------

  public recordTrustEvent(
    event: Omit<TrustEvent, "id" | "eventId" | "timestamp">,
  ): TrustEvent {
    const eventId = createId("trevt");
    const record: TrustEvent = {
      ...event,
      id: eventId,
      eventId,
      timestamp: now(),
    };

    this.trustEvents.upsert(record);
    this.audit?.record("trust_event_recorded", {
      projectId: record.projectId,
      data: {
        eventId,
        type: record.type,
        summary: record.summary,
        actor: record.actor,
      },
    });

    return record;
  }

  public listTrustEvents(
    principal: OperatorPrincipal,
    options: { projectId?: string; limit?: number } = {},
  ): TrustEvent[] {
    this.requireReader(principal);
    this.requireProjectAccess(principal, options.projectId);

    const limit = options.limit ?? 50;
    return this.trustEvents
      .list()
      .filter((e) => {
        if (e.projectId && !operatorCanAccessProject(principal, e.projectId)) {
          return false;
        }
        if (options.projectId && e.projectId !== options.projectId) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  public getTrustCenterSummary(
    principal: OperatorPrincipal,
    projectId?: string,
  ): TrustCenterSummary {
    this.requireReader(principal);
    this.requireProjectAccess(principal, projectId);

    const allApprovals = this.listApprovals(principal, { projectId });
    const pendingApprovals = allApprovals.filter((a) => a.status === "pending");
    const criticalPending = pendingApprovals.filter((a) => a.riskLevel === "critical");

    const entities = this.trustEntities.list();
    const agents = entities.filter((e) => e.entityType === "agent");
    const tools = entities.filter((e) => e.entityType === "tool");
    const models = entities.filter((e) => e.entityType === "model");

    const recentEvents = this.listTrustEvents(principal, { projectId, limit: 100 });
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentViolations = recentEvents.filter(
      (e) => e.type === "policy_violation_blocked" && e.timestamp >= oneDayAgo,
    );
    const recentPrivileged = recentEvents.filter(
      (e) => e.type === "privileged_action_intercepted" || e.type === "emergency_control_executed",
    );

    let overallStatus: TrustCenterSummary["overallTrustStatus"] = "verified";
    if (this.emergencyState.automationLockedDown) {
      overallStatus = "emergency_lockdown";
    } else if (recentViolations.length > 5 || criticalPending.length > 0) {
      overallStatus = "attention";
    } else if (agents.some((a) => a.trustLevel === "untrusted")) {
      overallStatus = "restricted";
    }

    return {
      generatedAt: now(),
      overallTrustStatus: overallStatus,
      automationLockedDown: this.emergencyState.automationLockedDown,
      pendingApprovalsCount: pendingApprovals.length,
      criticalPendingApprovalsCount: criticalPending.length,
      activeEmergencyLocksCount: this.emergencyState.activeLocks.length,
      blockedViolations24h: recentViolations.length,
      entities: {
        agents: {
          total: agents.length,
          trusted: agents.filter((a) => a.trustLevel === "trusted" || a.trustLevel === "privileged").length,
          untrusted: agents.filter((a) => a.trustLevel === "untrusted").length,
        },
        tools: {
          total: tools.length,
          trusted: tools.filter((t) => t.trustLevel === "trusted" || t.trustLevel === "privileged").length,
          restricted: tools.filter((t) => t.trustLevel === "limited" || t.trustLevel === "untrusted").length,
        },
        models: {
          total: models.length,
          compliant: models.filter((m) => m.trustLevel !== "untrusted").length,
        },
      },
      recentPrivilegedActions: recentPrivileged.slice(0, 10),
      recentViolations: recentViolations.slice(0, 10),
    };
  }
}
