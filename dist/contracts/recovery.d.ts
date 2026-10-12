export declare const BACKUP_RESOURCE_TYPES: readonly ["firestore", "storage", "application_config", "security_policy", "operator_access", "project_registry", "workflow_state", "agent_registry", "deployment_metadata", "audit_metadata", "source_repository", "secret_metadata", "other"];
export type BackupResourceType = (typeof BACKUP_RESOURCE_TYPES)[number];
export declare const BACKUP_STATUSES: readonly ["requested", "running", "completed", "verification_failed", "failed", "expired", "archived"];
export type BackupStatus = (typeof BACKUP_STATUSES)[number];
export declare const RECOVERY_STATUSES: readonly ["requested", "awaiting_approval", "approved", "restoring", "verifying", "recovered", "failed", "cancelled"];
export type RecoveryStatus = (typeof RECOVERY_STATUSES)[number];
export declare const RECOVERY_RISK_LEVELS: readonly ["low", "medium", "high", "critical"];
export type RecoveryRiskLevel = (typeof RECOVERY_RISK_LEVELS)[number];
export declare const BACKUP_TRUST_STATUSES: readonly ["trusted", "suspected", "compromised", "unknown"];
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
export declare function validateBackupRecord(record: BackupRecord): void;
export declare function validateBackupPolicy(policy: BackupPolicy): void;
export declare function validateRecoveryRequest(request: RecoveryRequest): void;
