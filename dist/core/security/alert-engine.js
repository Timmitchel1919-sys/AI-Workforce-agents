/**
 * AI Workforce — Deterministic Security Alert Engine (Steps 5, 6, 7, 8, 11, 28)
 *
 * Consumes normalized ZTNSecurityEvents, applies deterministic alert generation
 * and deduplication rules, sanitizes sensitive evidence with SecretRedactor,
 * auto-escalates critical alerts into Security Incidents, and publishes events
 * to the Notification Engine seam.
 */
import crypto from "node:crypto";
import { validateSecurityAlert } from "../../contracts/security-center.js";
import { determineNotificationChannels, } from "./alert-publisher.js";
import { redactObject } from "./secret-redactor.js";
export class AlertEngine {
    alerts = new Map();
    incidentService;
    publisher;
    dedupWindowMs;
    auditLog;
    constructor(options = {}) {
        this.incidentService = options.incidentService;
        this.publisher = options.publisher;
        this.dedupWindowMs = options.dedupWindowMs ?? 60 * 60 * 1000; // 1 hour
        this.auditLog = options.auditLog;
    }
    /**
     * Consumes a ZTNSecurityEvent, evaluates alert criteria, deduplicates repeated events,
     * redacts secrets, and triggers incident creation when required.
     */
    async ingestEvent(event) {
        const classification = this.classifyEvent(event);
        if (!classification.shouldAlert) {
            return undefined;
        }
        const domain = classification.domain;
        const severity = classification.severity;
        const now = new Date().toISOString();
        // Redact description and metadata to ensure no raw secrets are stored
        const safeDescription = this.sanitizeText(classification.description);
        const safeEvidence = event.description ? this.sanitizeText(event.description) : undefined;
        // Build deduplication key
        const dedupKey = this.buildDedupKey(event, domain);
        const existing = this.findDeduplicatedAlert(dedupKey, new Date(event.createdAt || now).getTime());
        if (existing) {
            // Step 8: Safe Alert Deduplication
            existing.eventCount += 1;
            existing.sourceEventIds = [...existing.sourceEventIds, event.eventId || event.id];
            existing.lastObservedAt = now;
            // Escalate repeated events if threshold passed
            if (existing.eventCount >= 5 && existing.severity === "low") {
                existing.severity = "medium";
            }
            else if (existing.eventCount >= 10 && existing.severity === "medium") {
                existing.severity = "high";
            }
            this.alerts.set(existing.id, existing);
            this.auditLog?.log("security_alert_deduplicated", {
                alertId: existing.id,
                eventCount: existing.eventCount,
            });
            return { ...existing };
        }
        // Create new SecurityCenterAlert
        const projectId = event.projectId ||
            (event.targetResourceRef?.startsWith("projects/")
                ? event.targetResourceRef.split("/")[1]
                : undefined);
        const id = `alt-${crypto.randomUUID()}`;
        const alert = {
            id,
            title: classification.title,
            description: safeDescription,
            severity,
            domain,
            status: "open",
            sourceEventIds: [event.eventId || event.id],
            eventCount: 1,
            projectId,
            target: event.targetResourceRef,
            detectedAt: event.createdAt || now,
            lastObservedAt: now,
            correlationId: `cor-${crypto.randomUUID()}`,
            recommendedAction: classification.recommendedAction,
            evidenceSummary: safeEvidence,
            metadata: {
                dedupKey,
                sourceEventType: event.eventType,
                principalRef: event.principalRef,
            },
        };
        validateSecurityAlert(alert);
        // Step 11: Auto-create Incident for critical alerts or high-risk domains
        if (this.incidentService && (severity === "critical" || classification.autoCreateIncident)) {
            try {
                const incident = await this.incidentService.createIncidentFromAlert(alert);
                alert.incidentId = incident.id;
            }
            catch (err) {
                // Log error and preserve alert
                this.auditLog?.log("incident_autocreate_failed", {
                    alertId: id,
                    error: String(err),
                });
            }
        }
        this.alerts.set(id, alert);
        this.auditLog?.log("security_alert_created", { alertId: id, severity, domain });
        // Step 25: Publish to Notification Seam
        await this.publisher?.publish({
            id: `notif-${crypto.randomUUID()}`,
            type: "SecurityAlertCreated",
            severity: alert.severity,
            title: `[${alert.severity.toUpperCase()}] Security Alert: ${alert.title}`,
            summary: alert.description,
            channels: determineNotificationChannels(alert.severity),
            createdAt: now,
            correlationId: alert.correlationId,
        });
        return { ...alert };
    }
    /**
     * Retrieves an alert by ID.
     */
    getAlert(id) {
        const alert = this.alerts.get(id);
        return alert ? { ...alert } : undefined;
    }
    /**
     * Lists alerts with optional filters.
     */
    listAlerts(filters = {}) {
        let result = Array.from(this.alerts.values());
        if (filters.status) {
            result = result.filter((a) => a.status === filters.status);
        }
        if (filters.severity) {
            result = result.filter((a) => a.severity === filters.severity);
        }
        if (filters.domain) {
            result = result.filter((a) => a.domain === filters.domain);
        }
        if (filters.projectId) {
            result = result.filter((a) => a.projectId === filters.projectId);
        }
        result.sort((a, b) => new Date(b.lastObservedAt).getTime() - new Date(a.lastObservedAt).getTime());
        return result.map((a) => ({ ...a }));
    }
    /**
     * Acknowledges an active alert.
     */
    async acknowledgeAlert(id, actor) {
        const alert = this.alerts.get(id);
        if (!alert)
            throw new Error(`Alert '${id}' not found`);
        alert.status = "acknowledged";
        alert.acknowledgedBy = actor;
        alert.acknowledgedAt = new Date().toISOString();
        this.alerts.set(id, alert);
        this.auditLog?.log("security_alert_acknowledged", { alertId: id, actor });
        return { ...alert };
    }
    /**
     * Dismisses an alert with an audited rationale.
     * Does NOT delete the underlying security events!
     */
    async dismissAlert(id, actor, reason) {
        const alert = this.alerts.get(id);
        if (!alert)
            throw new Error(`Alert '${id}' not found`);
        if (!reason || reason.trim().length < 5) {
            throw new Error("A justification reason is required to dismiss an alert");
        }
        alert.status = "dismissed";
        alert.dismissedBy = actor;
        alert.dismissedAt = new Date().toISOString();
        alert.dismissReason = reason;
        this.alerts.set(id, alert);
        this.auditLog?.log("security_alert_dismissed", { alertId: id, actor, reason });
        return { ...alert };
    }
    /**
     * Marks an alert as resolved.
     */
    async resolveAlert(id, actor) {
        const alert = this.alerts.get(id);
        if (!alert)
            throw new Error(`Alert '${id}' not found`);
        alert.status = "resolved";
        alert.resolvedBy = actor;
        alert.resolvedAt = new Date().toISOString();
        this.alerts.set(id, alert);
        this.auditLog?.log("security_alert_resolved", { alertId: id, actor });
        return { ...alert };
    }
    /* ------------------------------------------------------------------ */
    /* Classification & Deduplication Logic                               */
    /* ------------------------------------------------------------------ */
    classifyEvent(event) {
        const desc = event.description.toLowerCase();
        // 1. Secret Exposure / Leaks
        if (desc.includes("secret") ||
            desc.includes("credential") ||
            desc.includes("api key") ||
            desc.includes("token leak")) {
            const isCritical = event.severity === "CRITICAL" || desc.includes("leak") || desc.includes("exposure");
            return {
                shouldAlert: true,
                domain: "secrets",
                severity: isCritical ? "critical" : "high",
                title: "Potential Secret Exposure Detected",
                description: event.description,
                recommendedAction: "Rotate affected credentials immediately and disable the exposed version in Secret Vault",
                autoCreateIncident: isCritical,
            };
        }
        // 2. Destructive Actions / Audit Tampering
        if (desc.includes("delete_audit_log") || desc.includes("clear_audit_log")) {
            return {
                shouldAlert: true,
                domain: "data_integrity",
                severity: "critical",
                title: "Attempt to Tamper with Immutable Audit Logs",
                description: event.description,
                recommendedAction: "Investigate actor identity and review access controls immediately",
                autoCreateIncident: true,
            };
        }
        // 3. Backup & Recovery Integrity / Deletion
        if (event.eventType === "BACKUP_SECURITY_EVENT" ||
            event.eventType === "INTEGRITY_VIOLATION" ||
            desc.includes("backup") ||
            desc.includes("recovery")) {
            const isCritical = event.severity === "CRITICAL" ||
                desc.includes("compromised") ||
                desc.includes("restore_verification_failed") ||
                desc.includes("delete_denied");
            return {
                shouldAlert: true,
                domain: "backup_recovery",
                severity: isCritical ? "critical" : "high",
                title: isCritical ? "Critical Backup / Recovery Integrity Issue" : "Backup Security Alert",
                description: event.description,
                recommendedAction: "Verify backup catalog status, check retention locks, and review recovery point integrity",
                autoCreateIncident: isCritical,
            };
        }
        // 4. Software Supply Chain / SAST / Vulnerabilities
        if (desc.includes("dependency") ||
            desc.includes("sast") ||
            desc.includes("vulnerability") ||
            desc.includes("lockfile") ||
            desc.includes("package")) {
            const isCritical = event.severity === "CRITICAL" || desc.includes("eval()") || desc.includes("remote code execution");
            return {
                shouldAlert: true,
                domain: "software_supply_chain",
                severity: isCritical ? "critical" : "high",
                title: isCritical ? "Critical Supply-Chain / SAST Vulnerability" : "Software Security Finding",
                description: event.description,
                recommendedAction: "Patch or replace vulnerable package and address SAST finding before release",
                autoCreateIncident: isCritical,
            };
        }
        // 5. Auth Failures
        if (event.eventType === "AUTH_FAILURE") {
            return {
                shouldAlert: true,
                domain: "identity_access",
                severity: event.severity === "CRITICAL" ? "high" : "low",
                title: "Authentication Failure",
                description: event.description,
                recommendedAction: "Review principal authentication logs for credential stuffing patterns",
            };
        }
        // 6. Anomalous Access / Exfiltration
        if (event.eventType === "ANOMALOUS_ACCESS" || event.eventType === "DATA_EXFILTRATION_ATTEMPT") {
            return {
                shouldAlert: true,
                domain: "application_api",
                severity: "critical",
                title: "Anomalous Access or Data Exfiltration Attempt",
                description: event.description,
                recommendedAction: "Terminate caller session and inspect API access logs",
                autoCreateIncident: true,
            };
        }
        // 7. Prompt Injection
        if (event.eventType === "PROMPT_INJECTION") {
            return {
                shouldAlert: true,
                domain: "agent_security",
                severity: "high",
                title: "Prompt Injection Detected",
                description: event.description,
                recommendedAction: "Examine agent interaction history and enforce input boundary filters",
            };
        }
        // 8. Policy Violation fallback
        if (event.eventType === "POLICY_VIOLATION") {
            const severityMap = {
                CRITICAL: "critical",
                HIGH: "high",
                MEDIUM: "medium",
                LOW: "low",
                INFO: "info",
            };
            const sev = severityMap[event.severity] || "medium";
            return {
                shouldAlert: sev !== "info",
                domain: "policy_governance",
                severity: sev,
                title: `Policy Violation: ${event.severity}`,
                description: event.description,
                recommendedAction: "Review security policy logs and actor permissions",
                autoCreateIncident: sev === "critical",
            };
        }
        return {
            shouldAlert: event.severity === "CRITICAL" || event.severity === "HIGH",
            domain: "application_api",
            severity: event.severity === "CRITICAL" ? "critical" : "medium",
            title: `Security Event: ${event.eventType}`,
            description: event.description,
        };
    }
    buildDedupKey(event, domain) {
        const rawTarget = event.targetResourceRef ?? "none";
        const rawPrincipal = event.principalRef ?? "none";
        return `${event.eventType}:${domain}:${rawTarget}:${rawPrincipal}`;
    }
    findDeduplicatedAlert(dedupKey, eventTimeMs) {
        for (const alert of this.alerts.values()) {
            if (alert.status === "resolved" || alert.status === "dismissed") {
                continue;
            }
            if (alert.metadata?.dedupKey === dedupKey) {
                const lastSeenMs = new Date(alert.lastObservedAt).getTime();
                if (Math.abs(eventTimeMs - lastSeenMs) <= this.dedupWindowMs) {
                    return alert;
                }
            }
        }
        return undefined;
    }
    sanitizeText(text) {
        return redactObject({ text }).text;
    }
}
