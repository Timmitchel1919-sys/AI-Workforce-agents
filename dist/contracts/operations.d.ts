/**
 * Operational data contracts.
 *
 * These are facts observed by the Workforce, not predictions. They form the
 * project-isolated, lineage-traceable input for future analytics and only
 * later for a readiness-gated predictive layer.
 */
import type { Entity } from "./persistence.js";
export declare const OPERATIONAL_EVENT_KINDS: readonly ["audit_observation", "task_lifecycle", "workflow_lifecycle", "tool_execution", "model_execution", "approval_decision", "environment_observation", "verification", "release"];
export type OperationalEventKind = (typeof OPERATIONAL_EVENT_KINDS)[number];
export interface DataProvenance {
    source: "workforce" | "operator" | "integration" | "import";
    sourceId: string;
    correlationId?: string;
    sourceRevision?: string;
}
export interface OperationalEvent extends Entity {
    projectId: string;
    kind: OperationalEventKind;
    /** When the observed fact happened, not when it was later imported. */
    observedAt: string;
    recordedAt: string;
    provenance: DataProvenance;
    /** Redacted, bounded dimensions used for aggregation and filtering. */
    dimensions: Record<string, string | number | boolean>;
}
export declare const OUTCOME_DOMAINS: readonly ["cost", "capacity", "delivery", "failure_risk", "reliability"];
export type OutcomeDomain = (typeof OUTCOME_DOMAINS)[number];
/** An observed result. It is never an estimate, forecast, or recommendation. */
export interface OperationalOutcome extends Entity {
    projectId: string;
    domain: OutcomeDomain;
    targetId?: string;
    status: "succeeded" | "failed" | "cancelled" | "unknown";
    occurredAt: string;
    recordedAt: string;
    provenance: DataProvenance;
    actual: Record<string, string | number | boolean>;
}
export declare const DATA_READINESS_STATUSES: readonly ["ready", "limited", "not_ready", "unknown"];
export type DataReadinessStatus = (typeof DATA_READINESS_STATUSES)[number];
/** Domain-specific thresholds. There are deliberately no global magic numbers. */
export interface DataReadinessPolicy {
    minEvents?: number;
    minOutcomes?: number;
    minHistoryMs?: number;
    requireOutcomes?: boolean;
}
export interface DataReadinessRequest {
    projectId: string;
    domain: OutcomeDomain;
    policy?: DataReadinessPolicy;
    now?: string;
}
export interface DataReadinessAssessment {
    projectId: string;
    domain: OutcomeDomain;
    status: DataReadinessStatus;
    assessedAt: string;
    eventCount: number;
    outcomeCount: number;
    historyMs?: number;
    reasons: readonly string[];
}
export declare function validateProvenance(value: DataProvenance): void;
export declare function validateOperationalEvent(event: OperationalEvent): void;
export declare function validateOperationalOutcome(outcome: OperationalOutcome): void;
export type OpsHealthStatus = "healthy" | "degraded" | "unhealthy" | "offline" | "recovering" | "unknown";
export type FreshnessStatus = "current" | "stale" | "expired" | "unknown";
export type ResourceType = "CONTROL_PLANE_SERVICE" | "FUNCTION" | "HOSTING_SITE" | "DATABASE" | "STORAGE" | "QUEUE" | "ORGANIZATION" | "WORKSPACE" | "PROJECT" | "AGENT" | "MODEL_PROVIDER" | "MODEL" | "ENVIRONMENT" | "RUNNER" | "SANDBOX" | "EXECUTION_WORKSPACE" | "CONNECTOR" | "MCP_SERVER" | "EXTENSION" | "API_GATEWAY" | "WEBHOOK_ENGINE" | "DEPLOYMENT_TARGET" | "RELEASE" | "OTHER";
export interface PlatformResourceRef {
    resourceType: ResourceType;
    resourceId: string;
    organizationId?: string;
    projectId?: string;
    displayName?: string;
}
export interface HealthSignal extends Entity {
    resourceRef: PlatformResourceRef;
    signalType: string;
    status: OpsHealthStatus;
    observedAt: string;
    source: string;
    evidence: string;
    latency?: number;
    expiresAt?: string;
}
export interface ServiceInventoryRecord extends Entity {
    serviceId: string;
    displayName: string;
    type: ResourceType;
    dependencies: PlatformResourceRef[];
    critical: boolean;
}
export type AlertState = "open" | "acknowledged" | "suppressed" | "resolved";
export interface Alert extends Entity {
    resourceRef: PlatformResourceRef;
    signalId?: string;
    severity: "info" | "warning" | "error" | "critical";
    state: AlertState;
    openedAt: string;
    lastObservedAt: string;
    dedupKey: string;
    evidence: string;
    incidentRef?: string;
}
export interface PlatformConfiguration extends Entity {
    scope: "global" | "tenant" | "service";
    key: string;
    version: number;
    valueRef: string;
    status: "stored" | "applied" | "rollback";
    createdBy: string;
    approvedBy?: string;
    createdAt: string;
    appliedAt?: string;
}
export interface FeatureRollout extends Entity {
    featureId: string;
    stage: "internal" | "canary" | "limited" | "general" | "paused" | "rolled_back";
    targetCohort?: string;
    startedAt: string;
    health: OpsHealthStatus;
}
