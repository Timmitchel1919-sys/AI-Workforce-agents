export class DestructiveActionBackupValidator {
    catalog;
    policies;
    constructor(catalog, policies = []) {
        this.catalog = catalog;
        this.policies = policies;
    }
    /**
     * Asserts whether a destructive action is permitted to proceed based on backup evidence.
     */
    async validateBackupForDestructiveAction(context) {
        try {
            // 1. If not destructive or low risk, check if policy still demands a backup
            const matchedPolicy = this.policies.find((p) => p.enabled &&
                p.resourceType === context.resourceType &&
                (p.environment === context.environment || p.environment === "*") &&
                (!p.projectScope || p.projectScope === context.projectId));
            const requiresBackup = context.destructive && (context.risk === "high" || context.risk === "critical" || matchedPolicy?.backupBeforeDestructiveAction);
            if (!requiresBackup) {
                return {
                    allowed: true,
                    reason: "No pre-action backup required for non-destructive or low-risk operation",
                    blockReasonCode: "BACKUP_NOT_REQUIRED",
                };
            }
            // 2. Query authoritative catalog for newest valid restore point
            const maxAgeHours = matchedPolicy?.rpoHours ?? 24; // default max acceptable age is 24h
            const newestBackup = await this.catalog.getNewestValidRestorePoint({
                resourceType: context.resourceType,
                environment: context.environment,
                projectId: context.projectId,
            });
            if (!newestBackup) {
                // Inspect candidate backups to provide specific diagnostics
                const candidates = await this.catalog.listBackups({
                    resourceType: context.resourceType,
                    environment: context.environment,
                    projectId: context.projectId,
                });
                if (candidates.length > 0) {
                    const latest = candidates[0];
                    if (!latest.verification?.verified) {
                        return {
                            allowed: false,
                            reason: `Destructive action '${context.action}' blocked: Backup '${latest.id}' has unverified integrity`,
                            backupId: latest.id,
                            blockReasonCode: "BACKUP_UNVERIFIED",
                        };
                    }
                    if (latest.trustStatus !== "trusted") {
                        return {
                            allowed: false,
                            reason: `Destructive action '${context.action}' blocked: Backup '${latest.id}' has trustStatus '${latest.trustStatus}' and cannot be used as a safe recovery point`,
                            backupId: latest.id,
                            blockReasonCode: "BACKUP_COMPROMISED",
                        };
                    }
                    const ageHours = (Date.now() - new Date(latest.createdAt).getTime()) / (3600 * 1000);
                    if (ageHours > maxAgeHours) {
                        return {
                            allowed: false,
                            reason: `Destructive action '${context.action}' blocked: Backup '${latest.id}' is stale (${ageHours.toFixed(1)}h old, exceeding policy limit of ${maxAgeHours}h)`,
                            backupId: latest.id,
                            blockReasonCode: "BACKUP_STALE",
                        };
                    }
                }
                return {
                    allowed: false,
                    reason: `Destructive action '${context.action}' blocked: No completed, verified, trusted backup found for resource '${context.resourceType}' in '${context.environment}'`,
                    blockReasonCode: "BACKUP_MISSING",
                };
            }
            // 3. Verify integrity & verification status
            if (!newestBackup.verification?.verified) {
                return {
                    allowed: false,
                    reason: `Destructive action '${context.action}' blocked: Backup '${newestBackup.id}' has unverified integrity`,
                    backupId: newestBackup.id,
                    blockReasonCode: "BACKUP_UNVERIFIED",
                };
            }
            // 4. Verify trust status
            if (newestBackup.trustStatus !== "trusted") {
                return {
                    allowed: false,
                    reason: `Destructive action '${context.action}' blocked: Backup '${newestBackup.id}' has trustStatus '${newestBackup.trustStatus}' and cannot be used as a safe recovery point`,
                    backupId: newestBackup.id,
                    blockReasonCode: "BACKUP_COMPROMISED",
                };
            }
            // 5. Verify freshness against RPO
            const ageHours = (Date.now() - new Date(newestBackup.createdAt).getTime()) / (3600 * 1000);
            if (ageHours > maxAgeHours) {
                return {
                    allowed: false,
                    reason: `Destructive action '${context.action}' blocked: Backup '${newestBackup.id}' is stale (${ageHours.toFixed(1)}h old, exceeding policy limit of ${maxAgeHours}h)`,
                    backupId: newestBackup.id,
                    blockReasonCode: "BACKUP_STALE",
                };
            }
            // 6. Valid backup evidence exists
            return {
                allowed: true,
                reason: `Valid verified recovery point '${newestBackup.id}' confirmed (${ageHours.toFixed(1)}h old)`,
                backupId: newestBackup.id,
                backupRecord: newestBackup,
                blockReasonCode: "BACKUP_VALID",
            };
        }
        catch (err) {
            // Step 26: Fail closed behavior
            return {
                allowed: false,
                reason: `Destructive action '${context.action}' blocked: Backup verification service error (${err instanceof Error ? err.message : String(err)})`,
                blockReasonCode: "SERVICE_UNAVAILABLE",
            };
        }
    }
}
