/**
 * Enterprise Compliance, Risk, Privacy & Trust Management
 * Compliance Controls, Policies, Evidence, Frameworks
 */
export declare const CONTROL_CATEGORIES: readonly ["Identity & Access", "Authentication", "Authorization", "Secrets", "Cryptography", "Logging", "Monitoring", "Incident Response", "Change Management", "Software Development", "Vulnerability Management", "Data Protection", "Privacy", "Retention", "Backup & Recovery", "Business Continuity", "Vendor Management", "AI Governance", "Governance", "Risk Management"];
export type ControlCategory = (typeof CONTROL_CATEGORIES)[number];
export declare const CONTROL_TYPES: readonly ["PREVENTIVE", "DETECTIVE", "CORRECTIVE"];
export type ControlType = (typeof CONTROL_TYPES)[number];
export declare const CONTROL_IMPACT_CLASSES: readonly ["TECHNICAL", "ADMINISTRATIVE", "PHYSICAL"];
export type ControlImpactClass = (typeof CONTROL_IMPACT_CLASSES)[number];
export declare const AUTOMATION_LEVELS: readonly ["MANUAL", "SEMI_AUTOMATED", "AUTOMATED"];
export type AutomationLevel = (typeof AUTOMATION_LEVELS)[number];
export declare const CONTROL_STATUSES: readonly ["NOT_ASSESSED", "PLANNED", "IMPLEMENTED", "PARTIALLY_IMPLEMENTED", "INEFFECTIVE", "EFFECTIVE", "NOT_APPLICABLE", "UNKNOWN"];
export type ControlStatus = (typeof CONTROL_STATUSES)[number];
export declare const CONTROL_TEST_METHODS: readonly ["MANUAL", "AUTOMATED", "HYBRID"];
export type ControlTestMethod = (typeof CONTROL_TEST_METHODS)[number];
export declare const CONTROL_TEST_RESULTS: readonly ["PASS", "FAIL", "PARTIAL", "NOT_TESTED", "ERROR", "UNKNOWN"];
export type ControlTestResult = (typeof CONTROL_TEST_RESULTS)[number];
export interface ControlDefinition {
    controlId: string;
    controlKey: string;
    title: string;
    description: string;
    category: ControlCategory;
    controlType: ControlType;
    controlClass?: ControlImpactClass;
    objective: string;
    scope: "PLATFORM" | "ORGANIZATION" | "WORKSPACE" | "PROJECT" | "SERVICE" | "ENVIRONMENT" | "GLOBAL";
    automationLevel: AutomationLevel;
    testingMethod: ControlTestMethod;
    evidenceRequirements: readonly string[];
    frameworkMappings?: readonly FrameworkMappingRef[];
    ownerRole?: string;
    version: number;
    status: "ACTIVE" | "DRAFT" | "SUPERSEDED" | "RETIRED";
    createdAt: string;
    updatedAt: string;
    updatedBy: string;
}
export interface ControlInstance {
    instanceId: string;
    controlId: string;
    organizationId: string;
    scopeId?: string;
    scopeType: "PLATFORM" | "ORGANIZATION" | "WORKSPACE" | "PROJECT" | "SERVICE" | "ENVIRONMENT";
    implementationOwner: string;
    evidenceOwner?: string;
    controlOwner: string;
    status: ControlStatus;
    effectiveness: "UNKNOWN" | "EFFECTIVE" | "INEFFECTIVE" | "NOT_DETERMINED";
    lastTestedAt?: string;
    nextTestDueAt?: string;
    lastEvidenceUpdatedAt?: string;
    evidenceFreshness: "CURRENT" | "AGING" | "STALE" | "EXPIRED" | "UNKNOWN";
    notes?: string;
    metadata?: Record<string, unknown>;
}
export interface ControlTestRun {
    testId: string;
    controlId: string;
    instanceId?: string;
    organizationId: string;
    method: ControlTestMethod;
    scope: string;
    result: ControlTestResult;
    performedBy: string;
    startedAt: string;
    completedAt?: string;
    evidenceRefs: readonly string[];
    limitations?: string;
    findings?: readonly string[];
    metadata?: Record<string, unknown>;
}
export declare const EVIDENCE_TYPES: readonly ["SYSTEM_RECORD", "TEST_RESULT", "CONFIGURATION", "AUDIT_EVENT", "POLICY", "SCREENSHOT", "DOCUMENT", "REPORT", "ATTESTATION", "EXTERNAL_REPORT"];
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export declare const EVIDENCE_FRESHNESS_STATES: readonly ["CURRENT", "AGING", "STALE", "EXPIRED", "UNKNOWN"];
export type EvidenceFreshness = (typeof EVIDENCE_FRESHNESS_STATES)[number];
export interface ComplianceEvidence {
    evidenceId: string;
    title: string;
    type: EvidenceType;
    source: string;
    sourceRef: string;
    controlRefs: readonly string[];
    instanceRefs?: readonly string[];
    organizationId: string;
    scopeId?: string;
    scopeType?: string;
    capturedAt: string;
    validFrom?: string;
    validUntil?: string;
    contentHash?: string;
    sourceRevision?: string;
    classification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
    owner: string;
    freshness: EvidenceFreshness;
    metadata?: Record<string, unknown>;
}
export interface FrameworkMappingRef {
    frameworkId: string;
    frameworkVersion: string;
    requirementId: string;
    requirementTitle?: string;
}
export interface ComplianceFramework {
    frameworkId: string;
    name: string;
    version: string;
    description: string;
    status: "ACTIVE" | "DRAFT" | "SUPERSEDED";
    owner: string;
    mappings: readonly FrameworkMappingRef[];
    updatedAt: string;
}
