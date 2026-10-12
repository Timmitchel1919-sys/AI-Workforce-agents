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

export const GOVERNANCE_TRUST_LEVELS = [
  "untrusted",
  "limited",
  "standard",
  "trusted",
  "privileged",
] as const;
/** AI-governance trust tier (distinct from environment-host `TrustLevel`). */
export type GovernanceTrustLevel = (typeof GOVERNANCE_TRUST_LEVELS)[number];

export const DATA_CLASSIFICATIONS = [
  "public",
  "internal",
  "sensitive",
  "restricted",
] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export const AUTONOMY_POLICY_TIERS = [
  "low_risk",      // Automatic execution
  "medium_risk",   // Policy-dependent
  "high_risk",     // Human approval required
  "critical",      // Explicit human approval required (privileged)
] as const;
export type AutonomyPolicyTier = (typeof AUTONOMY_POLICY_TIERS)[number];

export const UNIFIED_APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "modified",
  "deferred",
  "cancelled",
] as const;
export type UnifiedApprovalStatus = (typeof UNIFIED_APPROVAL_STATUSES)[number];

export const EMERGENCY_CONTROL_ACTIONS = [
  "stop_workflow",
  "stop_agent",
  "pause_automation",
  "disable_tool",
  "revoke_permission",
  "lock_down_high_risk_actions",
] as const;
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
  type:
    | "trust_level_changed"
    | "autonomy_policy_updated"
    | "privileged_action_intercepted"
    | "policy_violation_blocked"
    | "emergency_control_executed"
    | "approval_decided"
    | "anomaly_detected";
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
    agents: { total: number; trusted: number; untrusted: number };
    tools: { total: number; trusted: number; restricted: number };
    models: { total: number; compliant: number };
  };
  recentPrivilegedActions: readonly TrustEvent[];
  recentViolations: readonly TrustEvent[];
}
