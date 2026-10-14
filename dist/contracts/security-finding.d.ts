import type { Entity } from "./persistence.js";
export declare const SECURITY_FINDING_SEVERITIES: readonly ["info", "low", "medium", "high", "critical"];
export type SecurityFindingSeverity = (typeof SECURITY_FINDING_SEVERITIES)[number];
export declare const SECURITY_FINDING_STATUSES: readonly ["open", "triaged", "accepted_temporarily", "remediated", "false_positive"];
export type SecurityFindingStatus = (typeof SECURITY_FINDING_STATUSES)[number];
export declare const SECURITY_FINDING_CATEGORIES: readonly ["sast", "secret_leak", "dependency_vulnerability", "supply_chain", "license"];
export type SecurityFindingCategory = (typeof SECURITY_FINDING_CATEGORIES)[number];
export declare const SECURITY_FINDING_SOURCES: readonly ["codeql", "gitleaks", "npm_audit", "dependabot", "sbom_analyzer", "manual"];
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
