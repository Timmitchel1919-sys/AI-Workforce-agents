# AI Workforce — Disaster Recovery Operating Runbooks

This guide provides operational procedures for responding to data loss, corruption, compromise, and disaster recovery scenarios in the AI Workforce platform.

Every recovery procedure follows the 8-phase lifecycle:
1. **Contain**: Prevent further corruption or unauthorized mutations.
2. **Assess**: Determine blast radius, affected services, and root cause.
3. **Select Recovery Point**: Identify the newest verified, untainted backup in the Backup Catalog.
4. **Obtain Approval**: Complete governed human approval (with MFA).
5. **Restore**: Execute controlled restore to an isolated target or target environment.
6. **Verify**: Run end-to-end post-restore verification checks.
7. **Monitor**: Observe operational metrics and security logs for anomalies.
8. **Document Incident**: Record post-mortem and update recovery drill records.

---

## Runbook 1: Accidental Firestore Deletion or Data Loss

### Trigger
Accidental execution of destructive operations, failed migration script, or inadvertent deletion of Firestore collections (`projects`, `operators`, `workflows`).

### Procedure
1. **Contain**:
   - Immediately suspend write operations via Control Plane or enable maintenance mode.
   - Halt active workforce execution queues.
2. **Assess**:
   - Identify deleted collections and records affected.
   - Confirm whether the deletion affected production or non-production.
3. **Select Recovery Point**:
   - Query `BackupCatalogService` for the newest valid `firestore` backup:
     ```typescript
     const backup = await catalog.getNewestValidRestorePoint({
       resourceType: "firestore",
       environment: "production"
     });
     ```
   - Verify `trustStatus === "trusted"` and `verification.verified === true`.
4. **Obtain Approval**:
   - Create `RecoveryRequest` with target `firestore`.
   - Obtain human approval from SecOps Lead or System Recovery Officer with MFA.
5. **Restore**:
   - First restore into a temporary/staging database to validate data integrity.
   - Execute controlled import via `FirestoreBackupProvider` / Cloud Console.
6. **Verify**:
   - Execute `RestoreVerificationResult`: verify collection counts, record schemas, and indexes.
   - Confirm security policies and operator profiles are fully intact.
7. **Monitor**:
   - Re-enable Control Plane traffic gradually; watch error logs and Firestore latency.
8. **Document Incident**:
   - Log post-mortem detailing trigger cause and time-to-restore (RTO achieved).

---

## Runbook 2: Bad Production Deployment

### Trigger
A deployment passes CI but introduces a severe runtime failure, memory leak, or broken routing in production.

### Procedure
1. **Contain**:
   - Pause further rollout; block incoming non-essential traffic if service is crashing.
2. **Assess**:
   - Inspect release logs and production verification report (`scripts/verify-production.mjs`).
   - Identify failing endpoints or bundle assets.
3. **Select Recovery Point**:
   - Identify last known healthy release ID and Git commit SHA via `DeploymentOrchestrator` ledger.
4. **Obtain Approval**:
   - Request release rollback approval through the Control Plane approval gate:
     ```typescript
     orchestrator.rollback(principal, projectId, { targetReleaseId: previousHealthyId });
     ```
5. **Restore**:
   - Execute automated or governed rollback to previous healthy artifact.
6. **Verify**:
   - Run production verification stage:
     ```bash
     npm run verify:production -- --base https://<app-domain>
     ```
7. **Monitor**:
   - Monitor error rates, latency percentiles, and application health for 30 minutes.
8. **Document Incident**:
   - File deployment regression report and quarantine faulty commit.

---

## Runbook 3: Corrupted Configuration State

### Trigger
Invalid configuration applied to security settings, budget policies, or agent capability mappings.

### Procedure
1. **Contain**:
   - Freeze configuration updates; reject incoming configuration mutations.
2. **Assess**:
   - Diff active configuration against previous known-good state.
3. **Select Recovery Point**:
   - Query `application_config` snapshots from the Configuration Backup Vault.
4. **Obtain Approval**:
   - Request SecOps admin approval for configuration rollback.
5. **Restore**:
   - Restore sanitized configuration snapshot via `ConfigurationBackupProvider`.
6. **Verify**:
   - Verify configuration schema and run policy engine dry-run evaluation.
7. **Monitor**:
   - Verify agent task assignments resume normal execution without configuration errors.
8. **Document Incident**:
   - Record change-management incident and update config admission validation.

---

## Runbook 4: Compromised Privileged Account

### Trigger
Credentials or session tokens for an operator or admin are leaked or used anomalously.

### Procedure
1. **Contain**:
   - Immediately revoke active sessions, revoke Firebase Auth tokens, and lock the operator profile (`status = "suspended"`).
   - Invalidate any issued temporary API keys or write leases.
