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
import type {
  SecurityCenterAlert,
  SecurityDomain,
  SecurityDomainPosture,
  SecurityIncident,
  SecurityPostureStatus,
  SecurityPostureSummary,
  SecurityRecommendation,
} from "../../contracts/security-center.js";
import type { BackupCatalogService } from "../recovery/backup-catalog.js";
import type { AlertEngine } from "./alert-engine.js";
import type { SecurityIncidentService } from "./security-incident-service.js";

export interface SecurityCenterServiceOptions {
  alertEngine: AlertEngine;
  incidentService: SecurityIncidentService;
  backupCatalog?: BackupCatalogService;
  telemetryHealthy?: boolean;
}

export class SecurityCenterService {
  private readonly alertEngine: AlertEngine;
  private readonly incidentService: SecurityIncidentService;
  private readonly backupCatalog?: BackupCatalogService;
  private isTelemetryHealthy: boolean;

  constructor(options: SecurityCenterServiceOptions) {
    this.alertEngine = options.alertEngine;
    this.incidentService = options.incidentService;
    this.backupCatalog = options.backupCatalog;
    this.isTelemetryHealthy = options.telemetryHealthy ?? true;
  }

  setTelemetryHealthy(healthy: boolean): void {
    this.isTelemetryHealthy = healthy;
  }

  /**
   * Generates the comprehensive Security Posture Summary (Steps 3, 4, 31).
   */
  async getSummary(
    principal?: OperatorPrincipal,
    projectId?: string,
  ): Promise<SecurityPostureSummary> {
    const now = new Date().toISOString();

    // Fetch active alerts and incidents visible to caller
    const alerts = this.listAlerts({}, principal, projectId);
    const openAlerts = alerts.filter((a) => a.status === "open" || a.status === "investigating");

    const criticalAlerts = openAlerts.filter((a) => a.severity === "critical").length;
    const highAlerts = openAlerts.filter((a) => a.severity === "high").length;
    const mediumAlerts = openAlerts.filter((a) => a.severity === "medium").length;
    const lowAlerts = openAlerts.filter((a) => a.severity === "low").length;

    const incidents = this.listIncidents({}, principal, projectId);
    const openIncidents = incidents.filter(
      (i) => i.status === "open" || i.status === "triaged" || i.status === "investigating" || i.status === "recovering",
    );

    // Evaluate all 13 domains
    const domains = await this.evaluateDomains(openAlerts);

    // Step 4: Deterministic Scoring Calculation
    let score = 100;
    score -= criticalAlerts * 25;
    score -= highAlerts * 12;
    score -= mediumAlerts * 5;
    score -= lowAlerts * 1;
    score -= openIncidents.filter((i) => i.severity === "critical").length * 20;

    if (!this.isTelemetryHealthy) {
      score -= 35; // Significant penalty for degraded telemetry
    }

    // Clamp score 0 to 100
    score = Math.max(0, Math.min(100, score));

    // Map status from score
    let overallStatus: SecurityPostureStatus;
    if (!this.isTelemetryHealthy) {
      overallStatus = score <= 39 ? "critical" : "degraded";
    } else if (score >= 90) {
      overallStatus = "secure";
    } else if (score >= 70) {
      overallStatus = "attention";
    } else if (score >= 40) {
      overallStatus = "degraded";
    } else {
      overallStatus = "critical";
    }

    // Active banner if critical or high issues exist
    let activeBanner: SecurityPostureSummary["activeBanner"];
    if (criticalAlerts > 0) {
      activeBanner = {
        title: "CRITICAL SECURITY ATTENTION REQUIRED",
        severity: "critical",
        message: `${criticalAlerts} critical security alert${criticalAlerts > 1 ? "s" : ""} require immediate response.`,
        count: criticalAlerts,
      };
    } else if (highAlerts > 0) {
      activeBanner = {
        title: "HIGH SECURITY ATTENTION REQUIRED",
        severity: "high",
        message: `${highAlerts} high-priority security alert${highAlerts > 1 ? "s" : ""} pending review.`,
        count: highAlerts,
      };
    } else if (!this.isTelemetryHealthy) {
      activeBanner = {
        title: "SECURITY TELEMETRY DEGRADED",
        severity: "attention",
        message: "One or more security telemetry backends are unavailable.",
        count: 1,
      };
    }

    return {
      generatedAt: now,
      overallStatus,
      overallScore: score,
      domains,
      criticalAlerts,
      highAlerts,
      mediumAlerts,
      lowAlerts,
      openIncidents: openIncidents.length,
      unresolvedFindings: openAlerts.length,
      telemetryDegraded: !this.isTelemetryHealthy,
      activeBanner,
    };
  }

