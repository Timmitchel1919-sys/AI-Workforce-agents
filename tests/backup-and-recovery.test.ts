/**
 * AI Workforce — Backup, Recovery & Ransomware Resilience Test Suite (Step 9)
 *
 * Verifies all 16 required resilience & recovery governance scenarios:
 * 1. Valid backup record -> stored/catalogued
 * 2. Failed backup -> not selectable as restore point
 * 3. Unverified backup -> not considered valid for critical destructive action
 * 4. Destructive action requires backup -> blocked without valid backup
 * 5. Valid recent backup -> destructive gate may proceed to next stage
 * 6. Backup integrity failure -> backup invalid + high event
 * 7. Unauthorized restore -> denied
 * 8. Production restore without approval -> blocked
 * 9. Incompatible restore target -> blocked
 * 10. Suspected compromised backup -> review required / blocked
 * 11. Backup deletion attempt -> passes destructive-action security path
 * 12. Normal user deletes all backups -> denied
 * 13. Successful restore -> verification before recovered status
 * 14. Failed verification -> recovery failed
 * 15. Recovery drill -> records successful restore test
 * 16. Security Policy Engine integration & fail-closed behavior
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { BackupPolicy, BackupRecord } from "../contracts/recovery.js";
import type { ZTNSecurityEvent } from "../contracts/security.js";
import {
  BackupCatalogService,
  DestructiveActionBackupValidator,
  FirestoreBackupProvider,
  InMemoryBackupProvider,
  RecoveryService,
} from "../core/recovery/index.js";
import { SecurityPolicyEngine } from "../core/security/security-policy-engine.js";

// Mock event repository for verifying emitted security events
class MockSecurityEventsRepo {
  public readonly events: ZTNSecurityEvent[] = [];
  upsert(event: ZTNSecurityEvent): void {
    this.events.push(event);
  }
  findById(id: string): ZTNSecurityEvent | undefined {
    return this.events.find((e) => e.id === id);
  }
  list(): ZTNSecurityEvent[] {
    return [...this.events];
  }
  delete(id: string): boolean {
    const idx = this.events.findIndex((e) => e.id === id);
    if (idx >= 0) {
      this.events.splice(idx, 1);
      return true;
    }
    return false;
  }
  clear(): void {
    this.events.length = 0;
  }
}

// -------------------------------------------------------------------
// 1. Valid backup record -> stored/catalogued
// -------------------------------------------------------------------
test("recovery: 1. valid backup record is stored and catalogued", async () => {
  const catalog = new BackupCatalogService();
  const provider = new InMemoryBackupProvider();

  const backup = await provider.createBackup({
    resourceType: "application_config",
    environment: "production",
    createdBy: "admin@aiworkforce.internal",
    payload: { version: "2.4.0", features: ["resilience"] },
  });

  await catalog.registerBackup(backup);
  const retrieved = await catalog.getBackup(backup.id);

  assert.ok(retrieved);
  assert.equal(retrieved.id, backup.id);
  assert.equal(retrieved.status, "completed");
  assert.equal(retrieved.trustStatus, "trusted");
  assert.equal(retrieved.verification.verified, true);
});

// -------------------------------------------------------------------
// 2. Failed backup -> not selectable as restore point
// -------------------------------------------------------------------
test("recovery: 2. failed backup is not selectable as a restore point", async () => {
  const catalog = new BackupCatalogService();
  const provider = new InMemoryBackupProvider();

  const failedBackup: BackupRecord = {
    id: "bck-failed-001",
    resourceType: "firestore",
    environment: "production",
    provider: provider.name,
    storageReference: "mem://backups/failed",
    status: "failed",
    trustStatus: "unknown",
    createdAt: new Date().toISOString(),
    createdBy: "operator",
    automatic: true,
    verification: { verified: false, reason: "Export interrupted" },
    correlationId: "cor-001",
  };

  await catalog.registerBackup(failedBackup);

  const restorePoint = await catalog.getNewestValidRestorePoint({
    resourceType: "firestore",
    environment: "production",
  });

  assert.equal(restorePoint, undefined, "Failed backup must not be returned as valid restore point");
});

// -------------------------------------------------------------------
// 3. Unverified backup -> not considered valid for critical destructive action
// -------------------------------------------------------------------
test("recovery: 3. unverified backup is not considered valid for critical destructive action", async () => {
  const catalog = new BackupCatalogService();
  const validator = new DestructiveActionBackupValidator(catalog);

  const unverifiedBackup: BackupRecord = {
    id: "bck-unverified-002",
    resourceType: "firestore",
    environment: "production",
    provider: "firestore-gcs",
    storageReference: "gs://bucket/unverified",
    status: "completed",
    trustStatus: "trusted",
    createdAt: new Date().toISOString(),
    createdBy: "operator",
    automatic: true,
    verification: { verified: false, reason: "Checksum pending" },
    correlationId: "cor-002",
  };

  await catalog.registerBackup(unverifiedBackup);

  const decision = await validator.validateBackupForDestructiveAction({
    action: "purge_project_data",
    resourceType: "firestore",
    environment: "production",
    risk: "critical",
    destructive: true,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.blockReasonCode, "BACKUP_UNVERIFIED");
  assert.match(decision.reason, /unverified integrity/);
});

// -------------------------------------------------------------------
// 4. Destructive action requires backup -> blocked without valid backup
// -------------------------------------------------------------------
test("recovery: 4. destructive action without valid backup is blocked", async () => {
  const catalog = new BackupCatalogService(); // empty catalog
  const validator = new DestructiveActionBackupValidator(catalog);

  const decision = await validator.validateBackupForDestructiveAction({
    action: "delete_all_workflows",
    resourceType: "workflow_state",
    environment: "production",
    risk: "high",
    destructive: true,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.blockReasonCode, "BACKUP_MISSING");
  assert.match(decision.reason, /No completed, verified, trusted backup found/);
});

// -------------------------------------------------------------------
// 5. Valid recent backup -> destructive gate may proceed
// -------------------------------------------------------------------
test("recovery: 5. valid recent backup allows destructive gate to proceed", async () => {
  const catalog = new BackupCatalogService();
  const provider = new InMemoryBackupProvider();
  const validator = new DestructiveActionBackupValidator(catalog);

  const validBackup = await provider.createBackup({
    resourceType: "workflow_state",
    environment: "production",
    createdBy: "admin@aiworkforce.internal",
  });

  await catalog.registerBackup(validBackup);

  const decision = await validator.validateBackupForDestructiveAction({
    action: "cleanup_archived_workflows",
    resourceType: "workflow_state",
    environment: "production",
    risk: "high",
    destructive: true,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.blockReasonCode, "BACKUP_VALID");
  assert.equal(decision.backupId, validBackup.id);
});

// -------------------------------------------------------------------
// 6. Backup integrity failure -> backup invalid + high event
// -------------------------------------------------------------------
test("recovery: 6. backup integrity failure reports invalid and emits event", async () => {
  const catalog = new BackupCatalogService();
  const provider = new InMemoryBackupProvider();
  const eventsRepo = new MockSecurityEventsRepo();

  const backup = await provider.createBackup({
    resourceType: "security_policy",
    environment: "production",
    createdBy: "admin",
    payload: { rules: ["deny_all"] },
  });

  // Tamper with record integrity hash
  backup.integrity = { hashAlgorithm: "sha256", hash: "tampered-corrupted-hash-999" };
  await catalog.registerBackup(backup);

  const check = await provider.verifyBackupIntegrity(backup);
  assert.equal(check.verified, false);
  assert.match(check.reason ?? "", /Hash mismatch/);

  // Recovery drill or verification will detect this and emit event
  const recoveryService = new RecoveryService({
    catalog,
    providers: new Map([[provider.name, provider]]),
    securityEvents: eventsRepo as any,
  });

  await assert.rejects(
    recoveryService.executeRecoveryDrill({
      backupId: backup.id,
      conductedBy: "secops",
    }),
    /Backup integrity check failed/,
  );

  assert.ok(
    eventsRepo.events.some((e) => e.eventType === "INTEGRITY_VIOLATION" && e.severity === "HIGH"),
    "Expected INTEGRITY_VIOLATION high event to be emitted",
  );
});

// -------------------------------------------------------------------
// 7. Unauthorized restore -> denied
// -------------------------------------------------------------------
test("recovery: 7. unauthorized restore is denied (AI agents or non-privileged operators)", async () => {
  const catalog = new BackupCatalogService();
  const provider = new InMemoryBackupProvider();
  const recoveryService = new RecoveryService({
    catalog,
    providers: new Map([[provider.name, provider]]),
  });

  const backup = await provider.createBackup({
    resourceType: "operator_access",
    environment: "production",
    createdBy: "admin",
  });
  await catalog.registerBackup(backup);

  const request = await recoveryService.requestRecovery({
    environment: "production",
    requestedBy: "agent-planner",
    reason: "Restoring access controls following issue",
    targetResourceType: "operator_access",
    backupId: backup.id,
  });

  // Attempt approval by an AI agent
  await assert.rejects(
    recoveryService.approveRecovery(request.id, {
      id: "agent-planner",
      role: "admin",
      isHuman: false,
    }),
    /Autonomous agents cannot approve system recovery/,
  );

  // Attempt approval by an unauthorized operator role
  await assert.rejects(
    recoveryService.approveRecovery(request.id, {
      id: "viewer-user",
      role: "viewer",
      isHuman: true,
    }),
    /Operator role 'viewer' is not authorized/,
  );
});

// -------------------------------------------------------------------
// 8. Production restore without approval -> blocked
// -------------------------------------------------------------------
test("recovery: 8. unapproved production restore is blocked from execution", async () => {
  const catalog = new BackupCatalogService();
  const provider = new InMemoryBackupProvider();
  const recoveryService = new RecoveryService({
    catalog,
    providers: new Map([[provider.name, provider]]),
  });

  const backup = await provider.createBackup({
    resourceType: "application_config",
    environment: "production",
    createdBy: "admin",
  });
  await catalog.registerBackup(backup);

  const request = await recoveryService.requestRecovery({
    environment: "production",
    requestedBy: "secops-lead",
    reason: "Rollback corrupted configs",
    targetResourceType: "application_config",
    backupId: backup.id,
  });

  // Execute directly without approval
  await assert.rejects(
    recoveryService.executeRecovery(request.id),
    /Cannot execute recovery in status 'awaiting_approval'. Approval is mandatory./,
  );
});

// -------------------------------------------------------------------
// 9. Incompatible restore target -> blocked
// -------------------------------------------------------------------
test("recovery: 9. incompatible restore target or provider error fails safely", async () => {
  const catalog = new BackupCatalogService();
  const firestoreProvider = new FirestoreBackupProvider("valid-prod-bucket", "ai-workforce-prod");
  const recoveryService = new RecoveryService({
    catalog,
    providers: new Map([[firestoreProvider.name, firestoreProvider]]),
  });

  // Backup pointing outside authorized bucket
  const corruptedBackup: BackupRecord = {
    id: "fs-bad-bucket",
    resourceType: "firestore",
    environment: "production",
    provider: firestoreProvider.name,
    storageReference: "gs://malicious-external-bucket/tampered",
    status: "completed",
    trustStatus: "trusted",
    createdAt: new Date().toISOString(),
    createdBy: "admin",
    automatic: false,
    verification: { verified: true },
    integrity: { hashAlgorithm: "sha256", hash: "manifest-hash" },
    correlationId: "cor-bad",
  };
  await catalog.registerBackup(corruptedBackup);

  const check = await firestoreProvider.verifyBackupIntegrity(corruptedBackup);
  assert.equal(check.verified, false);
  assert.match(check.reason ?? "", /outside authorized backup bucket/);
});

// -------------------------------------------------------------------
// 10. Suspected compromised backup -> review required / blocked
// -------------------------------------------------------------------
test("recovery: 10. suspected or compromised backup blocks restore", async () => {
  const catalog = new BackupCatalogService();
  const provider = new InMemoryBackupProvider();
  const eventsRepo = new MockSecurityEventsRepo();
  const recoveryService = new RecoveryService({
    catalog,
    providers: new Map([[provider.name, provider]]),
    securityEvents: eventsRepo as any,
  });

  const backup = await provider.createBackup({
    resourceType: "project_registry",
    environment: "production",
    createdBy: "admin",
  });
  await catalog.registerBackup(backup);

  // Mark backup as suspected due to intrusion activity
  await catalog.markTrustStatus(backup.id, "suspected", "Potential ransomware encryption window");

  const request = await recoveryService.requestRecovery({
    environment: "production",
    requestedBy: "admin",
    reason: "Recovery attempt with suspected backup",
    targetResourceType: "project_registry",
    backupId: backup.id,
  });

  const safety = await recoveryService.assessRecoverySafety(request.id);
  assert.equal(safety.safeToProceed, false);
  assert.equal(safety.vulnerabilityReintroductionRisk, "high");

  // Attempting to approve must fail
  await assert.rejects(
    recoveryService.approveRecovery(request.id, {
      id: "admin-human",
      role: "admin",
      isHuman: true,
      mfaVerified: true,
    }),
    /Safety assessment failed/,
  );
});

// -------------------------------------------------------------------
// 11. Backup deletion attempt -> passes governed destructive path
// -------------------------------------------------------------------
test("recovery: 11. privileged operator with justification can delete expired backup", async () => {
  const catalog = new BackupCatalogService();
  const provider = new InMemoryBackupProvider();
  const eventsRepo = new MockSecurityEventsRepo();
  const recoveryService = new RecoveryService({
    catalog,
    providers: new Map([[provider.name, provider]]),
    securityEvents: eventsRepo as any,
  });

  // Create backup whose retention already expired
  const expiredBackup = await provider.createBackup({
    resourceType: "other",
    environment: "test",
    createdBy: "admin",
    retentionDays: -1, // in the past
  });
  await catalog.registerBackup(expiredBackup);

  const result = await recoveryService.deleteBackup(
    expiredBackup.id,
    {
      id: "secops-operator-1",
      role: "secops_lead",
      isHuman: true,
      mfaVerified: true,
    },
    "Routine decommission of test backup after scheduled retention expired",
  );

  assert.equal(result.allowed, true);
  const exists = await catalog.getBackup(expiredBackup.id);
  assert.equal(exists, undefined, "Expired backup should be safely removed from catalog");
});

// -------------------------------------------------------------------
// 12. Normal user or AI agent deletes backup -> denied
// -------------------------------------------------------------------
test("recovery: 12. normal user or AI agent deleting backup is denied", async () => {
  const catalog = new BackupCatalogService();
  const provider = new InMemoryBackupProvider();
  const eventsRepo = new MockSecurityEventsRepo();
  const recoveryService = new RecoveryService({
    catalog,
    providers: new Map([[provider.name, provider]]),
    securityEvents: eventsRepo as any,
  });

  const backup = await provider.createBackup({
    resourceType: "firestore",
    environment: "production",
    createdBy: "admin",
  });
  await catalog.registerBackup(backup);

  // 1. AI agent attempt
  const agentAttempt = await recoveryService.deleteBackup(
    backup.id,
    { id: "agent-cleanup", role: "admin", isHuman: false },
    "Attempting automated disk cleanup",
  );
  assert.equal(agentAttempt.allowed, false);

  // 2. Normal developer/user attempt
  const userAttempt = await recoveryService.deleteBackup(
    backup.id,
    { id: "dev-user", role: "developer", isHuman: true },
    "Cleaning up old backups",
  );
  assert.equal(userAttempt.allowed, false);

  // 3. Immutable retention lock protection
  const immutableBackup = await provider.createBackup({
    resourceType: "firestore",
    environment: "production",
    createdBy: "admin",
    immutableRetention: true,
  });
  await catalog.registerBackup(immutableBackup);

  const immutableAttempt = await recoveryService.deleteBackup(
    immutableBackup.id,
    { id: "admin-user", role: "admin", isHuman: true, mfaVerified: true },
    "Force delete protected immutable recovery archive",
  );
  assert.equal(immutableAttempt.allowed, false);
  assert.match(immutableAttempt.reason, /immutable retention lock/);
});

// -------------------------------------------------------------------
// 13. Successful restore -> verification before recovered status
// -------------------------------------------------------------------
test("recovery: 13. successful restore executes verification before setting recovered status", async () => {
  const catalog = new BackupCatalogService();
  const provider = new InMemoryBackupProvider();
  const eventsRepo = new MockSecurityEventsRepo();
  const recoveryService = new RecoveryService({
    catalog,
    providers: new Map([[provider.name, provider]]),
    securityEvents: eventsRepo as any,
  });

  const backup = await provider.createBackup({
    resourceType: "application_config",
    environment: "production",
    createdBy: "admin",
    payload: { state: "healthy" },
  });
  await catalog.registerBackup(backup);

  const request = await recoveryService.requestRecovery({
    environment: "production",
    requestedBy: "operator",
    reason: "Safe restore test",
    targetResourceType: "application_config",
    backupId: backup.id,
  });

  await recoveryService.assessRecoverySafety(request.id);
  await recoveryService.approveRecovery(request.id, {
    id: "admin-human",
    role: "admin",
    isHuman: true,
    mfaVerified: true,
  });

  const result = await recoveryService.executeRecovery(request.id, {
    customHealthCheck: async () => true, // Health check passes
  });

  assert.equal(result.status, "recovered");
  assert.ok(result.verificationDetails);
  assert.equal(result.verificationDetails.verified, true);
  assert.equal(result.verificationDetails.applicationHealthHealthy, true);
});

// -------------------------------------------------------------------
// 14. Failed verification -> recovery failed
// -------------------------------------------------------------------
test("recovery: 14. post-restore verification failure sets recovery status to failed", async () => {
  const catalog = new BackupCatalogService();
  const provider = new InMemoryBackupProvider();
  const eventsRepo = new MockSecurityEventsRepo();
  const recoveryService = new RecoveryService({
    catalog,
    providers: new Map([[provider.name, provider]]),
    securityEvents: eventsRepo as any,
  });

  const backup = await provider.createBackup({
    resourceType: "application_config",
    environment: "production",
    createdBy: "admin",
  });
  await catalog.registerBackup(backup);

  const request = await recoveryService.requestRecovery({
    environment: "production",
    requestedBy: "operator",
    reason: "Restore attempt",
    targetResourceType: "application_config",
    backupId: backup.id,
  });

  await recoveryService.assessRecoverySafety(request.id);
  await recoveryService.approveRecovery(request.id, {
    id: "admin-human",
    role: "admin",
    isHuman: true,
    mfaVerified: true,
  });

  const result = await recoveryService.executeRecovery(request.id, {
    customHealthCheck: async () => false, // Health check fails!
  });

  assert.equal(result.status, "failed");
  assert.ok(result.verificationDetails);
  assert.equal(result.verificationDetails.verified, false);
  assert.match(result.verificationDetails.failureReason ?? "", /Application health check failed/);
});

// -------------------------------------------------------------------
// 15. Recovery drill -> records successful restore test
// -------------------------------------------------------------------
test("recovery: 15. disaster recovery drill records successful test and updates catalog", async () => {
  const catalog = new BackupCatalogService();
  const provider = new InMemoryBackupProvider();
  const recoveryService = new RecoveryService({
    catalog,
    providers: new Map([[provider.name, provider]]),
  });

  const backup = await provider.createBackup({
    resourceType: "application_config",
    environment: "production",
    createdBy: "admin",
  });
  await catalog.registerBackup(backup);

  const drill = await recoveryService.executeRecoveryDrill({
    backupId: backup.id,
    conductedBy: "secops-officer-9",
    isolatedTarget: "isolated_sandbox_test",
  });

  assert.ok(drill.id);
  assert.equal(drill.success, true);
  assert.equal(drill.verification.verified, true);
  assert.ok(drill.durationMs >= 0);

  // Verify catalog summary reflects the drill
  const summary = await catalog.getSecuritySummary();
  assert.ok(summary.lastRestoreTest);
});

// -------------------------------------------------------------------
// 16. Security Policy Engine integration & policy compliance
// -------------------------------------------------------------------
test("recovery: 16. SecurityPolicyEngine enforces backup deletion & recovery invariants", async () => {
  const engine = new SecurityPolicyEngine();

  // Test 1: Deletion of backup protected by immutable retention invariant is blocked
  const immutableDecision = engine.evaluate({
    action: "delete_backup",
    actorId: "super_admin",
    actorType: "human",
    destructive: true,
    irreversible: true,
    production: true,
    requestedAt: new Date().toISOString(),
    metadata: { immutableRetentionActive: true },
  });
  assert.equal(immutableDecision.allowed, false);
  assert.match(immutableDecision.reason, /immutable retention lock is forbidden/);

  // Test 2: Standard backup deletion requires approval, re-auth, MFA, and two-person approval
  const standardDeletionDecision = engine.evaluate({
    action: "delete_backup",
    actorId: "admin",
    actorType: "human",
    destructive: true,
    irreversible: true,
    production: true,
    requestedAt: new Date().toISOString(),
  });
  assert.equal(standardDeletionDecision.requiresApproval, true);
  assert.equal(standardDeletionDecision.requiresMfa, true);
  assert.equal(standardDeletionDecision.requiresTwoPersonApproval, true);
  assert.equal(standardDeletionDecision.risk, "critical");

  // Test 3: System recovery execution is critical risk requiring approval
  const recoveryDecision = engine.evaluate({
    action: "restore_backup",
    actorId: "admin",
    actorType: "human",
    destructive: false,
    irreversible: false,
    production: true,
    requestedAt: new Date().toISOString(),
  });
  assert.equal(recoveryDecision.requiresApproval, true);
  assert.equal(recoveryDecision.risk, "critical");
});

// -------------------------------------------------------------------
// 17. Policy Compliance & RPO enforcement
// -------------------------------------------------------------------
test("recovery: 17. policy compliance detects missing and stale backups against RPO", async () => {
  const catalog = new BackupCatalogService();
  const provider = new InMemoryBackupProvider();

  const policies: BackupPolicy[] = [
    {
      id: "bp-firestore",
      resourceType: "firestore",
      enabled: true,
      retentionDays: 30,
      minimumCopies: 2,
      immutableRetentionPreferred: true,
      backupBeforeDestructiveAction: true,
      verifyAfterBackup: true,
      restoreTestIntervalDays: 30,
      environment: "production",
      rpoHours: 24,
      rtoHours: 4,
    },
    {
      id: "bp-config",
      resourceType: "application_config",
      enabled: true,
      retentionDays: 90,
      minimumCopies: 1,
      immutableRetentionPreferred: false,
      backupBeforeDestructiveAction: true,
      verifyAfterBackup: true,
      restoreTestIntervalDays: 60,
      environment: "production",
      rpoHours: 12,
      rtoHours: 2,
    },
  ];

  // Currently empty: both should be missing
  const report1 = await catalog.checkPolicyCompliance(policies);
  assert.equal(report1.compliant, false);
  assert.equal(report1.missingBackups.length, 2);

  // Add fresh config backup
  const configBackup = await provider.createBackup({
    resourceType: "application_config",
    environment: "production",
    createdBy: "admin",
  });
  await catalog.registerBackup(configBackup);

  // Config is satisfied, firestore is still missing
  const report2 = await catalog.checkPolicyCompliance(policies);
  assert.equal(report2.compliant, false);
  assert.deepEqual(report2.missingBackups, ["firestore"]);
});
