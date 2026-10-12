/**
 * Governance, Trust, Security & Policy Intelligence — contracts.
 *
 * One deterministic decision point answers: who asks, what, on which resource,
 * in which environment, how risky it is, which policy applies, whether it is
 * allowed or needs approval/review, and what must be recorded. Private
 * single-user platform: project isolation only, no tenancy.
 */
import type { Entity } from "./persistence.js";
export declare const ACTION_CLASSES: readonly ["READ", "ANALYZE", "CREATE", "UPDATE", "EXECUTE", "PUBLISH", "DEPLOY", "DELETE", "EXPORT", "SHARE", "ADMINISTRATIVE"];
export type ActionClass = (typeof ACTION_CLASSES)[number];
export declare const RISK_LEVELS: readonly ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
export type GovRisk = (typeof RISK_LEVELS)[number];
export declare const POLICY_EFFECTS: readonly ["ALLOW", "REQUIRE_REVIEW", "REQUIRE_SECURITY_REVIEW", "REQUIRE_APPROVAL", "DENY"];
export type PolicyEffect = (typeof POLICY_EFFECTS)[number];
export declare const GOV_ENVIRONMENTS: readonly ["DEVELOPMENT", "TEST", "STAGING", "PRODUCTION"];
export type GovEnvironment = (typeof GOV_ENVIRONMENTS)[number];
export declare const DATA_CLASSES: readonly ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED", "SECRET"];
export type DataClass = (typeof DATA_CLASSES)[number];
export declare const RESOURCE_KINDS: readonly ["SOURCE", "UI_SOURCE", "TEST", "DOCUMENT", "CONFIG", "AUTH_CODE", "SECURITY_RULES", "CI_CONFIG", "DEPLOY_CONFIG", "ENV_FILE", "SECRET", "DATABASE", "BRANCH", "REPOSITORY", "FIREBASE_PROJECT", "INFRASTRUCTURE", "DEPLOY_TARGET", "PROJECT", "AGENT", "WORKFLOW", "INTEGRATION", "ENVIRONMENT", "POLICY", "NETWORK", "UNKNOWN"];
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export declare const POLICY_LAYERS: readonly ["SYSTEM_SECURITY", "PROJECT_SECURITY", "PROJECT_ARCHITECTURE", "WORKFLOW", "TASK", "AGENT", "USER_REQUEST"];
export type PolicyLayer = (typeof POLICY_LAYERS)[number];
export declare const TRUST_STATES: readonly ["TRUSTED", "LIMITED", "REVIEW_REQUIRED", "SUSPENDED", "DISABLED"];
export type TrustState = (typeof TRUST_STATES)[number];
export declare const ALERT_SEVERITIES: readonly ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export declare const ALERT_STATUSES: readonly ["OPEN", "ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"];
export type AlertStatus = (typeof ALERT_STATUSES)[number];
export declare const EMERGENCY_STATES: readonly ["NORMAL", "PAUSED", "INVESTIGATING", "RECOVERY_REQUIRED"];
export type EmergencyState = (typeof EMERGENCY_STATES)[number];
export type GovApprovalState = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED";
export interface ActionRequest {
    projectId: string;
    action: ActionClass;
    /** `file:src/a.ts`, `secret:NAME`, `firebase-project:prod`, `deploy:production`, `branch:main` … */
    resource: string;
    agentId?: string;
    /** A human principal making the request (simulation, direct control). */
    principalId?: string;
    executionId?: string;
    taskId?: string;
    workflowId?: string;
    taskType?: string;
    modelId?: string;
    provider?: string;
    toolId?: string;
    environment?: GovEnvironment;
    /** How many resources the action touches (bulk protection). */
    count?: number;
    reversible?: boolean;
    /** Content about to be written/sent — scanned for secrets, never stored. */
    content?: string;
    command?: string;
    /** Files/resources the task declared; sensitive resources must be inside it. */
    expectedScope?: readonly string[];
    dataClass?: DataClass;
    reason?: string;
    /**
     * Task-level assessment (before an agent acts): skip the per-task-type resource matrix, because the
     * individual actions are checked again, with the matrix, when the runtime performs them.
     */
    skipTaskProfile?: boolean;
    /** Simulation: nothing is created, alerted or consumed. */
    dryRun?: boolean;
}
export interface RiskFactor {
    factor: string;
    points: number;
    detail: string;
}
export interface RiskAssessment {
    level: GovRisk;
    score: number;
    factors: RiskFactor[];
    blastRadius: GovRisk;
    reversible: boolean;
}
export interface ResourceInfo {
    ref: string;
    kind: ResourceKind;
    label: string;
    dataClass: DataClass;
    production: boolean;
    /** For path-like resources: the normalized path. */
    path?: string;
}
export interface MatchedPolicy {
    policyId: string;
    name: string;
    layer: PolicyLayer;
    effect: PolicyEffect;
    builtin: boolean;
}
export interface SecurityDecision {
    decisionId: string;
    effect: PolicyEffect;
    risk: RiskAssessment;
    resource: ResourceInfo;
    environment: GovEnvironment;
    action: ActionClass;
    policies: MatchedPolicy[];
    /** Policies that asked for something weaker than the winner (never applied). */
    overruled: MatchedPolicy[];
    obligations: {
        approval: boolean;
        review: boolean;
        securityReview: boolean;
    };
    approval?: {
        approvalId: string;
        state: GovApprovalState;
        viaExisting?: boolean;
    };
    /** Plain-language reasons, in evaluation order. */
    reasons: string[];
    /** One readable block: decision, reasons, policy, approval. */
    explanation: string;
    agentTrust?: TrustState;
    simulated: boolean;
    at: string;
}
export interface PolicyCondition {
    actions?: ActionClass[];
    resourceKinds?: ResourceKind[];
    /** Case-insensitive substring tests against the resource path/ref. */
    resourceIncludes?: string[];
    environments?: GovEnvironment[];
    minRisk?: GovRisk;
    minCount?: number;
    dataClasses?: DataClass[];
    agentTrust?: TrustState[];
    /** Content/secret condition: the content carries a credential. */
    contentHasSecret?: boolean;
}
export interface GovPolicy extends Entity {
    policyId: string;
    name: string;
    description: string;
    layer: PolicyLayer;
    /** Lower first inside a layer. */
    priority: number;
    scope: {
        projectId?: string;
        workflowId?: string;
        agentId?: string;
        taskType?: string;
    };
    conditions: PolicyCondition;
    effect: PolicyEffect;
    approvalRequirement?: "HUMAN" | "EXPLICIT_HUMAN";
    securityRequirement?: "REVIEW" | "SECURITY_REVIEW";
    status: "ENABLED" | "DISABLED";
    builtin: boolean;
    /** Critical policies need an administrator to change. */
    critical: boolean;
    version: number;
    createdAt: string;
    updatedAt: string;
    updatedBy: string;
}
export interface AgentTrustRecord extends Entity {
    agentId: string;
    state: TrustState;
    riskLevel: GovRisk;
    reason?: string;
    updatedAt: string;
    updatedBy: string;
    history: {
        state: TrustState;
        at: string;
        by: string;
        reason?: string;
    }[];
}
export interface ModelTrustRecord extends Entity {
    provider: string;
    model: string;
    riskClass: GovRisk;
    /** "*" = every task type. */
    approvedTaskTypes: string[];
    maxDataClass: DataClass;
    external: boolean;
    dataHandling: string;
    contextCapacity?: number;
    costPolicy?: string;
    status: "ENABLED" | "DISABLED";
    updatedAt: string;
    updatedBy: string;
}
export interface ToolTrustRecord extends Entity {
    toolId: string;
    name: string;
    capabilities: string[];
    risk: GovRisk;
    permissions: string[];
    environments: GovEnvironment[];
    /** "*" = every agent. */
    allowedAgents: string[];
    approval: "NONE" | "HIGH_RISK" | "ALWAYS";
    securityRequirements: string[];
    status: "ENABLED" | "DISABLED";
    updatedAt: string;
    updatedBy: string;
}
export interface GovernanceApprovalView {
    approvalId: string;
    state: GovApprovalState;
    executionId?: string;
    taskId?: string;
    projectId: string;
    action: ActionClass | string;
    resource: string;
    risk: GovRisk | string;
    reason: string;
    expectedImpact: string;
    reversibility: string;
    changes: string;
    proposedCommand?: string;
    agentId?: string;
    modelId?: string;
    environment?: GovEnvironment;
    policies: string[];
    requestedBy: string;
    requestedAt: string;
    decision?: "APPROVED" | "DENIED" | "CANCELLED" | "EXPIRED";
    decidedBy?: string;
    decidedAt?: string;
    expiresAt?: string;
}
export interface SecurityAlert extends Entity {
    alertId: string;
    severity: AlertSeverity;
    source: "POLICY" | "SECRET_GUARD" | "THREAT_DETECTOR" | "DRIFT" | "CONFIG_MONITOR" | "AUDITOR" | "DEPENDENCY" | "EMERGENCY" | "AGENT_TRUST" | "INTEGRATION";
    projectId?: string;
    executionId?: string;
    taskId?: string;
    agentId?: string;
    event: string;
    description: string;
    /** Masked, bounded facts. */
    evidence: Record<string, string | number | boolean>;
    createdAt: string;
    updatedAt: string;
    status: AlertStatus;
    dedupeKey: string;
    occurrences: number;
    history: {
        status: AlertStatus;
        at: string;
        by: string;
        note?: string;
    }[];
}
export interface LedgerEntry extends Entity {
    seq: number;
    at: string;
    operation: string;
    severity?: AlertSeverity;
    actor: string;
    projectId?: string;
    agentId?: string;
    taskId?: string;
    executionId?: string;
    toolId?: string;
    action?: string;
    resource?: string;
    risk?: string;
    policyIds?: string[];
    result: string;
    detail: Record<string, string | number | boolean>;
    prevHash: string;
    hash: string;
}
export interface DriftReport {
    status: "NONE" | "DRIFT_DETECTED";
    expected: string[];
    actual: string[];
    unexpected: {
        path: string;
        kind: ResourceKind;
        sensitive: boolean;
    }[];
    severity: AlertSeverity;
    route: "NONE" | "REVIEW_REQUIRED";
}
export interface TrustScore {
    score: number;
    label: string;
    factors: {
        factor: string;
        count: number;
        points: number;
    }[];
    disclaimer: string;
}
export interface SecurityDashboard {
    status: "NOMINAL" | "ATTENTION" | "DEGRADED" | "HALTED";
    emergency: EmergencyState;
    openAlerts: number;
    criticalAlerts: number;
    blockedActions24h: number;
    pendingApprovals: number;
    policyViolations7d: number;
    suspendedAgents: number;
    recentEvents: LedgerEntry[];
    dependencyVulnerabilities: {
        scannedAt: string;
        critical: number;
        high: number;
        moderate: number;
        low: number;
    } | null;
    configChangesUnacknowledged: number;
    generatedAt: string;
}
export declare const SECURITY_COMMANDS: readonly ["security_set_agent_trust", "security_set_model_trust", "security_set_tool_trust", "security_create_policy", "security_update_policy", "security_set_policy_status", "security_decide_approval", "security_cancel_approval", "security_alert_transition", "security_emergency_stop", "security_emergency_advance", "security_emergency_resume", "security_scan_config", "security_accept_config", "security_scan_dependencies"];
export type SecurityCommand = (typeof SECURITY_COMMANDS)[number];
