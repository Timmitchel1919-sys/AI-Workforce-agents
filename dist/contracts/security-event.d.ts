import type { Entity } from "./persistence.js";
export declare const SECURITY_EVENT_CATEGORIES: readonly ["authentication", "authorization", "policy", "data_protection", "agent_security", "system"];
export type SecurityEventCategory = (typeof SECURITY_EVENT_CATEGORIES)[number];
export declare const SECURITY_EVENT_SEVERITIES: readonly ["info", "low", "medium", "high", "critical"];
export type SecurityEventSeverity = (typeof SECURITY_EVENT_SEVERITIES)[number];
export declare const SECURITY_EVENT_OUTCOMES: readonly ["allowed", "denied", "blocked", "failed", "observed"];
export type SecurityEventOutcome = (typeof SECURITY_EVENT_OUTCOMES)[number];
export interface CanonicalSecurityEvent extends Entity {
    eventId: string;
    schemaVersion: 1;
    occurredAt: string;
    category: SecurityEventCategory;
    type: string;
    severity: SecurityEventSeverity;
    outcome: SecurityEventOutcome;
    actor: {
        kind: string;
        id?: string;
    };
    source: {
        kind: string;
        id?: string;
        ip?: string;
    };
    target?: {
        kind: string;
        id?: string;
        projectId?: string;
    };
    projectId?: string;
    correlationId?: string;
    approvalId?: string;
    policyId?: string;
    evidence?: Readonly<Record<string, unknown>>;
    previousEventHash?: string;
    eventHash?: string;
}
export interface SecurityEventQuery {
    projectId?: string;
    category?: SecurityEventCategory;
    severity?: SecurityEventSeverity;
    outcome?: SecurityEventOutcome;
    after?: string;
    before?: string;
    limit?: number;
}
export declare function validateSecurityEvent(event: CanonicalSecurityEvent): void;
