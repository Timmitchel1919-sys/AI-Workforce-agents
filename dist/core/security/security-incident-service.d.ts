import type { SecurityCenterAlert, SecurityDomain, SecurityIncident, SecurityIncidentSeverity, SecurityIncidentStatus } from "../../contracts/security-center.js";
import { type SecurityAlertPublisher } from "./alert-publisher.js";
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
    auditLog?: {
        log(event: string, meta?: Record<string, unknown>): void;
    };
}
export declare class SecurityIncidentService {
    private readonly incidents;
    private readonly publisher?;
    private readonly auditLog?;
    constructor(options?: SecurityIncidentServiceOptions);
    /**
     * Creates a formal Security Incident.
     */
    createIncident(input: CreateIncidentInput, createdBy?: string): Promise<SecurityIncident>;
    /**
     * Deterministically creates an incident from an elevated alert (Step 11).
     */
    createIncidentFromAlert(alert: SecurityCenterAlert): Promise<SecurityIncident>;
    /**
     * Retrieves an incident by ID.
     */
    getIncident(id: string): SecurityIncident | undefined;
    /**
     * Lists incidents with optional filters.
     */
    listIncidents(filters?: {
        status?: SecurityIncidentStatus;
        severity?: SecurityIncidentSeverity;
        domain?: SecurityDomain;
        projectId?: string;
    }): SecurityIncident[];
    /**
     * Associates an additional alert with an incident.
     */
    attachAlert(incidentId: string, alertId: string, actor?: string): Promise<SecurityIncident>;
    /**
     * Assigns an owner to an incident.
     */
    assignOwner(incidentId: string, owner: string, assignedBy: string): Promise<SecurityIncident>;
    /**
     * Updates incident status and logs progress in the timeline.
     */
    updateStatus(incidentId: string, newStatus: SecurityIncidentStatus, actor: string, note?: string): Promise<SecurityIncident>;
    /**
     * Adds an investigation note to an incident.
     */
    addNote(incidentId: string, author: string, note: string): Promise<SecurityIncident>;
    /**
     * Links a recovery request to an incident (Step 23 of Step 9).
     */
    linkRecoveryRequest(incidentId: string, recoveryRequestId: string, actor: string): Promise<SecurityIncident>;
    /**
     * Resolves an incident with mandatory resolution summary and resolver identity (Step 29).
     */
    resolveIncident(incidentId: string, resolvedBy: string, resolutionSummary: string, rootCause?: string): Promise<SecurityIncident>;
    /**
     * Reopens an incident while strictly preserving past resolution history (Step 30).
     */
    reopenIncident(incidentId: string, reopenedBy: string, reason: string): Promise<SecurityIncident>;
}
