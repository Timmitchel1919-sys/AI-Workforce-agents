export interface SecurityEvent {
    eventId: string;
    organizationId: string;
    source: "API" | "AUTH" | "WEBHOOK" | "PLATFORM";
    type: "FAILED_LOGIN" | "API_ABUSE" | "DATA_EXFILTRATION_ATTEMPT" | "SUSPICIOUS_IP";
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    actor: string;
    details: Record<string, unknown>;
    timestamp: Date;
}
export interface ThreatRule {
    ruleId: string;
    organizationId: string;
    name: string;
    condition: "RATE_LIMIT_EXCEEDED" | "GEO_FENCE_VIOLATION" | "DLP_VIOLATION_SPIKE";
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
    relatedEvents: string[];
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
