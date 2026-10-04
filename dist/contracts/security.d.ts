import type { Entity } from "./persistence.js";
export declare const SECURITY_SEVERITY_LEVELS: readonly ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
export type SecuritySeverity = typeof SECURITY_SEVERITY_LEVELS[number];
export interface ZTNSecurityEvent extends Entity {
    eventId: string;
    eventType: "AUTH_FAILURE" | "POLICY_VIOLATION" | "DATA_EXFILTRATION_ATTEMPT" | "PROMPT_INJECTION" | "ANOMALOUS_ACCESS";
    severity: SecuritySeverity;
    sourceIp?: string;
    principalRef?: string;
    targetResourceRef?: string;
    description: string;
    status: "OPEN" | "INVESTIGATING" | "RESOLVED" | "FALSE_POSITIVE";
    createdAt: string;
    resolvedAt?: string;
}
export interface ZeroTrustPolicy extends Entity {
    policyId: string;
    name: string;
    description: string;
    targetScope: string;
    requiredConditions: readonly string[];
    action: "ALLOW" | "DENY" | "REQUIRE_MFA" | "REQUIRE_APPROVAL";
    status: "ACTIVE" | "DRAFT" | "DISABLED";
    createdAt: string;
}
export interface ThreatIntelligenceReport extends Entity {
    reportId: string;
    source: string;
    title: string;
    description: string;
    indicators: readonly string[];
    severity: SecuritySeverity;
    status: "ACTIVE" | "MITIGATED" | "EXPIRED";
    createdAt: string;
}
