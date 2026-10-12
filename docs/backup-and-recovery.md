# AI Workforce — Backup, Recovery & Ransomware Resilience Architecture (Step 9)

## 1. Overview & Core Principle

This architecture establishes the resilience, disaster recovery (DR), and ransomware protection foundation for the AI Workforce OS.

> **Core Principle**: A backup is not successful merely because a file, snapshot, or export exists. A backup is successful **only if it can be verified, isolated, and restored without corrupting production or reintroducing vulnerabilities.**

### Target Resilience Pipeline

```
Production State
  │
  ▼
Backup Policy (RPO / RTO targets)
  │
  ▼
Scheduled / Event-Triggered Backup
  │
  ▼
Integrity Validation (SHA-256 / GCS Manifest)
  │
  ▼
Protected Backup Storage (WORM / Retention Locks)
  │
  ▼
Backup Catalog (Authoritative registry & trust status)
  │
  ▼
Restore Test / Recovery Drill (Isolated Sandbox)
  │
  ▼
Recovery Safety Assessment (Blast radius & compromise check)
  │
  ▼
Human Operator Approval Gate (MFA + Two-Person Rule for Prod)
  │
  ▼
Governed Restore (Isolated Target or Production)
  │
  ▼
Post-Restore Verification (Health, Access Control, Policies)
  │
  ▼
Normalized Security & Audit Events
```

---

## 2. Resource Classification & RPO/RTO Model

| Resource Type | Criticality | RPO (Max Data Loss) | RTO (Max Downtime) | Backup Strategy | Storage Location |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`firestore`** | Mission-Critical | 24 hours (Daily export) | 4 hours | Google Cloud Firestore Managed Export with bucket object retention | Separate protected GCS bucket (`gs://aiw-backups-protected-prod/`) |
| **`security_policy`** | Mission-Critical | Immediate (Change-triggered) | 15 minutes | Change-triggered versioned snapshot in Config Vault | Immutable encrypted storage |
| **`operator_access`** | Mission-Critical | Immediate (Change-triggered) | 30 minutes | Change-triggered versioned snapshot with signature | Protected configuration catalog |
| **`project_registry`** | High | 12 hours | 1 hour | Daily snapshot + change-triggered export | Config Vault / Firestore export |
| **`application_config`** | High | 24 hours | 1 hour | Configuration snapshot with SHA-256 digest | Config Vault |
| **`storage`** (Evidence/Assets) | High | 24 hours | 4 hours | Dual-region Cloud Storage replication | Protected WORM bucket |
| **`workflow_state`** | Medium | 12 hours | 2 hours | Checkpoint exports before major transitions | State store / Firestore |
| **`source_repository`** | High | Git Commit HEAD | 30 minutes | GitHub remote with protected branch commits | GitHub origin |

---

## 3. Centrally Governed Backup Policies

