/**
 * AI Workforce — Backup, Recovery, and Disaster Resilience Contracts
 *
 * Defines models, policies, objectives, and contracts for:
 * - Backup records, resource types, and storage references
 * - Recovery Point Objectives (RPO) and Recovery Time Objectives (RTO)
 * - Deterministic backup policies and compliance verification
 * - Recovery requests, safety assessments, and approval workflows
 * - Restore verification, isolated recovery drills, and ransomware resilience
 */
import { ValidationError, requireText } from "./index.js";

export const BACKUP_RESOURCE_TYPES = [
  "firestore",
  "storage",
  "application_config",
  "security_policy",
  "operator_access",
  "project_registry",
  "workflow_state",
  "agent_registry",
  "deployment_metadata",
  "audit_metadata",
  "source_repository",
  "secret_metadata",
  "other",
] as const;

export type BackupResourceType = (typeof BACKUP_RESOURCE_TYPES)[number];

export const BACKUP_STATUSES = [
  "requested",
  "running",
  "completed",
  "verification_failed",
  "failed",
  "expired",
  "archived",
] as const;

export type BackupStatus = (typeof BACKUP_STATUSES)[number];

export const RECOVERY_STATUSES = [
  "requested",
  "awaiting_approval",
  "approved",
  "restoring",
  "verifying",
  "recovered",
  "failed",
  "cancelled",
] as const;

export type RecoveryStatus = (typeof RECOVERY_STATUSES)[number];

export const RECOVERY_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RecoveryRiskLevel = (typeof RECOVERY_RISK_LEVELS)[number];

export const BACKUP_TRUST_STATUSES = ["trusted", "suspected", "compromised", "unknown"] as const;
export type BackupTrustStatus = (typeof BACKUP_TRUST_STATUSES)[number];

/**
 * Authoritative record of an executed backup.
 * Invariant: Never store raw credentials or connection secrets in this record.
 */
export interface BackupRecord {
  id: string;
  resourceType: BackupResourceType;
  projectId?: string;
  environment: string;
  provider: string;

  sourceVersion?: string;
  sourceHash?: string;

  /** URI or reference to protected storage location (e.g. gs://bucket/path/backup-123) */
  storageReference: string;

  status: BackupStatus;
  trustStatus: BackupTrustStatus;

  createdAt: string;
  completedAt?: string;

  createdBy: string;
  automatic: boolean;

  /** Timestamp after which backup retention may expire */
  retentionUntil?: string;

  /** Immutability / object retention lock indication */
  immutableRetention?: boolean;

  verification: {
    verified: boolean;
    verifiedAt?: string;
    method?: string;
    reason?: string;
  };

  integrity?: {
    hashAlgorithm?: string;
    hash?: string;
  };

