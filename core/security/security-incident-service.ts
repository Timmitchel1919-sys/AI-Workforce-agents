/**
 * AI Workforce — Security Incident Management Service (Steps 9, 10, 11, 12, 29, 30)
 *
 * Governs the complete lifecycle of Security Incidents:
 * - Deterministic creation from critical alerts or operator escalation
 * - Immutable timeline auditing (containment, investigation notes, resolution)
 * - Safe resolution with mandatory summaries
 * - Audited reopening that preserves historical resolutions
 * - Linkage to recovery requests & disaster recovery workflows
 * - Publishing to the Notification Engine seam
 */
import crypto from "node:crypto";
import type {
  SecurityAlert,
  SecurityDomain,
  SecurityIncident,
  SecurityIncidentSeverity,
  SecurityIncidentStatus,
  SecurityIncidentTimelineEntry,
} from "../../contracts/security-center.js";
import { validateSecurityIncident } from "../../contracts/security-center.js";
import {
  type SecurityAlertPublisher,
  determineNotificationChannels,
} from "./alert-publisher.js";

export interface CreateIncidentInput {
  title: string;
  description: string;
  severity: SecurityIncidentSeverity;
  domain: SecurityDomain;
  projectId?: string;
  environment?: string;
  alertIds?: readonly string[];
  sourceEventIds?: readonly string[];
  affectedResources?: readonly string[];
  affectedActors?: readonly string[];
  owner?: string;
  correlationIds?: readonly string[];
  initialNote?: string;
}

export interface SecurityIncidentServiceOptions {
  publisher?: SecurityAlertPublisher;
  auditLog?: { log(event: string, meta?: Record<string, unknown>): void };
}

export class SecurityIncidentService {
  private readonly incidents = new Map<string, SecurityIncident>();
  private readonly publisher?: SecurityAlertPublisher;
  private readonly auditLog?: { log(event: string, meta?: Record<string, unknown>): void };

  constructor(options: SecurityIncidentServiceOptions = {}) {
    this.publisher = options.publisher;
    this.auditLog = options.auditLog;
  }