  /**
   * Lists alerts enforcing capability and project isolation (Step 15, 16).
   */
  listAlerts(
    filters: { severity?: SecurityCenterAlert["severity"]; status?: SecurityCenterAlert["status"]; domain?: SecurityDomain } = {},
    principal?: OperatorPrincipal,
    projectId?: string,
  ): SecurityCenterAlert[] {
    const allAlerts = this.alertEngine.listAlerts({
      severity: filters.severity,
      status: filters.status,
      domain: filters.domain,
    });

    return allAlerts.filter((alert) => {
      if (projectId && alert.projectId !== projectId) {
        return false;
      }
      return this.canAccessProject(principal, alert.projectId);
    });
  }

  getAlert(id: string, principal?: OperatorPrincipal): SecurityCenterAlert | undefined {
    const alert = this.alertEngine.getAlert(id);
    if (!alert) return undefined;

    if (!this.canAccessProject(principal, alert.projectId)) {
      return undefined;
    }

    return alert;
  }

  /**
   * Lists incidents with capability and project boundary enforcement.
   */
  listIncidents(
    filters: { severity?: SecurityIncident["severity"]; status?: SecurityIncident["status"]; domain?: SecurityDomain } = {},
    principal?: OperatorPrincipal,
    projectId?: string,
  ): SecurityIncident[] {
    const allIncidents = this.incidentService.listIncidents({
      severity: filters.severity,
      status: filters.status,
      domain: filters.domain,
    });

    return allIncidents.filter((incident) => {
      if (projectId && incident.projectId !== projectId) {
        return false;
      }
      return this.canAccessProject(principal, incident.projectId);
    });
  }

  getIncident(id: string, principal?: OperatorPrincipal): SecurityIncident | undefined {
    const incident = this.incidentService.getIncident(id);
    if (!incident) return undefined;

    if (!this.canAccessProject(principal, incident.projectId)) {
      return undefined;
    }

    return incident;
  }

  private isGlobalViewer(principal?: OperatorPrincipal): boolean {
    if (!principal) return true;
    return principal.role === "admin" || principal.allowedProjects === "*";
  }

  private canAccessProject(principal: OperatorPrincipal | undefined, itemProjectId?: string): boolean {
    if (!principal) return true;
    if (this.isGlobalViewer(principal)) return true;
    if (!itemProjectId) return false; // Global events are only visible to global viewers
    return principal.allowedProjects.includes(itemProjectId);
  }

  async acknowledgeAlert(id: string, actor: string): Promise<SecurityCenterAlert> {
    return this.alertEngine.acknowledgeAlert(id, actor);
  }

  async dismissAlert(id: string, actor: string, reason: string): Promise<SecurityCenterAlert> {
    return this.alertEngine.dismissAlert(id, actor, reason);
  }

  async resolveAlert(id: string, actor: string): Promise<SecurityCenterAlert> {
    return this.alertEngine.resolveAlert(id, actor);
  }

  async assignIncident(id: string, owner: string, assignedBy: string): Promise<SecurityIncident> {
    return this.incidentService.assignOwner(id, owner, assignedBy);
  }

  async updateIncidentStatus(
    id: string,
    status: SecurityIncident["status"],
    actor: string,
    note?: string,
  ): Promise<SecurityIncident> {
    return this.incidentService.updateStatus(id, status, actor, note);
  }

  async resolveIncident(
    id: string,
    resolvedBy: string,
    summary: string,
    rootCause?: string,
  ): Promise<SecurityIncident> {
    return this.incidentService.resolveIncident(id, resolvedBy, summary, rootCause);
  }

  async reopenIncident(id: string, reopenedBy: string, reason: string): Promise<SecurityIncident> {
    return this.incidentService.reopenIncident(id, reopenedBy, reason);
  }

  async addIncidentNote(id: string, author: string, note: string): Promise<SecurityIncident> {
    return this.incidentService.addNote(id, author, note);
  }