  correlationId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Application Recovery Objectives (RPO & RTO).
 */
export interface RecoveryObjectives {
  /** Maximum acceptable data loss duration in hours */
  rpoHours: number;
  /** Maximum acceptable downtime duration in hours */
  rtoHours: number;
}

/**
 * Centrally governed Backup Policy per resource type and environment.
 */
export interface BackupPolicy {
  id: string;
  resourceType: BackupResourceType;
  enabled: boolean;
  schedule?: string;
  retentionDays: number;
  minimumCopies: number;
  immutableRetentionPreferred: boolean;
  backupBeforeDestructiveAction: boolean;
  verifyAfterBackup: boolean;
  restoreTestIntervalDays: number;
  environment: string;
  projectScope?: string;
  rpoHours: number;
  rtoHours: number;
}

/**
 * Pre-restore safety assessment evaluating blast radius and re-infection risk.
 */
export interface RecoverySafetyAssessment {
  overwrittenStateRisk: string;
  postBackupChangesDetected: boolean;
  vulnerabilityReintroductionRisk: RecoveryRiskLevel;
  credentialValidityVerified: boolean;
  schemaCompatibilityVerified: boolean;
  affectedDependentSystems: readonly string[];
  safeToProceed: boolean;
  reasons: readonly string[];
}

/**
 * Post-restore verification result ensuring the restored system is completely healthy and secure.
 */
export interface RestoreVerificationResult {
  verified: boolean;
  verifiedAt: string;
  resourceExists: boolean;
  versionMatch: boolean;
  integrityVerified: boolean;
  applicationHealthHealthy: boolean;
  securityPolicyPresent: boolean;
  accessControlIntact: boolean;
  auditEventsAvailable: boolean;
  checksPassed: readonly string[];
  failureReason?: string;
}

/**
 * Governed request to restore an environment, database, or configuration from a backup.
 */
export interface RecoveryRequest {
  id: string;
  projectId?: string;
  environment: string;
  requestedBy: string;
  reason: string;
  incidentId?: string;
  targetResourceType: BackupResourceType;
  backupId: string;
  desiredRecoveryPoint: string;
  currentStateSummary?: string;
  expectedImpact?: string;
  risk: RecoveryRiskLevel;
  status: RecoveryStatus;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  correlationId: string;
  isolatedTarget?: string;
  safetyAssessment?: RecoverySafetyAssessment;
  verificationDetails?: RestoreVerificationResult;
}

/**
 * Record of a non-production or isolated disaster recovery drill.
 */
export interface RecoveryDrillRecord {
  id: string;
  backupId: string;
  resourceType: BackupResourceType;
  environment: "isolated_drill" | "staging";
  conductedBy: string;
  conductedAt: string;
  durationMs: number;
  success: boolean;
  verification: RestoreVerificationResult;
  notes?: string;
}

/**
 * Normalized summary of backup and disaster recovery posture for Security Operations.
 */
export interface BackupSecuritySummary {
  generatedAt: string;
  protectedResources: number;
  healthyBackups: number;
  staleBackups: number;
  failedBackups: number;
  unverifiedBackups: number;
  lastSuccessfulBackup?: string;
  lastRestoreTest?: string;
  policyViolations: number;
}

/* ------------------------------------------------------------------ */
/* Pure Validators                                                    */
/* ------------------------------------------------------------------ */

export function validateBackupRecord(record: BackupRecord): void {
  requireText(record.id, "record.id");
  if (!BACKUP_RESOURCE_TYPES.includes(record.resourceType)) {
    throw new ValidationError(`Invalid backup resourceType: ${record.resourceType}`);
  }
  if (!BACKUP_STATUSES.includes(record.status)) {
    throw new ValidationError(`Invalid backup status: ${record.status}`);
  }
  if (!BACKUP_TRUST_STATUSES.includes(record.trustStatus)) {
    throw new ValidationError(`Invalid backup trustStatus: ${record.trustStatus}`);
  }
  requireText(record.environment, "record.environment");
  requireText(record.provider, "record.provider");
  requireText(record.storageReference, "record.storageReference");
  requireText(record.createdAt, "record.createdAt");
  requireText(record.createdBy, "record.createdBy");
  requireText(record.correlationId, "record.correlationId");

  if (record.status === "completed" && !record.verification) {
    throw new ValidationError("Completed backups must contain verification metadata");
  }
}

export function validateBackupPolicy(policy: BackupPolicy): void {
  requireText(policy.id, "policy.id");
  if (!BACKUP_RESOURCE_TYPES.includes(policy.resourceType)) {
    throw new ValidationError(`Invalid policy resourceType: ${policy.resourceType}`);
  }
  requireText(policy.environment, "policy.environment");
  if (policy.retentionDays <= 0) {
    throw new ValidationError("retentionDays must be greater than 0");
  }
  if (policy.rpoHours <= 0) {
    throw new ValidationError("rpoHours must be greater than 0");
  }
  if (policy.rtoHours <= 0) {
    throw new ValidationError("rtoHours must be greater than 0");
  }
}

export function validateRecoveryRequest(request: RecoveryRequest): void {
  requireText(request.id, "request.id");
  requireText(request.environment, "request.environment");
  requireText(request.requestedBy, "request.requestedBy");
  requireText(request.reason, "request.reason");
  if (!BACKUP_RESOURCE_TYPES.includes(request.targetResourceType)) {
    throw new ValidationError(`Invalid targetResourceType: ${request.targetResourceType}`);
  }
  requireText(request.backupId, "request.backupId");
  if (!RECOVERY_STATUSES.includes(request.status)) {
    throw new ValidationError(`Invalid recovery status: ${request.status}`);
  }
  if (!RECOVERY_RISK_LEVELS.includes(request.risk)) {
    throw new ValidationError(`Invalid recovery risk level: ${request.risk}`);
  }
}
