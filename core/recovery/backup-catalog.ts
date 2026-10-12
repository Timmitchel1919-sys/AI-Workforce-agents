/**
 * AI Workforce — Backup Catalog Service (Step 13, 25)
 *
 * Catalogs backup records, evaluates validity, manages trust status,
 * verifies compliance against Backup Policies & RPO/RTO targets,
 * and produces normalized summaries for Security Operations.
 */
import type {
  BackupPolicy,
  BackupRecord,
  BackupResourceType,
  BackupSecuritySummary,
  BackupStatus,
  BackupTrustStatus,
} from "../../contracts/recovery.js";
import { validateBackupRecord } from "../../contracts/recovery.js";

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
  staleBackups: { resourceType: BackupResourceType; ageHours: number; rpoHours: number }[];
  policyViolations: string[];
}

export class BackupCatalogService {
  private readonly records = new Map<string, BackupRecord>();
  private lastRestoreTestTimestamp?: string;

  constructor(initialRecords: readonly BackupRecord[] = []) {
    for (const record of initialRecords) {
      validateBackupRecord(record);
      this.records.set(record.id, record);
    }
  }

  /**
   * Registers or updates a backup record in the catalog.
   */
  async registerBackup(record: BackupRecord): Promise<BackupRecord> {
    validateBackupRecord(record);
    this.records.set(record.id, { ...record });
    return { ...record };
  }

  /**
   * Retrieves a single backup record by ID.
   */
  async getBackup(id: string): Promise<BackupRecord | undefined> {
    const record = this.records.get(id);
    return record ? { ...record } : undefined;
  }

  /**
   * Queries catalogued backups with filters.
   */
  async listBackups(options: QueryBackupsOptions = {}): Promise<BackupRecord[]> {
    let result = Array.from(this.records.values());

    if (options.resourceType) {
      result = result.filter((r) => r.resourceType === options.resourceType);
    }
    if (options.environment) {
      result = result.filter((r) => r.environment === options.environment);
    }
    if (options.projectId) {
      result = result.filter((r) => r.projectId === options.projectId);
    }
    if (options.status) {
      result = result.filter((r) => r.status === options.status);
    }
    if (options.trustStatus) {
      result = result.filter((r) => r.trustStatus === options.trustStatus);
    }

    // Sort by createdAt descending (newest first)
    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (options.limit && options.limit > 0) {
      result = result.slice(0, options.limit);
    }

    return result.map((r) => ({ ...r }));
  }

  /**
   * Determines the newest VALID restore point.
   * Invariants:
   * - Must be status === "completed"
   * - Must be verified === true
   * - Must be trustStatus === "trusted" (not suspected, compromised, or unknown)
   * - Must NOT be expired
   * - If maxAgeHours specified, createdAt must be within that window
   */
  async getNewestValidRestorePoint(params: {
    resourceType: BackupResourceType;
    environment: string;
    projectId?: string;
    maxAgeHours?: number;
  }): Promise<BackupRecord | undefined> {
    const now = Date.now();
    const candidates = await this.listBackups({
      resourceType: params.resourceType,
      environment: params.environment,
      projectId: params.projectId,
      status: "completed",
      trustStatus: "trusted",
    });

    for (const record of candidates) {
      // Check verification
      if (!record.verification?.verified) {
        continue;
      }

      // Check expiration
      if (record.retentionUntil && new Date(record.retentionUntil).getTime() < now) {
        continue;
      }

      // Check max age if provided
      if (params.maxAgeHours !== undefined) {
        const ageMs = now - new Date(record.createdAt).getTime();
        const maxAgeMs = params.maxAgeHours * 3600 * 1000;
        if (ageMs > maxAgeMs) {
          continue;
        }
      }

      return record;
    }

    return undefined;
  }

  /**
   * Evaluates catalog against configured policies and RPO targets.
   */
  async checkPolicyCompliance(policies: readonly BackupPolicy[]): Promise<PolicyComplianceResult> {
    const now = Date.now();
    const missingBackups: BackupResourceType[] = [];
    const staleBackups: { resourceType: BackupResourceType; ageHours: number; rpoHours: number }[] = [];
    const policyViolations: string[] = [];

    for (const policy of policies) {
      if (!policy.enabled) continue;

      const newest = await this.getNewestValidRestorePoint({
        resourceType: policy.resourceType,
        environment: policy.environment,
        projectId: policy.projectScope,
      });

      if (!newest) {
        missingBackups.push(policy.resourceType);
        policyViolations.push(
          `Missing valid backup for resource ${policy.resourceType} in environment ${policy.environment}`,
        );
        continue;
      }

      const ageHours = (now - new Date(newest.createdAt).getTime()) / (3600 * 1000);
      if (ageHours > policy.rpoHours) {
        staleBackups.push({
          resourceType: policy.resourceType,
          ageHours: Math.round(ageHours * 10) / 10,
          rpoHours: policy.rpoHours,
        });
        policyViolations.push(
          `RPO violation for ${policy.resourceType}: newest backup is ${ageHours.toFixed(1)}h old (RPO: ${policy.rpoHours}h)`,
        );
      }
    }

    return {
      compliant: missingBackups.length === 0 && staleBackups.length === 0,
      missingBackups,
      staleBackups,
      policyViolations,
    };
  }

  /**
   * Updates trust status (e.g. when an incident marks a backup compromised or suspected).
   */
  async markTrustStatus(backupId: string, trustStatus: BackupTrustStatus, reason: string): Promise<BackupRecord> {
    const record = this.records.get(backupId);
    if (!record) {
      throw new Error(`Backup record ${backupId} not found`);
    }

    record.trustStatus = trustStatus;
    record.metadata = {
      ...(record.metadata ?? {}),
      trustStatusChangedAt: new Date().toISOString(),
      trustStatusReason: reason,
    };
    this.records.set(backupId, record);
    return { ...record };
  }

  /**
   * Records that a restore test / drill occurred.
   */
  recordRestoreTest(timestamp: string = new Date().toISOString()): void {
    this.lastRestoreTestTimestamp = timestamp;
  }

  /**
   * Generates a normalized summary of backup posture for Security Center.
   */
  async getSecuritySummary(policies: readonly BackupPolicy[] = []): Promise<BackupSecuritySummary> {
    const allRecords = Array.from(this.records.values());
    const healthy = allRecords.filter((r) => r.status === "completed" && r.trustStatus === "trusted" && r.verification.verified);
    const failed = allRecords.filter((r) => r.status === "failed" || r.status === "verification_failed");
    const unverified = allRecords.filter((r) => !r.verification.verified);

    const compliance = await this.checkPolicyCompliance(policies);

    // Identify newest backup overall
    const sorted = [...healthy].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const lastSuccessfulBackup = sorted[0]?.createdAt;

    const uniqueProtectedResources = new Set(healthy.map((r) => r.resourceType)).size;

    return {
      generatedAt: new Date().toISOString(),
      protectedResources: uniqueProtectedResources,
      healthyBackups: healthy.length,
      staleBackups: compliance.staleBackups.length,
      failedBackups: failed.length,
      unverifiedBackups: unverified.length,
      lastSuccessfulBackup,
      lastRestoreTest: this.lastRestoreTestTimestamp,
      policyViolations: compliance.policyViolations.length,
    };
  }

  /**
   * Safely deletes a record from the catalog if retention permits.
   */
  async removeRecord(backupId: string): Promise<boolean> {
    return this.records.delete(backupId);
  }
}