2. **Assess**:
   - Review audit logs for actions performed by the compromised account between compromise timestamp and revocation timestamp.
   - Determine whether security policies, backups, or access controls were altered.
3. **Select Recovery Point**:
   - Identify backups of `operator_access` and `security_policy` created **BEFORE** the initial compromise time.
   - Mark any backups created during the compromise window as **SUSPECTED** or **COMPROMISED**.
4. **Obtain Approval**:
   - Two-person rule: Super Admin and SecOps Lead must approve identity state restoration.
5. **Restore**:
   - Restore access control and security policies to pre-compromise baseline.
6. **Verify**:
   - Validate operator roster, active permissions, and MFA status.
7. **Monitor**:
   - Heightened alerting on all authentication and authorization events for 72 hours.
8. **Document Incident**:
   - File Security Incident report; rotate signing secrets and affected credentials.

---

## Runbook 5: Suspected Ransomware or Destructive Cyber Attack

### Trigger
Unauthorized mass deletion attempts, encryption of documents, or anomalous destructive commands detected.

### Procedure
1. **Contain**:
   - Trigger Emergency Break-Glass Lockdown: sever external API traffic and revoke write scopes.
   - Isolate active execution environments and databases.
2. **Assess**:
   - Identify infected systems, affected collections, and adversary ingress vector.
   - Establish precise Incident Compromise Timestamp ($T_{compromise}$).
3. **Select Recovery Point**:
   - Filter `BackupCatalog`:
     - Select backups created **PRIOR** to $T_{compromise}$.
     - Verify immutable retention lock status on protected backup buckets (`immutableRetention: true`).
     - Flag all subsequent backups as **COMPROMISED**.
4. **Obtain Approval**:
   - Executive & SecOps recovery authorization required.
5. **Restore**:
   - Stand up a clean, isolated staging environment.
   - Restore databases and configuration into the clean sandbox first.
   - Perform full malware and integrity scans on restored data.
6. **Verify**:
   - Verify zero adversary persistence, clean SHA-256 manifests, intact security rules, and functioning access boundaries.
   - Validate cutover readiness before switching production DNS/routing.
7. **Monitor**:
   - Implement continuous egress and anomaly monitoring.
8. **Document Incident**:
   - Produce comprehensive forensics report, update Disaster Recovery Drills, and file compliance notifications if required.

---

## Runbook 6: Lost Project Registration

### Trigger
Accidental removal or corruption of a project registration document in the project registry.

### Procedure
1. **Contain**:
   - Prevent dependent agents from attempting tasks against undefined project targets.
2. **Assess**:
   - Identify missing project ID and associated repository/workspace mappings.
3. **Select Recovery Point**:
   - Query `project_registry` backup from catalog.
4. **Obtain Approval**:
   - Project Owner or Admin approval.
5. **Restore**:
   - Restore project metadata into `projects` collection from backup record.
6. **Verify**:
   - Verify project claims, workspaces, and agent assignment capabilities.
7. **Monitor**:
   - Confirm project tasks resume scheduling.
8. **Document Incident**:
   - Log recovery event.

---

## Runbook 7: Failed Security Policy Deployment

### Trigger
A security policy update inadvertently blocks legitimate operational commands or creates an unauthorized permissive gap.

### Procedure
1. **Contain**:
   - If policies are overly permissive, switch policy engine to default-deny fallback mode.
2. **Assess**:
   - Review policy evaluation audit logs to identify faulty rule IDs.
3. **Select Recovery Point**:
   - Retrieve previous version of `security_policy` snapshot.
4. **Obtain Approval**:
   - SecOps Lead approval with MFA.
5. **Restore**:
   - Revert policies to the last known-good policy set.
6. **Verify**:
   - Execute policy engine test suite (`npm test dist/tests/security-policy-engine.test.js`).
7. **Monitor**:
   - Ensure authorized commands succeed while blocked operations remain denied.
8. **Document Incident**:
   - Update policy regression test fixtures.

---

## Runbook 8: Unavailable Current Release

### Trigger
Hosting CDN, cloud functions, or edge deployment becomes completely unavailable or damaged.

### Procedure
1. **Contain**:
   - Reroute traffic to secondary region or maintenance status page.
2. **Assess**:
   - Determine provider outage vs bundle corruption.
3. **Select Recovery Point**:
   - Select verified build artifact from build provenance registry (`BuildProvenance`).
4. **Obtain Approval**:
   - Release Manager approval.
5. **Restore**:
   - Redeploy verified build artifact to target infrastructure.
6. **Verify**:
   - Run automated verification probe (`scripts/verify-production.mjs`).
7. **Monitor**:
   - Verify traffic returns to normal.
8. **Document Incident**:
   - Record outage duration and calculate SLA impact.
