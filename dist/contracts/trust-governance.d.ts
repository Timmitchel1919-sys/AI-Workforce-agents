import type { Entity } from "./persistence.js";
/**
 * AI Workforce OS — Layer 16: Trust, Governance & Human Oversight Contracts
 *
 * Defines the unified governance framework for AI behavior:
 * - Autonomy policies and risk classification (low, medium, high, critical)
 * - Trust tiers for agents, tools, models, integrations, and workflows
 * - Conceptual data classification (public, internal, sensitive, restricted)
 * - Unified Approval Center with structured explainability (what, why, risks, confidence)
 * - Protection of privileged actions (deletions, secret modifications, infra destruction)
 * - Emergency controls (stop agent, stop workflow, pause automation, lockdown)
 * - Immutable trust events and anomaly detection signals
 */
export declare const GOVERNANCE_TRUST_LEVELS: readonly ["untrusted", "limited", "standard", "trusted", "privileged"];
/** AI-governance trust tier (distinct from environment-host `TrustLevel`). */
export type GovernanceTrustLevel = (typeof GOVERNANCE_TRUST_LEVELS)[number];
export declare const DATA_CLASSIFICATIONS: readonly ["public", "internal", "sensitive", "restricted"];
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];
export declare const AUTONOMY_POLICY_TIERS: readonly ["low_risk", "medium_risk", "high_risk", "critical"];
export type AutonomyPolicyTier = (typeof AUTONOMY_POLICY_TIERS)[number];
export declare const UNIFIED_APPROVAL_STATUSES: readonly ["pending", "approved", "rejected", "modified", "deferred", "cancelled"];
export type UnifiedApprovalStatus = (typeof UNIFIED_APPROVAL_STATUSES)[number];
export declare const EMERGENCY_CONTROL_ACTIONS: readonly ["stop_workflow", "stop_agent", "pause_automation", "disable_tool", "revoke_permission", "lock_down_high_risk_actions"];
export type EmergencyControlAction = (typeof EMERGENCY_CONTROL_ACTIONS)[number];
export interface TrustEntity extends Entity {
    id: string;
    entityType: "agent" | "tool" | "model" | "integration" | "workflow";
    entityId: string;
    displayName: string;
    trustLevel: GovernanceTrustLevel;
    permissions: readonly string[];
    permittedDataClasses: readonly DataClassification[];
    riskCeiling: "low" | "medium" | "high" | "critical";
    usageCount: number;
    failureCount: number;
    securityFindingsCount: number;
    lastEvaluatedAt: string;
    notes: readonly string[];
}
export interface ApprovalExplanation {
    what: string;
    why: string;
    basedOn: string;
    expectedResult: string;
    risks: readonly string[];
    confidence: "high" | "medium" | "low";
    requiredApprovalLevel: "standard" | "privileged";
}
export interface UnifiedApprovalItem extends Entity {
    id: string;
    approvalId: string;
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
    explanation: ApprovalExplanation;
    proposedChange: Record<string, unknown>;
    rollbackAvailable: boolean;
    status: UnifiedApprovalStatus;
    decisionNotes?: string;
    decidedBy?: string;
    decidedAt?: string;
    createdAt: string;
    updatedAt: string;
}
export interface ActiveEmergencyLock {
    id: string;
    action: EmergencyControlAction;
    targetId?: string;
    lockedAt: string;
    lockedBy: string;
    reason: string;
}
export interface EmergencyControlState {
    automationLockedDown: boolean;
    activeLocks: readonly ActiveEmergencyLock[];
    updatedAt: string;
    updatedBy: string;
}
export interface TrustEvent extends Entity {
    id: string;
    eventId: string;
    type: "trust_level_changed" | "autonomy_policy_updated" | "privileged_action_intercepted" | "policy_violation_blocked" | "emergency_control_executed" | "approval_decided" | "anomaly_detected";
    severity: "info" | "low" | "medium" | "high" | "critical";
    actor: string;
    projectId?: string;
    target: string;
    summary: string;
    details: Record<string, unknown>;
    timestamp: string;
}
export interface TrustCenterSummary {
    generatedAt: string;
    overallTrustStatus: "verified" | "attention" | "restricted" | "emergency_lockdown";
    automationLockedDown: boolean;
    pendingApprovalsCount: number;
    criticalPendingApprovalsCount: number;
    activeEmergencyLocksCount: number;
    blockedViolations24h: number;
    entities: {
        agents: {
            total: number;
            trusted: number;
            untrusted: number;
        };
        tools: {
            total: number;
            trusted: number;
            restricted: number;
        };
        models: {
            total: number;
            compliant: number;
        };
    };
    recentPrivilegedActions: readonly TrustEvent[];
    recentViolations: readonly TrustEvent[];
}
