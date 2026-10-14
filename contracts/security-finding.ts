import type { Entity } from "./persistence.js";

export const SECURITY_FINDING_SEVERITIES = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type SecurityFindingSeverity =
  (typeof SECURITY_FINDING_SEVERITIES)[number];

export const SECURITY_FINDING_STATUSES = [
  "open",
  "triaged",
  "accepted_temporarily",
  "remediated",
  "false_positive",
] as const;
export type SecurityFindingStatus = (typeof SECURITY_FINDING_STATUSES)[number];

export const SECURITY_FINDING_CATEGORIES = [
  "sast",
  "secret_leak",
  "dependency_vulnerability",
  "supply_chain",
  "license",
] as const;
export type SecurityFindingCategory =
  (typeof SECURITY_FINDING_CATEGORIES)[number];

export const SECURITY_FINDING_SOURCES = [
  "codeql",
  "gitleaks",
  "npm_audit",
  "dependabot",
  "sbom_analyzer",
  "manual",
] as const;
export type SecurityFindingSource = (typeof SECURITY_FINDING_SOURCES)[number];

export interface SecurityFinding extends Entity {
  id: string;
  source: SecurityFindingSource;
  category: SecurityFindingCategory;
  severity: SecurityFindingSeverity;
  title: string;
  description: string;
  file?: string;
  line?: number;
  package?: string;
  advisory?: string;
  detectedAt: string;
  status: SecurityFindingStatus;
  remediation?: string;
  projectId?: string;
  metadata?: Readonly<Record<string, unknown>>;
}