Backup policies (`BackupPolicy`) are authoritative, server-governed contracts defined in [contracts/recovery.ts](file:///c:/Users/Administrator/Downloads/AI%20Webapp%20Projects/Ai%20worforce%20agents/contracts/recovery.ts). Clients cannot redefine or loosen backup policies directly.

Key policy properties:
- `retentionDays`: Mandatory minimum time to retain backup records and underlying data.
- `immutableRetentionPreferred`: Indicates whether cloud object retention locks (WORM) must be active.
- `backupBeforeDestructiveAction`: When `true`, enforces that high/critical destructive operations cannot proceed unless a verified fresh backup exists.
- `verifyAfterBackup`: Automatically runs checksum and integrity verification upon backup completion.
- `restoreTestIntervalDays`: Cadence at which DR drills must be performed.

---

## 4. Integration with Destructive Action Approval Gate

Destructive operations (e.g. purging databases, mass de-provisioning, deleting policies) cannot be executed merely on operator command:

1. **Pre-Action Backup Validation** (`DestructiveActionBackupValidator`):
   - Queries `BackupCatalogService` for the newest valid restore point.
   - Enforces:
     - `status === "completed"`
     - `verification.verified === true`
     - `trustStatus === "trusted"` (not suspected or compromised)
     - `age <= policy.rpoHours`
   - Rejects client assertions (such as `backupAvailable: true`). Evidence must originate from authoritative `BackupRecord`s.
2. **Fail-Closed Behavior**:
   - If the backup catalog service or verification engine is unavailable, all destructive HIGH and CRITICAL actions are immediately **denied**.

---

## 5. Cloud Architecture: Firestore & Storage Backups

### Firestore Backups
- **Server-Only Invocation**: Direct client browser access to backup APIs is denied by default.
- **Provider Abstraction** (`FirestoreBackupProvider`):
  - Wraps Google Cloud `firestore.projects.databases.exportDocuments`.
  - Backups write to an isolated Google Cloud Storage bucket (`gs://aiw-backups-protected-prod/`) that has strict IAM separation from application workloads.
  - Client SDKs cannot read or write `/backups/` or `/backup_records/` as enforced by [firestore.rules](file:///c:/Users/Administrator/Downloads/AI%20Webapp%20Projects/Ai%20worforce%20agents/firestore.rules).

### Firebase Storage Assets
- Ephemeral build outputs and temporary caches are filtered out.
- Critical assets (user avatars, legal/compliance evidence, uploaded blueprints) are backed up to protected replication locations with bucket-level object versioning enabled.
- Direct client writes to `/backups/**` and `/exports/**` are blocked in [storage.rules](file:///c:/Users/Administrator/Downloads/AI%20Webapp%20Projects/Ai%20worforce%20agents/storage.rules).

---

## 6. Ransomware Resilience & Protected Backup Deletion

To minimize destructive attack blast radius and neutralize ransomware adversaries:

1. **Credential Separation**: Backup storage buckets use dedicated service account identities with object-lock permissions not held by application runtime identities.
2. **Immutable Retention Locks (WORM)**:
   - When `immutableRetention: true` is configured, neither administrators nor automated systems can delete or overwrite the underlying backup object until the retention period elapses.
3. **Protected Deletion Path**:
   - Backup deletion attempts must pass:
     - Actor validation: Must be a human operator with `admin` or `secops_lead` role (AI agents are completely prohibited).
     - Substantive justification (minimum 15 characters).
     - MFA re-authentication.
     - Retention period validation (active retention blocks deletion).
     - Security Policy Engine invariant check (`sp-backup-deletion-protection`).

---

## 7. Compromised Backup Handling & Safety Assessment

During a cyber incident (e.g., adversary intrusion or ransomware infection), backups created after the attacker gained access may contain malicious persistence, compromised configs, or encrypted databases.

1. **Trust Status Flagging**:
   - Backups are tagged with `trustStatus: "trusted" | "suspected" | "compromised" | "unknown"`.
2. **Incident Timeline Linkage**:
   - When a `RecoveryRequest` is created with an `incidentId`, `assessRecoverySafety()` correlates the backup timestamp against the known incident compromise time.
   - If `backup.createdAt >= incident.compromiseTime`, the backup is automatically flagged as **SUSPECTED** or **COMPROMISED**, and recovery is blocked.
3. **Safety Assessment**:
   - Evaluates overwritten state risk, post-backup changes, vulnerability reintroduction, and schema compatibility before allowing operator approval.

---

## 8. Governed Recovery Approvals & Isolated Drills

### Human Approval for Recovery
- Production database recovery, security policy restores, and access control recoveries require explicit **human approval** by a designated SecOps Lead or Administrator with **MFA**.
- Autonomous AI agents cannot approve their own or production restores.

### Isolated Disaster Recovery Drills
- Drills (`executeRecoveryDrill`) restore backups to isolated sandboxes (`isolatedTarget: "isolated_drill_sandbox"`), executing end-to-end schema validation, integrity checks, and application health assessments.
- Successful drills update the catalog's `lastRestoreTest` timestamp, proving recoverability without impacting production operations.

---

## 9. Normalized Security Events

The recovery engine emits normalized `ZTNSecurityEvent`s into the Security Operations stream for:
- `backup_requested`, `backup_started`, `backup_completed`, `backup_failed`
- `backup_verification_failed` (`INTEGRITY_VIOLATION`, Severity: HIGH)
- `suspected_compromised_backup` (`INTEGRITY_VIOLATION`, Severity: CRITICAL)
- `backup_delete_denied` (`ANOMALOUS_ACCESS`, Severity: CRITICAL)
- `recovery_requested`, `recovery_approved`, `recovery_started`
- `recovery_succeeded` (Severity: HIGH)
- `recovery_failed` (Severity: CRITICAL)
- `restore_verification_failed` (Severity: CRITICAL)
