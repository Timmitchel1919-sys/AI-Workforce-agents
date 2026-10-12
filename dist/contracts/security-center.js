/**
 * AI Workforce — Security Center, Alert Engine & Incident Management Contracts
 *
 * Defines models, types, and pure validators for:
 * - Security domains, posture statuses, and deterministic scoring
 * - Security alerts, deduplication models, and lifecycle statuses
 * - Security incidents, investigation workflows, timelines, and resolutions
 * - Deterministic recommendations and notification publisher seams
 */
import { ValidationError, requireText } from "./index.js";
export const SECURITY_POSTURE_STATUSES = [
    "secure",
    "attention",
    "degraded",
    "critical",
    "unknown",
];
export const SECURITY_DOMAINS = [
    "identity_access",
    "application_api",
    "agent_security",
    "secrets",
    "data_integrity",
    "destructive_actions",
    "software_supply_chain",
    "backup_recovery",
    "policy_governance",
    "integration_security",
    "cloud_edge",
    "email_phishing",
    "endpoint_security",
];
export const SECURITY_ALERT_SEVERITIES = ["critical", "high", "medium", "low", "info"];
export const SECURITY_ALERT_STATUSES = [
    "open",
    "acknowledged",
    "investigating",
    "resolved",
    "dismissed",
];
export const SECURITY_INCIDENT_STATUSES = [
    "open",
    "triaged",
    "investigating",
    "contained",
    "recovering",
    "resolved",
    "closed",
];
export const SECURITY_INCIDENT_SEVERITIES = ["critical", "high", "medium", "low"];
/* ------------------------------------------------------------------ */
/* Pure Validators                                                    */
/* ------------------------------------------------------------------ */
export function validateSecurityAlert(alert) {
    requireText(alert.id, "alert.id");
    requireText(alert.title, "alert.title");
    if (!SECURITY_ALERT_SEVERITIES.includes(alert.severity)) {
        throw new ValidationError(`Invalid alert severity: ${alert.severity}`);
    }
    if (!SECURITY_DOMAINS.includes(alert.domain)) {
        throw new ValidationError(`Invalid alert domain: ${alert.domain}`);
    }
    if (!SECURITY_ALERT_STATUSES.includes(alert.status)) {
        throw new ValidationError(`Invalid alert status: ${alert.status}`);
    }
    requireText(alert.detectedAt, "alert.detectedAt");
    requireText(alert.lastObservedAt, "alert.lastObservedAt");
    if (alert.eventCount <= 0) {
        throw new ValidationError("eventCount must be greater than 0");
    }
}
export function validateSecurityIncident(incident) {
    requireText(incident.id, "incident.id");
    requireText(incident.title, "incident.title");
    if (!SECURITY_INCIDENT_SEVERITIES.includes(incident.severity)) {
        throw new ValidationError(`Invalid incident severity: ${incident.severity}`);
    }
    if (!SECURITY_INCIDENT_STATUSES.includes(incident.status)) {
        throw new ValidationError(`Invalid incident status: ${incident.status}`);
    }
    if (!SECURITY_DOMAINS.includes(incident.domain)) {
        throw new ValidationError(`Invalid incident domain: ${incident.domain}`);
    }
    requireText(incident.createdAt, "incident.createdAt");
    requireText(incident.updatedAt, "incident.updatedAt");
}
