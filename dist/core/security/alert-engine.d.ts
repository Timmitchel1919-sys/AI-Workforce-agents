import type { SecurityAlert, SecurityAlertSeverity, SecurityAlertStatus, SecurityDomain } from "../../contracts/security-center.js";
import type { ZTNSecurityEvent } from "../../contracts/security.js";
import { type SecurityAlertPublisher } from "./alert-publisher.js";
import type { SecurityIncidentService } from "./security-incident-service.js";
export interface AlertEngineOptions {
    incidentService?: SecurityIncidentService;
    publisher?: SecurityAlertPublisher;
    dedupWindowMs?: number;
    auditLog?: {
        log(event: string, meta?: Record<string, unknown>): void;
    };
}
export declare class AlertEngine {
    private readonly alerts;
    private readonly incidentService?;
    private readonly publisher?;
    private readonly dedupWindowMs;
    private readonly auditLog?;
    constructor(options?: AlertEngineOptions);
    /**
     * Consumes a ZTNSecurityEvent, evaluates alert criteria, deduplicates repeated events,
     * redacts secrets, and triggers incident creation when required.
     */
    ingestEvent(event: ZTNSecurityEvent): Promise<SecurityAlert | undefined>;
    /**
     * Retrieves an alert by ID.
     */
    getAlert(id: string): SecurityAlert | undefined;
    /**
     * Lists alerts with optional filters.
     */
    listAlerts(filters?: {
        status?: SecurityAlertStatus;
        severity?: SecurityAlertSeverity;
        domain?: SecurityDomain;
        projectId?: string;
    }): SecurityAlert[];
    /**
     * Acknowledges an active alert.
     */
    acknowledgeAlert(id: string, actor: string): Promise<SecurityAlert>;
    /**
     * Dismisses an alert with an audited rationale.
     * Does NOT delete the underlying security events!
     */
    dismissAlert(id: string, actor: string, reason: string): Promise<SecurityAlert>;
    /**
     * Marks an alert as resolved.
     */
    resolveAlert(id: string, actor: string): Promise<SecurityAlert>;
    private classifyEvent;
    private buildDedupKey;
    private findDeduplicatedAlert;
    private sanitizeText;
}
