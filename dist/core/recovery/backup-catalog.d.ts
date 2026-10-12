/**
 * AI Workforce — Backup Catalog Service (Step 13, 25)
 *
 * Catalogs backup records, evaluates validity, manages trust status,
 * verifies compliance against Backup Policies & RPO/RTO targets,
 * and produces normalized summaries for Security Operations.
 */
import type { BackupPolicy, BackupRecord, BackupResourceType, BackupSecuritySummary, BackupStatus, BackupTrustStatus } from "../../contracts/recovery.js";
export interface QueryBackupsOptions {
    resourceType?: BackupResourceType;
    environment?: string;
    projectId?: string;
    status?: BackupStatus;
    trustStatus?: BackupTrustStatus;
    limit?: number;
}
export interface PolicyComplianceResult {
    compliant: boolean;
    missingBackups: BackupResourceType[];
    staleBackups: {
        resourceType: BackupResourceType;
        ageHours: number;
        rpoHours: number;
    }[];
    policyViolations: string[];
}
export declare class BackupCatalogService {
    private readonly records;
    private lastRestoreTestTimestamp?;
    constructor(initialRecords?: readonly BackupRecord[]);
    /**
     * Registers or updates a backup record in the catalog.
     */
    registerBackup(record: BackupRecord): Promise<BackupRecord>;
    /**
     * Retrieves a single backup record by ID.
     */
    getBackup(id: string): Promise<BackupRecord | undefined>;
    /**
     * Queries catalogued backups with filters.
     */
    listBackups(options?: QueryBackupsOptions): Promise<BackupRecord[]>;
    /**
     * Determines the newest VALID restore point.
     * Invariants:
     * - Must be status === "completed"
     * - Must be verified === true
     * - Must be trustStatus === "trusted" (not suspected, compromised, or unknown)
     * - Must NOT be expired
     * - If maxAgeHours specified, createdAt must be within that window
     */
    getNewestValidRestorePoint(params: {
        resourceType: BackupResourceType;
        environment: string;
        projectId?: string;
        maxAgeHours?: number;
    }): Promise<BackupRecord | undefined>;
    /**
     * Evaluates catalog against configured policies and RPO targets.
     */
    checkPolicyCompliance(policies: readonly BackupPolicy[]): Promise<PolicyComplianceResult>;
    /**
     * Updates trust status (e.g. when an incident marks a backup compromised or suspected).
     */
    markTrustStatus(backupId: string, trustStatus: BackupTrustStatus, reason: string): Promise<BackupRecord>;
    /**
     * Records that a restore test / drill occurred.
     */
    recordRestoreTest(timestamp?: string): void;
    /**
     * Generates a normalized summary of backup posture for Security Center.
     */
    getSecuritySummary(policies?: readonly BackupPolicy[]): Promise<BackupSecuritySummary>;
    /**
     * Safely deletes a record from the catalog if retention permits.
     */
    removeRecord(backupId: string): Promise<boolean>;
}
