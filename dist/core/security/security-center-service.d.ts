/**
 * AI Workforce — Security Center Backend Service (Steps 3, 4, 13, 15, 16, 24, 31)
 *
 * Provides a centralized Windows Security-like Security Operations engine:
 * - Deterministic posture evaluation and scoring across all 13 security domains
 * - Telemetry health detection (fail-degraded posture on telemetry loss)
 * - Project-scoped and global capability access controls
 * - Aggregated alerts, incidents, and deterministic recommendations
 */
import type { OperatorPrincipal } from "../../contracts/control.js";
import type { SecurityCenterAlert, SecurityDomain, SecurityIncident, SecurityPostureSummary, SecurityRecommendation } from "../../contracts/security-center.js";
import type { BackupCatalogService } from "../recovery/backup-catalog.js";
import type { AlertEngine } from "./alert-engine.js";
import type { SecurityIncidentService } from "./security-incident-service.js";
export interface SecurityCenterServiceOptions {
    alertEngine: AlertEngine;
    incidentService: SecurityIncidentService;
    backupCatalog?: BackupCatalogService;
    telemetryHealthy?: boolean;
}
export declare class SecurityCenterService {
    private readonly alertEngine;
    private readonly incidentService;
    private readonly backupCatalog?;
    private isTelemetryHealthy;
    constructor(options: SecurityCenterServiceOptions);
    setTelemetryHealthy(healthy: boolean): void;
    /**
     * Generates the comprehensive Security Posture Summary (Steps 3, 4, 31).
     */
    getSummary(principal?: OperatorPrincipal, projectId?: string): Promise<SecurityPostureSummary>;
    /**
     * Lists alerts enforcing capability and project isolation (Step 15, 16).
     */
    listAlerts(filters?: {
        severity?: SecurityCenterAlert["severity"];
        status?: SecurityCenterAlert["status"];
        domain?: SecurityDomain;
    }, principal?: OperatorPrincipal, projectId?: string): SecurityCenterAlert[];
    getAlert(id: string, principal?: OperatorPrincipal): SecurityCenterAlert | undefined;
    /**
     * Lists incidents with capability and project boundary enforcement.
     */
    listIncidents(filters?: {
        severity?: SecurityIncident["severity"];
        status?: SecurityIncident["status"];
        domain?: SecurityDomain;
    }, principal?: OperatorPrincipal, projectId?: string): SecurityIncident[];
    getIncident(id: string, principal?: OperatorPrincipal): SecurityIncident | undefined;
    private isGlobalViewer;
    private canAccessProject;
    acknowledgeAlert(id: string, actor: string): Promise<SecurityCenterAlert>;
    dismissAlert(id: string, actor: string, reason: string): Promise<SecurityCenterAlert>;
    resolveAlert(id: string, actor: string): Promise<SecurityCenterAlert>;
    assignIncident(id: string, owner: string, assignedBy: string): Promise<SecurityIncident>;
    updateIncidentStatus(id: string, status: SecurityIncident["status"], actor: string, note?: string): Promise<SecurityIncident>;
    resolveIncident(id: string, resolvedBy: string, summary: string, rootCause?: string): Promise<SecurityIncident>;
    reopenIncident(id: string, reopenedBy: string, reason: string): Promise<SecurityIncident>;
    addIncidentNote(id: string, author: string, note: string): Promise<SecurityIncident>;
    /**
     * Deterministic Recommendations Engine (Step 24).
     */
    getRecommendations(): Promise<SecurityRecommendation[]>;
    private evaluateDomains;
}
