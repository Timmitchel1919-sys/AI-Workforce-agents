export interface SecurityEvent {
  eventId: string;
  organizationId: string;
  source: "API" | "AUTH" | "WEBHOOK" | "PLATFORM";
  type:
    | "FAILED_LOGIN"
    | "API_ABUSE"
    | "DATA_EXFILTRATION_ATTEMPT"
    | "SUSPICIOUS_IP";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  actor: string; // userId, ipAddress, or apiKeyPrefix
  details: Record<string, unknown>;
  timestamp: Date;
}

export interface ThreatRule {
  ruleId: string;
  organizationId: string;
  name: string;
  condition:
    "RATE_LIMIT_EXCEEDED" | "GEO_FENCE_VIOLATION" | "DLP_VIOLATION_SPIKE";
  threshold: number;
  timeWindowSeconds: number;
  action: "ALERT" | "BLOCK_USER" | "REVOKE_KEY" | "IP_BAN";
  status: "ACTIVE" | "INACTIVE";
}

export interface SecurityIncident {
  incidentId: string;
  organizationId: string;
  title: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "INVESTIGATING" | "MITIGATED" | "RESOLVED";
  relatedEvents: string[]; // eventIds
  createdAt: Date;
  resolvedAt?: Date;
}

export interface ThreatIntel {
  intelId: string;
  organizationId: string;
  indicator: string;
  type: "MALWARE" | "PHISHING" | "BOTNET" | "ANOMALY";
  confidenceScore: number;
  validUntil: Date;
}

export interface Vulnerability {
  vulnerabilityId: string;
  organizationId: string;
  cveId?: string;
  title: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  affectedComponent: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "ACCEPTED_RISK";
  discoveredAt: Date;
  remediatedAt?: Date;
}

export interface AccessRequest {
  requestId: string;
  organizationId: string;
  requesterId: string;
  targetResourceId: string;
  justification: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "REVOKED";
  requestedAt: Date;
  decidedAt?: Date;
  decidedBy?: string;
}

/** Layer 9: immutable backup and recovery state. */
export type BackupArtifactStatus =
  | "CREATED"
  | "UPLOADING"
  | "STORED"
  | "VERIFYING"
  | "VERIFIED"
  | "DEGRADED"
  | "CORRUPT"
  | "EXPIRED"
  | "FAILED";

export interface BackupPolicy {
  policyId: string;
  organizationId: string;
  name: string;
  schedule: string;
  retentionDays: number;
  immutable: boolean;
  isolated: boolean;
  enabled: boolean;
}

export interface BackupArtifact {
  artifactId: string;
  policyId: string;
  organizationId: string;
  createdAt: Date;
  expiresAt: Date;
  status: BackupArtifactStatus;
  contentHash: string;
  manifestHash: string;
  storageLocator: string;
}

export interface RestorePlan {
  restorePlanId: string;
  organizationId: string;
  artifactId: string;
  targetEnvironment: "local" | "test" | "staging" | "production";
  validationChecks: string[];
  destructiveActionId?: string;
}

export interface RecoveryPoint {
  artifactId: string;
  organizationId: string;
  verifiedAt: Date;
  integrity: "VERIFIED" | "DEGRADED" | "CORRUPT";
  tested: boolean;
}

/** Layer 11: normalized, explainable detection output. */
export interface NormalizedSecuritySignal {
  signalId: string;
  organizationId: string;
  source: SecurityEvent["source"];
  kind: string;
  actor: string;
  observedAt: Date;
  attributes: Record<string, string | number | boolean>;
}

export interface SecurityFinding {
  findingId: string;
  organizationId: string;
  signalIds: string[];
  ruleId: string;
  riskScore: number;
  rationale: string[];
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "SUPPRESSED";
  createdAt: Date;
}

export type BackupLifecycle = "ACTIVE" | "RETENTION_LOCKED" | "EXPIRED" | "ELIGIBLE_FOR_DELETION" | "DELETED";
export interface BackupJob { id: string; jobId: string; policyId: string; organizationId: string; status: "CREATED" | "RUNNING" | "VERIFIED" | "FAILED"; artifactId?: string; startedAt: Date; completedAt?: Date; error?: string; }
export interface BackupManifest { id: string; manifestId: string; artifactId: string; organizationId: string; sourceFingerprint: string; manifestHash: string; createdAt: Date; }
export interface RestoreJob { id: string; restoreJobId: string; restorePlanId: string; status: "CREATED" | "RUNNING" | "VERIFIED" | "FAILED"; startedAt: Date; completedAt?: Date; }
export interface RestoreVerification { id: string; verificationId: string; restoreJobId: string; integrity: "VERIFIED" | "FAILED"; checks: string[]; verifiedAt: Date; }
export interface RecoveryDrill { id: string; drillId: string; recoveryPointId: string; status: "RUNNING" | "PASSED" | "FAILED"; startedAt: Date; completedAt?: Date; measuredRpo?: number; measuredRto?: number; failures: string[]; }

export type IncidentLifecycle = "DETECTED" | "TRIAGED" | "INVESTIGATING" | "CONTAINED" | "REMEDIATING" | "RECOVERING" | "RESOLVED" | "POSTMORTEM" | "CLOSED";
export type IncidentSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export interface SecurityIncidentV2 { id: string; incidentId: string; organizationId: string; title: string; severity: IncidentSeverity; status: IncidentLifecycle; createdAt: Date; updatedAt: Date; findingIds: string[]; evidenceIds: string[]; }
export interface IncidentEvidence { id: string; evidenceId: string; incidentId: string; source: string; resourceRef: string; occurredAt: Date; fingerprint: string; classification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL"; integrityRef: string; }
export interface IncidentTimelineEntry { id: string; incidentId: string; type: string; occurredAt: Date; actorId: string; canonicalEventId?: string; reference?: string; }
export interface SecurityPostmortem { id: string; postmortemId: string; incidentId: string; summary: string; rootCause: string; correctiveActions: string[]; createdAt: Date; finalizedAt?: Date; version: number; }
