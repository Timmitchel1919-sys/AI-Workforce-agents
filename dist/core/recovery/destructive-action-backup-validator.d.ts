/**
 * AI Workforce — Destructive Action Backup Validator (Step 6, 26)
 *
 * Verifies that high/critical destructive operations cannot execute
 * unless an authoritative, verified, trusted, and fresh recovery point
 * exists in the BackupCatalog.
 *
 * Fails closed: if backup verification is missing or errors occur,
 * execution is deterministically blocked. Client-provided booleans
 * (e.g. `backupAvailable: true`) are rejected.
 */
import type { BackupPolicy, BackupRecord, BackupResourceType } from "../../contracts/recovery.js";
import type { BackupCatalogService } from "./backup-catalog.js";
export interface DestructiveActionContext {
    action: string;
    resourceType: BackupResourceType;
    environment: string;
    projectId?: string;
    risk: "low" | "medium" | "high" | "critical";
    destructive: boolean;
}
export interface BackupValidationDecision {
    allowed: boolean;
    reason: string;
    backupId?: string;
    backupRecord?: BackupRecord;
    blockReasonCode?: "BACKUP_NOT_REQUIRED" | "BACKUP_VALID" | "BACKUP_MISSING" | "BACKUP_UNVERIFIED" | "BACKUP_STALE" | "BACKUP_COMPROMISED" | "SERVICE_UNAVAILABLE";
}
export declare class DestructiveActionBackupValidator {
    private readonly catalog;
    private readonly policies;
    constructor(catalog: BackupCatalogService, policies?: readonly BackupPolicy[]);
    /**
     * Asserts whether a destructive action is permitted to proceed based on backup evidence.
     */
    validateBackupForDestructiveAction(context: DestructiveActionContext): Promise<BackupValidationDecision>;
}
