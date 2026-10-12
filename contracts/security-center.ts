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
] as const;
export type SecurityPostureStatus = (typeof SECURITY_POSTURE_STATUSES)[number];

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
] as const;
export type SecurityDomain = (typeof SECURITY_DOMAINS)[number];

export const SECURITY_ALERT_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type SecurityAlertSeverity = (typeof SECURITY_ALERT_SEVERITIES)[number];

export const SECURITY_ALERT_STATUSES = [
  "open",
  "acknowledged",
  "investigating",
  "resolved",
  "dismissed",
] as const;
export type SecurityAlertStatus = (typeof SECURITY_ALERT_STATUSES)[number];

export const SECURITY_INCIDENT_STATUSES = [
  "open",
  "triaged",
  "investigating",
  "contained",
  "recovering",
  "resolved",
  "closed",
] as const;
export type SecurityIncidentStatus = (typeof SECURITY_INCIDENT_STATUSES)[number];

export const SECURITY_INCIDENT_SEVERITIES = ["critical", "high", "medium", "low"] as const;
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
export interface SecurityCenterAlert {
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
  type:
    | "event_detected"
    | "alert_created"
    | "incident_created"
    | "acknowledged"
    | "assigned"
    | "status_changed"
    | "note_added"
    | "containment_started"
    | "recovery_linked"
    | "resolved"
    | "reopened"
    | "closed";
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
  investigationNotes: readonly { note: string; author: string; timestamp: string }[];
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

/* ------------------------------------------------------------------ */
/* Pure Validators                                                    */
/* ------------------------------------------------------------------ */

export function validateSecurityAlert(alert: SecurityCenterAlert): void {
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

export function validateSecurityIncident(incident: SecurityIncident): void {
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
