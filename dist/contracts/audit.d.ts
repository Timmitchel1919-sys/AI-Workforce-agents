import type { Entity } from "./persistence.js";
export interface AuditLogEntry extends Entity {
    logId: string;
    actorRef: string;
    action: string;
    resourceType: string;
    resourceRef: string;
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    status: "SUCCESS" | "FAILURE" | "DENIED";
    timestamp: string;
}
export interface ComplianceFinding extends Entity {
    findingId: string;
    frameworkRef?: string;
    controlRef: string;
    resourceRef: string;
    description: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    status: "OPEN" | "REMEDIATED" | "ACCEPTED_RISK";
    evidence: string;
    detectedAt: string;
    remediatedAt?: string;
}
