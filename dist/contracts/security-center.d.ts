export declare const SECURITY_POSTURE_STATUSES: readonly ["secure", "attention", "degraded", "critical", "unknown"];
export type SecurityPostureStatus = (typeof SECURITY_POSTURE_STATUSES)[number];
export declare const SECURITY_DOMAINS: readonly ["identity_access", "application_api", "agent_security", "secrets", "data_integrity", "destructive_actions", "software_supply_chain", "backup_recovery", "policy_governance", "integration_security", "cloud_edge", "email_phishing", "endpoint_security"];
export type SecurityDomain = (typeof SECURITY_DOMAINS)[number];
export declare const SECURITY_ALERT_SEVERITIES: readonly ["critical", "high", "medium", "low", "info"];
export type SecurityAlertSeverity = (typeof SECURITY_ALERT_SEVERITIES)[number];
export declare const SECURITY_ALERT_STATUSES: readonly ["open", "acknowledged", "investigating", "resolved", "dismissed"];
export type SecurityAlertStatus = (typeof SECURITY_ALERT_STATUSES)[number];
export declare const SECURITY_INCIDENT_STATUSES: readonly ["open", "triaged", "investigating", "contained", "recovering", "resolved", "closed"];
export type SecurityIncidentStatus = (typeof SECURITY_INCIDENT_STATUSES)[number];
export declare const SECURITY_INCIDENT_SEVERITIES: readonly ["critical", "high", "medium", "low"];
export type SecurityIncidentSeverity = (typeof SECURITY_INCIDENT_SEVERITIES)[number];
/**
 * Normalized Posture for an individual Security Domain.
 */
export interface SecurityDomainPosture {
    domain: SecurityDomain;
    status: SecurityPostureStatus;
    score?: number;
    openCritical: number;
    openHigh: number;
    openMedium: number;
    openLow: number;
    lastEvaluatedAt: string;
    summary: string;
    recommendations: readonly string[];
    configured: boolean;
}
/**
 * Normalized High-level Security Posture Summary for the Security Center.
 */
export interface SecurityPostureSummary {
    generatedAt: string;
    overallStatus: SecurityPostureStatus;
    overallScore?: number;
    domains: readonly SecurityDomainPosture[];
    criticalAlerts: number;
    highAlerts: number;
    mediumAlerts: number;
    lowAlerts: number;
    openIncidents: number;
    unresolvedFindings: number;
    telemetryDegraded?: boolean;
    activeBanner?: {
        title: string;
        severity: "critical" | "high" | "attention";
        message: string;
        count: number;
    };
}
/**
 * Normalized Security Alert representing an actionable condition derived from SecurityEvents.
 */
export interface SecurityAlert {
    id: string;
    title: string;
    description: string;
    severity: SecurityAlertSeverity;
    domain: SecurityDomain;
    status: SecurityAlertStatus;
    sourceEventIds: readonly string[];
    eventCount: number;
    projectId?: string;
    environment?: string;
    target?: string;
    detectedAt: string;
    lastObservedAt: string;
    correlationId?: string;
    recommendedAction?: string;
    incidentId?: string;
    acknowledgedBy?: string;
    acknowledgedAt?: string;
    resolvedBy?: string;
    resolvedAt?: string;
    dismissedBy?: string;
    dismissedAt?: string;
    dismissReason?: string;
    evidenceSummary?: string;
    metadata?: Record<string, unknown>;
}
/**
 * Audit trail entry for an incident timeline.
 */
export interface SecurityIncidentTimelineEntry {
    id: string;
    timestamp: string;
    type: "event_detected" | "alert_created" | "incident_created" | "acknowledged" | "assigned" | "status_changed" | "note_added" | "containment_started" | "recovery_linked" | "resolved" | "reopened" | "closed";
    actor: string;
    summary: string;
    metadata?: Record<string, unknown>;
}
/**
 * Authoritative record of an active or historical Security Incident.
 */
export interface SecurityIncident {
    id: string;
    title: string;
    description: string;
    severity: SecurityIncidentSeverity;
    status: SecurityIncidentStatus;
    projectId?: string;
    environment?: string;
    domain: SecurityDomain;
    alertIds: readonly string[];
    sourceEventIds: readonly string[];
    affectedResources: readonly string[];
    affectedActors: readonly string[];
    owner?: string;
    createdAt: string;
    updatedAt: string;
    acknowledgedAt?: string;
    containmentStartedAt?: string;
    resolvedAt?: string;
    resolutionSummary?: string;
    resolvedBy?: string;
    reopenedAt?: string;
    reopenedBy?: string;
    reopenReason?: string;
    rootCause?: string;
    recoveryRequestId?: string;
    correlationIds: readonly string[];
    investigationNotes: readonly {
        note: string;
        author: string;
        timestamp: string;
    }[];
    timeline: readonly SecurityIncidentTimelineEntry[];
}
/**
 * Actionable recommendation generated from deterministic security telemetry.
 */
export interface SecurityRecommendation {
    id: string;
    domain: SecurityDomain;
    title: string;
    description: string;
    severity: SecurityAlertSeverity;
    remediationAction: string;
    ruleId: string;
    status: "active" | "dismissed";
}
/**
 * Event published for outbound notification seams (in-app, email, chat, etc.).
 */
export interface NotificationEvent {
    id: string;
    type: "SecurityAlertCreated" | "SecurityAlertEscalated" | "IncidentCreated" | "IncidentEscalated";
    severity: SecurityAlertSeverity;
    title: string;
    summary: string;
    channels: readonly ("in-app" | "email" | "whatsapp" | "push")[];
    createdAt: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
}
export declare function validateSecurityAlert(alert: SecurityAlert): void;
export declare function validateSecurityIncident(incident: SecurityIncident): void;
