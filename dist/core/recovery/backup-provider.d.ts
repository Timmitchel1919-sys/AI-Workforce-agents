import type { BackupRecord, BackupResourceType } from "../../contracts/recovery.js";
export interface CreateBackupParams {
    id?: string;
    resourceType: BackupResourceType;
    environment: string;
    projectId?: string;
    createdBy: string;
    automatic?: boolean;
    correlationId?: string;
    payload?: unknown;
    retentionDays?: number;
    immutableRetention?: boolean;
}
export interface RestoreTargetOptions {
    isolatedTarget?: string;
    targetEnvironment?: string;
    dryRun?: boolean;
}
export interface BackupProvider {
    readonly name: string;
    readonly supportedResourceTypes: readonly BackupResourceType[];
    createBackup(params: CreateBackupParams): Promise<BackupRecord>;
    verifyBackupIntegrity(record: BackupRecord): Promise<{
        verified: boolean;
        hash?: string;
        reason?: string;
    }>;
    restoreBackup(record: BackupRecord, targetOptions?: RestoreTargetOptions): Promise<{
        success: boolean;
        details?: string;
    }>;
}
/**
 * In-Memory Backup Provider for fast testing, unit test fixtures, and local dev.
 */
export declare class InMemoryBackupProvider implements BackupProvider {
    readonly name = "in-memory";
    readonly supportedResourceTypes: readonly BackupResourceType[];
    private readonly storage;
    createBackup(params: CreateBackupParams): Promise<BackupRecord>;
    verifyBackupIntegrity(record: BackupRecord): Promise<{
        verified: boolean;
        hash?: string;
        reason?: string;
    }>;
    restoreBackup(record: BackupRecord, targetOptions?: RestoreTargetOptions): Promise<{
        success: boolean;
        details?: string;
    }>;
    getPayload(backupId: string): unknown | undefined;
}
/**
 * Firestore Backup Provider (Step 7).
 * Provider abstraction for Google Cloud / Firebase Firestore exports.
 * Generates protected GCS bucket references without exposing cloud credentials to the client.
 */
export declare class FirestoreBackupProvider implements BackupProvider {
    private readonly backupBucket;
    private readonly projectGcpId;
    readonly name = "firestore-gcs";
    readonly supportedResourceTypes: readonly BackupResourceType[];
    constructor(backupBucket?: string, projectGcpId?: string);
    createBackup(params: CreateBackupParams): Promise<BackupRecord>;
    verifyBackupIntegrity(record: BackupRecord): Promise<{
        verified: boolean;
        hash?: string;
        reason?: string;
    }>;
    restoreBackup(record: BackupRecord, targetOptions?: RestoreTargetOptions): Promise<{
        success: boolean;
        details?: string;
    }>;
}
/**
 * Storage Backup Provider (Step 8).
 * Manages protected backup for critical Storage files (avatars, evidence, project assets).
 */
export declare class StorageBackupProvider implements BackupProvider {
    private readonly backupBucket;
    readonly name = "storage-replicated";
    readonly supportedResourceTypes: readonly BackupResourceType[];
    constructor(backupBucket?: string);
    createBackup(params: CreateBackupParams): Promise<BackupRecord>;
    verifyBackupIntegrity(record: BackupRecord): Promise<{
        verified: boolean;
        hash?: string;
        reason?: string;
    }>;
    restoreBackup(record: BackupRecord, targetOptions?: RestoreTargetOptions): Promise<{
        success: boolean;
        details?: string;
    }>;
}
/**
 * Configuration & Policy Backup Provider (Step 9).
 * Captures pure configuration, security policies, and project metadata with SHA-256 integrity.
 * Strictly excludes raw secrets.
 */
export declare class ConfigurationBackupProvider implements BackupProvider {
    readonly name = "config-vault";
    readonly supportedResourceTypes: readonly BackupResourceType[];
    private readonly snapshots;
    createBackup(params: CreateBackupParams): Promise<BackupRecord>;
    verifyBackupIntegrity(record: BackupRecord): Promise<{
        verified: boolean;
        hash?: string;
        reason?: string;
    }>;
    restoreBackup(record: BackupRecord, targetOptions?: RestoreTargetOptions): Promise<{
        success: boolean;
        details?: string;
    }>;
    getSnapshot(id: string): string | undefined;
}
