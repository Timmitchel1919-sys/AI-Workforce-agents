/**
 * Security Build & Secure SDLC Contracts (Step 8).
 *
 * Defines verification gates, check types, vulnerability findings,
 * supply-chain risk policy, build provenance, and security exceptions.
 *
 * CRITICAL INVARIANT: Raw secrets must NEVER appear in findings or audit outputs.
 */

export type SecurityCheckType =
  | "lint"
  | "typecheck"
  | "test"
  | "secret_scan"
  | "dependency_scan"
  | "sast"
  | "sbom"
  | "license_scan"
  | "build"
  | "provenance"
  | "artifact_integrity";

export type SecurityCheckStatus =
  | "pending"
  | "passed"
  | "failed"
  | "warning"
  | "skipped"
  | "unavailable";

export type SecurityFindingSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface SecurityFinding {
  id: string;
  checkType: SecurityCheckType;
  severity: SecurityFindingSeverity;
  title: string;
  description: string;
  filePath?: string;
  packageName?: string;
  dependencyVersion?: string;
  advisoryId?: string;
  ruleId?: string;
  remediation?: string;
  blocking: boolean;
  detectedAt: string;
}

export interface SecurityCheckResult {
  checkType: SecurityCheckType;
  status: SecurityCheckStatus;
  durationMs: number;
  findingsCount: number;
  summary?: string;
}

export interface SecurityGateResult {
  allowed: boolean;
  environment: string;
  findings: readonly SecurityFinding[];
  blockingFindings: readonly string[];
  checks: readonly SecurityCheckResult[];
  reason: string;
  timestamp: string;
  artifactHash?: string;
}

export interface SecurityException {
  id: string;
  findingId: string;
  reason: string;
  riskAcceptedBy: string;
  expiresAt: string;
  environment: string;
  remediationDueAt: string;
  correlationId: string;
  createdAt: string;
  status: "active" | "expired" | "revoked";
}

export interface BuildProvenance {
  buildId: string;
  repository: string;
  commitSha: string;
  branch: string;
  lockfileHash: string;
  artifactHash: string;
  checksPassed: readonly SecurityCheckType[];
  environment: string;
  builtAt: string;
}

export interface PackageAdmissionRequest {
  packageName: string;
  requestedVersion: string;
  requestedBy: string;
  reason: string;
  intendedUse: string;
  alternativesConsidered?: string;
}

export interface PackageAdmissionDecision {
  allowed: boolean;
  packageName: string;
  requestedVersion: string;
  reason: string;
  decidedAt: string;
}
