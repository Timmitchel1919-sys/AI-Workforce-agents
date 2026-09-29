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
