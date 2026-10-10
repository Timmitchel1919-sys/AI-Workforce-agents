/**
 * Operational data contracts.
 *
 * These are facts observed by the Workforce, not predictions. They form the
 * project-isolated, lineage-traceable input for future analytics and only
 * later for a readiness-gated predictive layer.
 */
import type { Entity } from "./persistence.js";
import { ValidationError, requireText } from "./index.js";

export const OPERATIONAL_EVENT_KINDS = [
  "audit_observation",
  "task_lifecycle",
  "workflow_lifecycle",
  "tool_execution",
  "model_execution",
  "approval_decision",
  "environment_observation",
  "verification",
  "release",
] as const;
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

export const OUTCOME_DOMAINS = [
  "cost",
  "capacity",
  "delivery",
  "failure_risk",
  "reliability",
] as const;
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

export const DATA_READINESS_STATUSES = [
  "ready",
  "limited",
  "not_ready",
  "unknown",
] as const;
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

const sensitiveKey =
  /(?:api[_-]?key|authorization|credential|password|secret|token)/i;

function requireIso(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`${field} must be an ISO timestamp`);
  }
}

function validateRecord(
  values: Record<string, string | number | boolean>,
  field: string,
): void {
  for (const [key, value] of Object.entries(values)) {
    if (sensitiveKey.test(key)) {
      throw new ValidationError(
        `${field}.${key} must not contain sensitive data`,
      );
    }
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new ValidationError(`${field}.${key} must be a scalar value`);
    }
  }
}

export function validateProvenance(value: DataProvenance): void {
  if (
    !["workforce", "operator", "integration", "import"].includes(value.source)
  ) {
    throw new ValidationError("provenance.source is invalid");
  }
  requireText(value.sourceId, "provenance.sourceId");
}

export function validateOperationalEvent(event: OperationalEvent): void {
  requireText(event.id, "event.id");
  requireText(event.projectId, "event.projectId");
  if (!OPERATIONAL_EVENT_KINDS.includes(event.kind)) {
    throw new ValidationError("event.kind is invalid");
  }
  requireIso(event.observedAt, "event.observedAt");
  requireIso(event.recordedAt, "event.recordedAt");
  validateProvenance(event.provenance);
  validateRecord(event.dimensions, "event.dimensions");
}

export function validateOperationalOutcome(outcome: OperationalOutcome): void {
  requireText(outcome.id, "outcome.id");
  requireText(outcome.projectId, "outcome.projectId");
  if (!OUTCOME_DOMAINS.includes(outcome.domain)) {
    throw new ValidationError("outcome.domain is invalid");
  }
  if (
    !["succeeded", "failed", "cancelled", "unknown"].includes(outcome.status)
  ) {
    throw new ValidationError("outcome.status is invalid");
  }
  requireIso(outcome.occurredAt, "outcome.occurredAt");
  requireIso(outcome.recordedAt, "outcome.recordedAt");
  validateProvenance(outcome.provenance);
  validateRecord(outcome.actual, "outcome.actual");
}

export type OpsHealthStatus =
  | "healthy"
  | "degraded"
  | "unhealthy"
  | "offline"
  | "recovering"
  | "unknown";
export type FreshnessStatus = "current" | "stale" | "expired" | "unknown";
export type ResourceType =
  | "CONTROL_PLANE_SERVICE"
  | "FUNCTION"
  | "HOSTING_SITE"
  | "DATABASE"
  | "STORAGE"
  | "QUEUE"
  | "ORGANIZATION"
  | "WORKSPACE"
  | "PROJECT"
  | "AGENT"
  | "MODEL_PROVIDER"
  | "MODEL"
  | "ENVIRONMENT"
  | "RUNNER"
  | "SANDBOX"
  | "EXECUTION_WORKSPACE"
  | "CONNECTOR"
  | "MCP_SERVER"
  | "EXTENSION"
  | "API_GATEWAY"
  | "WEBHOOK_ENGINE"
  | "DEPLOYMENT_TARGET"
  | "RELEASE"
  | "OTHER";

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
  stage:
    | "internal"
    | "canary"
    | "limited"
    | "general"
    | "paused"
    | "rolled_back";
  targetCohort?: string;
  startedAt: string;
  health: OpsHealthStatus;
}