  /**
   * Deterministic Recommendations Engine (Step 24).
   */
  async getRecommendations(): Promise<SecurityRecommendation[]> {
    const recommendations: SecurityRecommendation[] = [];

    const openAlerts = this.alertEngine.listAlerts({ status: "open" });

    // 1. Secret Exposure
    if (openAlerts.some((a) => a.domain === "secrets")) {
      recommendations.push({
        id: "rec-secrets-rotation",
        domain: "secrets",
        title: "Rotate Exposed Credentials",
        description: "Potential credential leak detected. Rotate affected secret references and revoke active versions.",
        severity: "critical",
        remediationAction: "Access Secret Vault, initiate key rotation, and disable exposed versions.",
        ruleId: "SEC-REC-001",
        status: "active",
      });
    }

    // 2. Supply Chain / SAST
    if (openAlerts.some((a) => a.domain === "software_supply_chain")) {
      recommendations.push({
        id: "rec-supply-chain-patch",
        domain: "software_supply_chain",
        title: "Remediate Vulnerable Dependencies",
        description: "Critical or high vulnerabilities detected by dependency or SAST scanners.",
        severity: "high",
        remediationAction: "Run npm run security:deps and update flagged packages to patched versions.",
        ruleId: "SEC-REC-002",
        status: "active",
      });
    }

    // 3. Backup / Disaster Recovery
    if (this.backupCatalog) {
      const summary = await this.backupCatalog.getSecuritySummary();
      if (summary.staleBackups > 0 || summary.failedBackups > 0 || summary.unverifiedBackups > 0) {
        recommendations.push({
          id: "rec-backup-overdue",
          domain: "backup_recovery",
          title: "Verify Disaster Recovery Points",
          description: "One or more resources have stale or unverified recovery points.",
          severity: "high",
          remediationAction: "Initiate scheduled backup and execute an isolated DR drill.",
          ruleId: "SEC-REC-003",
          status: "active",
        });
      }
    }

    // 4. Default baseline recommendations
    if (recommendations.length === 0) {
      recommendations.push({
        id: "rec-baseline-posture",
        domain: "policy_governance",
        title: "Maintain Zero Trust Enforcements",
        description: "All core security domains are operating within normal baseline limits.",
        severity: "low",
        remediationAction: "Continue regular DR drills and dependency audit cycles.",
        ruleId: "SEC-REC-000",
        status: "active",
      });
    }

    return recommendations;
  }

  /* ------------------------------------------------------------------ */
  /* Internal Domain Evaluation                                         */
  /* ------------------------------------------------------------------ */

  private async evaluateDomains(openAlerts: readonly SecurityCenterAlert[]): Promise<SecurityDomainPosture[]> {
    const now = new Date().toISOString();
    const result: SecurityDomainPosture[] = [];

    // All 13 canonical domains
    const domains: SecurityDomain[] = [
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

    for (const domain of domains) {
      // Step 2 & 18: Unconfigured domains report not_configured / unknown
      if (domain === "cloud_edge" || domain === "email_phishing" || domain === "endpoint_security") {
        result.push({
          domain,
          status: "unknown",
          openCritical: 0,
          openHigh: 0,
          openMedium: 0,
          openLow: 0,
          lastEvaluatedAt: now,
          summary: "External telemetry integration not configured in this environment",
          recommendations: [],
          configured: false,
        });
        continue;
      }

      const domainAlerts = openAlerts.filter((a) => a.domain === domain);
      const crit = domainAlerts.filter((a) => a.severity === "critical").length;
      const high = domainAlerts.filter((a) => a.severity === "high").length;
      const med = domainAlerts.filter((a) => a.severity === "medium").length;
      const low = domainAlerts.filter((a) => a.severity === "low").length;

      let status: SecurityPostureStatus = "secure";
      let summary = "All boundary controls active and healthy";

      if (crit > 0) {
        status = "critical";
        summary = `${crit} critical security issue${crit > 1 ? "s" : ""} requiring immediate intervention`;
      } else if (high > 0) {
        status = "attention";
        summary = `${high} high priority security alert${high > 1 ? "s" : ""} pending review`;
      } else if (med > 0) {
        status = "attention";
        summary = `${med} medium priority warning${med > 1 ? "s" : ""} observed`;
      }

      result.push({
        domain,
        status,
        openCritical: crit,
        openHigh: high,
        openMedium: med,
        openLow: low,
        lastEvaluatedAt: now,
        summary,
        recommendations: domainAlerts.map((a) => a.recommendedAction).filter((r): r is string => Boolean(r)),
        configured: true,
      });
    }

    return result;
  }
}
