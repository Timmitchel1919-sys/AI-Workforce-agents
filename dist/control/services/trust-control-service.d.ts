import { type OperatorPrincipal } from "../../contracts/index.js";
import type { EmergencyControlAction, EmergencyControlState, TrustCenterSummary, TrustEntity, TrustEvent, UnifiedApprovalItem, UnifiedApprovalStatus } from "../../contracts/trust-governance.js";
import type { Repository } from "../../contracts/persistence.js";
import type { AuditLog } from "../../core/index.js";
import { TrustEngine, type ActionGovernanceContext, type PolicyEvaluationResult } from "../../core/trust/trust-engine.js";
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
export declare class TrustOversightControlService {
    private readonly trustEntities;
    private readonly approvals;
    private readonly trustEvents;
    private readonly audit?;
    private readonly engine;
    private emergencyState;
    constructor(trustEntities: Repository<TrustEntity>, approvals: Repository<UnifiedApprovalItem>, trustEvents: Repository<TrustEvent>, audit?: AuditLog | undefined, engine?: TrustEngine);
    /**
     * Rebuilds active emergency locks from the append-only trust event log so a
     * lockdown survives process restarts / cold starts on other instances.
     */
    private rehydrateEmergencyState;
    /**
     * Server-side verification of a claimed approval. A caller-supplied approval
     * id is only honoured when it exists, is APPROVED, matches the action and
     * target, and is visible to the principal's project scope.
     */
    private verifyApproval;
    private requireReader;
    private requireOperator;
    private requireAdmin;
    private requireProjectAccess;
    listTrustEntities(principal: OperatorPrincipal, entityType?: TrustEntity["entityType"]): TrustEntity[];
    getTrustEntity(principal: OperatorPrincipal, entityId: string): TrustEntity | undefined;
    upsertTrustEntity(principal: OperatorPrincipal, entity: Omit<TrustEntity, "id" | "lastEvaluatedAt" | "usageCount" | "failureCount" | "securityFindingsCount"> & {
        id?: string;
        usageCount?: number;
        failureCount?: number;
        securityFindingsCount?: number;
    }): TrustEntity;
    evaluateAndGovernAction(principal: OperatorPrincipal, context: ActionGovernanceContext): {
        allowed: boolean;
        evaluation: PolicyEvaluationResult;
        approvalItem?: UnifiedApprovalItem;
    };
    createApprovalRequest(principal: OperatorPrincipal, request: CreateApprovalItemRequest, explanationOverride?: import("../../contracts/trust-governance.js").ApprovalExplanation): UnifiedApprovalItem;
    listApprovals(principal: OperatorPrincipal, options?: {
        projectId?: string;
        status?: UnifiedApprovalStatus;
    }): UnifiedApprovalItem[];
    decideApproval(principal: OperatorPrincipal, approvalId: string, decision: "approve" | "reject" | "modify" | "defer" | "cancel", notes?: string, modifiedPayload?: Record<string, unknown>): UnifiedApprovalItem;
    getEmergencyControlState(principal: OperatorPrincipal): EmergencyControlState;
    executeEmergencyControl(principal: OperatorPrincipal, input: {
        action: EmergencyControlAction;
        targetId?: string;
        reason: string;
    }): EmergencyControlState;
    releaseEmergencyControl(principal: OperatorPrincipal, lockId: string): EmergencyControlState;
    recordTrustEvent(event: Omit<TrustEvent, "id" | "eventId" | "timestamp">): TrustEvent;
    listTrustEvents(principal: OperatorPrincipal, options?: {
        projectId?: string;
        limit?: number;
    }): TrustEvent[];
    getTrustCenterSummary(principal: OperatorPrincipal, projectId?: string): TrustCenterSummary;
}
