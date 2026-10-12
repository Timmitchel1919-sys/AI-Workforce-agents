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
];
export const BACKUP_STATUSES = [
    "requested",
    "running",
    "completed",
    "verification_failed",
    "failed",
    "expired",
    "archived",
];
export const RECOVERY_STATUSES = [
    "requested",
    "awaiting_approval",
    "approved",
    "restoring",
    "verifying",
    "recovered",
    "failed",
    "cancelled",
];
export const RECOVERY_RISK_LEVELS = ["low", "medium", "high", "critical"];
export const BACKUP_TRUST_STATUSES = ["trusted", "suspected", "compromised", "unknown"];
/* ------------------------------------------------------------------ */
/* Pure Validators                                                    */
/* ------------------------------------------------------------------ */
export function validateBackupRecord(record) {
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
export function validateBackupPolicy(policy) {
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
export function validateRecoveryRequest(request) {
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
