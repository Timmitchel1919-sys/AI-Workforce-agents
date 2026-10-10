/**
 * Trust Center, Frameworks, Audit Readiness
 */
export const COMPLIANCE_POSTURE_STATES = [
  "NOT_ASSESSED",
  "IN_PROGRESS",
  "EVIDENCE_INCOMPLETE",
  "READY_FOR_REVIEW",
  "REVIEWED",
] as const;
export type CompliancePostureState = (typeof COMPLIANCE_POSTURE_STATES)[number];

export interface CompliancePosture {
  postureId: string;
  organizationId: string;
  frameworkId?: string;
  frameworkVersion?: string;
  scope: string;
  state: CompliancePostureState;
  applicableControls: number;
  controlsImplemented: number;
  controlsTested: number;
  controlsPassing: number;
  evidenceCurrent: number;
  evidenceStale: number;
  openRisks: number;
  activeExceptions: number;
  openFindings: number;
  readinessPercentage?: number;
  readinessMethodology?: string;
  assessedAt?: string;
  updatedAt: string;
}

export interface AuditReadiness {
  auditId: string;
  organizationId: string;
  frameworkId: string;
  frameworkVersion: string;
  scope: string;
  status: "PREPARING" | "READY" | "IN_REVIEW" | "COMPLETE";
  missingEvidence: readonly string[];
  staleEvidence: readonly string[];
  failedTests: readonly string[];
  exceptions: readonly string[];
  openRisks: readonly string[];
  missingOwners: readonly string[];
  updatedAt: string;
}

export interface AuditPackage {
  packageId: string;
  organizationId: string;
  auditId: string;
  scope: string;
  controlRefs: readonly string[];
  testRefs: readonly string[];
  evidenceRefs: readonly string[];
  policyRefs: readonly string[];
  exceptionRefs: readonly string[];
  riskRefs: readonly string[];
  createdAt: string;
  createdBy: string;
  expiresAt?: string;
  classification: "INTERNAL" | "RESTRICTED" | "CONFIDENTIAL";
}

export interface CertificationRecord {
  certificationId: string;
  organizationId: string;
  frameworkId: string;
  frameworkName: string;
  issuer: string;
  scope: string;
  issuedAt: string;
  expiresAt: string;
  documentRef?: string;
  verificationStatus: "VERIFIED" | "UNVERIFIED" | "EXPIRED";
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
}

export interface TrustCenterContent {
  contentId: string;
  type: "INTERNAL" | "CUSTOMER" | "PUBLIC";
  section: string;
  title: string;
  content: string;
  approved: boolean;
  approvedBy?: string;
  approvedAt?: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export const FINDING_SEVERITIES = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_STATES = ["OPEN", "ACKNOWLEDGED", "REMEDIATING", "RESOLVED", "ACCEPTED", "FALSE_POSITIVE"] as const;
export type FindingState = (typeof FINDING_STATES)[number];

export interface ControlFinding {
  findingId: string;
  organizationId: string;
  controlId: string;
  instanceId?: string;
  scope: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  evidence: readonly string[];
  status: FindingState;
  owner: string;
  remediationRef?: string;
  riskRef?: string;
  createdAt: string;
  resolvedAt?: string;
  acceptedAt?: string;
  falsePositiveAt?: string;
}