  /**
   * Creates a formal Security Incident.
   */
  async createIncident(input: CreateIncidentInput, createdBy: string = "system"): Promise<SecurityIncident> {
    const id = `inc-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const timeline: SecurityIncidentTimelineEntry[] = [
      {
        id: `tl-${crypto.randomUUID()}`,
        timestamp: now,
        type: "incident_created",
        actor: createdBy,
        summary: `Incident created: ${input.title}`,
      },
    ];

    const notes = input.initialNote
      ? [{ note: input.initialNote, author: createdBy, timestamp: now }]
      : [];

    const incident: SecurityIncident = {
      id,
      title: input.title,
      description: input.description,
      severity: input.severity,
      status: "open",
      projectId: input.projectId,
      environment: input.environment,
      domain: input.domain,
      alertIds: input.alertIds ?? [],
      sourceEventIds: input.sourceEventIds ?? [],
      affectedResources: input.affectedResources ?? [],
      affectedActors: input.affectedActors ?? [],
      owner: input.owner,
      createdAt: now,
      updatedAt: now,
      correlationIds: input.correlationIds ?? [],
      investigationNotes: notes,
      timeline,
    };

    validateSecurityIncident(incident);
    this.incidents.set(id, incident);

    this.auditLog?.log("security_incident_created", { incidentId: id, severity: incident.severity });

    await this.publisher?.publish({
      id: `notif-${crypto.randomUUID()}`,
      type: "IncidentCreated",
      severity: incident.severity,
      title: `[${incident.severity.toUpperCase()}] Incident Created: ${incident.title}`,
      summary: incident.description,
      channels: determineNotificationChannels(incident.severity),
      createdAt: now,
    });

    return { ...incident };
  }

  /**
   * Deterministically creates an incident from an elevated alert (Step 11).
   */
  async createIncidentFromAlert(alert: SecurityAlert): Promise<SecurityIncident> {
    const severity: SecurityIncidentSeverity = alert.severity === "info" ? "low" : alert.severity;

    return this.createIncident(
      {
        title: `Auto-Incident: ${alert.title}`,
        description: alert.description,
        severity,
        domain: alert.domain,
        projectId: alert.projectId,
        environment: alert.environment,
        alertIds: [alert.id],
        sourceEventIds: alert.sourceEventIds,
        affectedResources: alert.target ? [alert.target] : [],
        initialNote: `Automatically created from alert '${alert.id}' due to severity '${alert.severity}'`,
        correlationIds: alert.correlationId ? [alert.correlationId] : [],
      },
      "AlertEngine",
    );
  }

  /**
   * Retrieves an incident by ID.
   */
  getIncident(id: string): SecurityIncident | undefined {
    const inc = this.incidents.get(id);
    return inc ? { ...inc } : undefined;
  }

  /**
   * Lists incidents with optional filters.
   */
  listIncidents(filters: {
    status?: SecurityIncidentStatus;
    severity?: SecurityIncidentSeverity;
    domain?: SecurityDomain;
    projectId?: string;
  } = {}): SecurityIncident[] {
    let result = Array.from(this.incidents.values());

    if (filters.status) {
      result = result.filter((i) => i.status === filters.status);
    }
    if (filters.severity) {
      result = result.filter((i) => i.severity === filters.severity);
    }
    if (filters.domain) {
      result = result.filter((i) => i.domain === filters.domain);
    }
    if (filters.projectId) {
      result = result.filter((i) => i.projectId === filters.projectId);
    }

    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return result.map((i) => ({ ...i }));
  }

  /**
   * Associates an additional alert with an incident.
   */
  async attachAlert(incidentId: string, alertId: string, actor: string = "system"): Promise<SecurityIncident> {
    const incident = this.incidents.get(incidentId);
    if (!incident) throw new Error(`Incident '${incidentId}' not found`);

    if (!incident.alertIds.includes(alertId)) {
      const updatedAlertIds = [...incident.alertIds, alertId];
      const now = new Date().toISOString();

      const timelineEntry: SecurityIncidentTimelineEntry = {
        id: `tl-${crypto.randomUUID()}`,
        timestamp: now,
        type: "alert_created",
        actor,
        summary: `Attached alert '${alertId}' to incident`,
      };

      incident.alertIds = updatedAlertIds;
      incident.updatedAt = now;
      incident.timeline = [...incident.timeline, timelineEntry];
      this.incidents.set(incidentId, incident);
    }

    return { ...incident };
  }

  /**
   * Assigns an owner to an incident.
   */
  async assignOwner(incidentId: string, owner: string, assignedBy: string): Promise<SecurityIncident> {
    const incident = this.incidents.get(incidentId);
    if (!incident) throw new Error(`Incident '${incidentId}' not found`);

    const now = new Date().toISOString();
    incident.owner = owner;
    incident.updatedAt = now;
    incident.timeline = [
      ...incident.timeline,
      {
        id: `tl-${crypto.randomUUID()}`,
        timestamp: now,
        type: "assigned",
        actor: assignedBy,
        summary: `Assigned owner to '${owner}'`,
      },
    ];

    if (incident.status === "open") {
      incident.status = "triaged";
    }

    this.incidents.set(incidentId, incident);
    this.auditLog?.log("security_incident_assigned", { incidentId, owner, assignedBy });
    return { ...incident };
  }

  /**
   * Updates incident status and logs progress in the timeline.
   */
  async updateStatus(
    incidentId: string,
    newStatus: SecurityIncidentStatus,
    actor: string,
    note?: string,
  ): Promise<SecurityIncident> {
    const incident = this.incidents.get(incidentId);
    if (!incident) throw new Error(`Incident '${incidentId}' not found`);

    const now = new Date().toISOString();
    incident.status = newStatus;
    incident.updatedAt = now;

    if (newStatus === "contained" && !incident.containmentStartedAt) {
      incident.containmentStartedAt = now;
    }

    const timelineEntry: SecurityIncidentTimelineEntry = {
      id: `tl-${crypto.randomUUID()}`,
      timestamp: now,
      type: "status_changed",
      actor,
      summary: `Status updated to '${newStatus}'${note ? `: ${note}` : ""}`,
    };

    incident.timeline = [...incident.timeline, timelineEntry];

    if (note) {
      incident.investigationNotes = [
        ...incident.investigationNotes,
        { note, author: actor, timestamp: now },
      ];
    }

    this.incidents.set(incidentId, incident);
    this.auditLog?.log("security_incident_status_changed", { incidentId, newStatus, actor });
    return { ...incident };
  }

  /**
   * Adds an investigation note to an incident.
   */
  async addNote(incidentId: string, author: string, note: string): Promise<SecurityIncident> {
    const incident = this.incidents.get(incidentId);
    if (!incident) throw new Error(`Incident '${incidentId}' not found`);

    const now = new Date().toISOString();
    incident.updatedAt = now;
    incident.investigationNotes = [
      ...incident.investigationNotes,
      { note, author, timestamp: now },
    ];
    incident.timeline = [
      ...incident.timeline,
      {
        id: `tl-${crypto.randomUUID()}`,
        timestamp: now,
        type: "note_added",
        actor: author,
        summary: `Note added by ${author}: ${note.slice(0, 80)}`,
      },
    ];

    this.incidents.set(incidentId, incident);
    return { ...incident };
  }

  /**
   * Links a recovery request to an incident (Step 23 of Step 9).
   */
  async linkRecoveryRequest(incidentId: string, recoveryRequestId: string, actor: string): Promise<SecurityIncident> {
    const incident = this.incidents.get(incidentId);
    if (!incident) throw new Error(`Incident '${incidentId}' not found`);

    const now = new Date().toISOString();
    incident.recoveryRequestId = recoveryRequestId;
    incident.updatedAt = now;
    incident.timeline = [
      ...incident.timeline,
      {
        id: `tl-${crypto.randomUUID()}`,
        timestamp: now,
        type: "recovery_linked",
        actor,
        summary: `Linked recovery request '${recoveryRequestId}'`,
      },
    ];

    this.incidents.set(incidentId, incident);
    return { ...incident };
  }

  /**
   * Resolves an incident with mandatory resolution summary and resolver identity (Step 29).
   */
  async resolveIncident(
    incidentId: string,
    resolvedBy: string,
    resolutionSummary: string,
    rootCause?: string,
  ): Promise<SecurityIncident> {
    const incident = this.incidents.get(incidentId);
    if (!incident) throw new Error(`Incident '${incidentId}' not found`);

    if (!resolutionSummary || resolutionSummary.trim().length < 15) {
      throw new Error("A comprehensive resolution summary (at least 15 characters) is required to resolve an incident");
    }

    const now = new Date().toISOString();
    incident.status = "resolved";
    incident.resolvedAt = now;
    incident.resolvedBy = resolvedBy;
    incident.resolutionSummary = resolutionSummary;
    incident.rootCause = rootCause ?? incident.rootCause;
    incident.updatedAt = now;

    incident.timeline = [
      ...incident.timeline,
      {
        id: `tl-${crypto.randomUUID()}`,
        timestamp: now,
        type: "resolved",
        actor: resolvedBy,
        summary: `Incident resolved: ${resolutionSummary}`,
      },
    ];

    this.incidents.set(incidentId, incident);
    this.auditLog?.log("security_incident_resolved", { incidentId, resolvedBy });
    return { ...incident };
  }

  /**
   * Reopens an incident while strictly preserving past resolution history (Step 30).
   */
  async reopenIncident(incidentId: string, reopenedBy: string, reason: string): Promise<SecurityIncident> {
    const incident = this.incidents.get(incidentId);
    if (!incident) throw new Error(`Incident '${incidentId}' not found`);

    if (!reason || reason.trim().length < 10) {
      throw new Error("A reason (at least 10 characters) is required to reopen an incident");
    }

    const now = new Date().toISOString();
    const previousResolution = incident.resolutionSummary;

    incident.status = "investigating";
    incident.reopenedAt = now;
    incident.reopenedBy = reopenedBy;
    incident.reopenReason = reason;
    incident.updatedAt = now;

    incident.timeline = [
      ...incident.timeline,
      {
        id: `tl-${crypto.randomUUID()}`,
        timestamp: now,
        type: "reopened",
        actor: reopenedBy,
        summary: `Incident reopened: ${reason} (Previous resolution: ${previousResolution ?? "none"})`,
      },
    ];

    this.incidents.set(incidentId, incident);
    this.auditLog?.log("security_incident_reopened", { incidentId, reopenedBy, reason });
    return { ...incident };
  }
}
