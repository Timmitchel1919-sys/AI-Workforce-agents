import { useState } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Lock,
  Key,
  Server,
  Terminal,
  Activity,
  Layers,
  CheckCircle2,
  Eye,
  Check,
  XCircle,
  RotateCw,
} from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";
import {
  useSecuritySummary,
  useSecurityAlerts,
  useSecurityIncidents,
  useSecurityRecommendations,
  useAcknowledgeAlert,
  useDismissAlert,
  useAssignIncident,
  useUpdateIncidentStatus,
  useResolveIncident,
  useReopenIncident,
  useAddIncidentNote,
  type SecurityAlert,
  type SecurityIncident,
  type SecurityAlertSeverity,
  type SecurityAlertStatus,
  type SecurityIncidentStatus,
  type SecurityDomain,
} from "../../features/security";
import { useApprovalQueue, type ApprovalItem } from "../../features/governance";
import { DestructiveActionGate } from "../../components/security";
import {
  Button,
  Badge,
  Dialog,
  Input,
  Textarea,
  Spinner,
  Select,
} from "../../components/ui";

const DOMAIN_LABELS: Record<SecurityDomain, { label: string; icon: any }> = {
  identity_access: { label: "Identity & Access", icon: Lock },
  application_api: { label: "Apps & APIs", icon: Server },
  agent_security: { label: "Agent Security", icon: Terminal },
  secrets: { label: "Secrets & Vault", icon: Key },
  data_integrity: { label: "Data Integrity", icon: Activity },
  destructive_actions: { label: "Destructive Actions", icon: AlertTriangle },
  software_supply_chain: { label: "Software Supply Chain", icon: Layers },
  backup_recovery: { label: "Backup & Recovery", icon: RotateCw },
  policy_governance: { label: "Policy Governance", icon: ShieldCheck },
  integration_security: { label: "Integrations", icon: Layers },
  cloud_edge: { label: "Cloud & Edge", icon: Server },
  email_phishing: { label: "Email & Phishing", icon: ShieldAlert },
  endpoint_security: { label: "Endpoint Security", icon: ShieldCheck },
};

export default function SecurityPage() {
  const [activeTab, setActiveTab] = useState<"overview" | "alerts" | "incidents" | "recommendations" | "gate">("overview");

  // Summary, alerts, incidents, recommendations
  const { data: summary, isLoading: isSummaryLoading, refetch: refetchSummary } = useSecuritySummary();
  const [alertSeverityFilter, setAlertSeverityFilter] = useState<string>("");
  const [alertStatusFilter, setAlertStatusFilter] = useState<string>("");
  const { data: alerts = [], isLoading: isAlertsLoading, refetch: refetchAlerts } = useSecurityAlerts({
    severity: (alertSeverityFilter || undefined) as SecurityAlertSeverity,
    status: (alertStatusFilter || undefined) as SecurityAlertStatus,
  });

  const [incidentStatusFilter, setIncidentStatusFilter] = useState<string>("");
  const { data: incidents = [], isLoading: isIncidentsLoading, refetch: refetchIncidents } = useSecurityIncidents({
    status: (incidentStatusFilter || undefined) as SecurityIncidentStatus,
  });

  const { data: recommendations = [], isLoading: isRecsLoading } = useSecurityRecommendations();

  // Modals / Detail state
  const [selectedAlert, setSelectedAlert] = useState<SecurityAlert | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<SecurityIncident | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [showDismissInput, setShowDismissInput] = useState(false);

  // Incident mutation state
  const [assigneeInput, setAssigneeInput] = useState("");
  const [statusInput, setStatusInput] = useState<SecurityIncidentStatus>("investigating");
  const [statusNoteInput, setStatusNoteInput] = useState("");
  const [resolutionSummary, setResolutionSummary] = useState("");
  const [rootCauseInput, setRootCauseInput] = useState("");
  const [reopenReasonInput, setReopenReasonInput] = useState("");
  const [newNoteInput, setNewNoteInput] = useState("");
  const [incidentTab, setIncidentTab] = useState<"timeline" | "notes" | "actions">("timeline");

  // Mutations
  const acknowledgeMutation = useAcknowledgeAlert();
  const dismissMutation = useDismissAlert();
  const assignMutation = useAssignIncident();
  const updateStatusMutation = useUpdateIncidentStatus();
  const resolveMutation = useResolveIncident();
  const reopenMutation = useReopenIncident();
  const addNoteMutation = useAddIncidentNote();

  // Legacy Destructive Action Gate queue
  const { items: pendingApprovals } = useApprovalQueue({ status: "requested" });
  const [selectedApproval, setSelectedApproval] = useState<ApprovalItem | null>(null);
  const highRiskApprovals = pendingApprovals.filter((a: ApprovalItem) => a.risk === "high");

  const getStatusBadgeVariant = (status?: string) => {
    switch (status) {
      case "secure":
        return "success";
      case "attention":
        return "warning";
      case "degraded":
      case "critical":
        return "danger";
      case "unknown":
      default:
        return "neutral";
    }
  };

  const getSeverityBadgeVariant = (sev?: string) => {
    switch (sev) {
      case "critical":
        return "danger";
      case "high":
        return "warning";
      case "medium":
        return "primary";
      case "low":
      case "info":
      default:
        return "neutral";
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Security Center"
        description="Unified Zero Trust Security Operations, Posture Governance & Incident Management"
      />

      {/* Critical Alert Banner (Step 19) */}
      {summary?.activeBanner && (
        <div
          className={`mb-6 p-4 rounded-xl border flex items-center justify-between shadow-lg ${
            summary.activeBanner.severity === "critical"
              ? "bg-red-950/60 border-red-500/60 text-red-200"
              : "bg-amber-950/60 border-amber-500/60 text-amber-200"
          }`}
        >
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 animate-pulse text-red-400" />
            <div>
              <div className="font-bold text-base tracking-wide flex items-center gap-2">
                {summary.activeBanner.title}
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/40">
                  {summary.activeBanner.count} {summary.activeBanner.count === 1 ? "Alert" : "Alerts"}
                </span>
              </div>
              <div className="text-sm opacity-90">{summary.activeBanner.message}</div>
            </div>
          </div>
          <Button
            variant="danger"
            onClick={() => {
              setAlertSeverityFilter("critical");
              setActiveTab("alerts");
            }}
          >
            Review Critical Alerts
          </Button>
        </div>
      )}

      {/* Primary Navigation Tabs */}
      <div className="flex border-b border-border mb-6 gap-2">
        <button
          className={`pb-3 px-4 font-semibold text-sm transition-colors border-b-2 ${
            activeTab === "overview"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("overview")}
        >
          Security Posture Overview
        </button>
        <button
          className={`pb-3 px-4 font-semibold text-sm transition-colors border-b-2 flex items-center gap-1.5 ${
            activeTab === "alerts"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("alerts")}
        >
          Alerts
          {summary && summary.criticalAlerts + summary.highAlerts > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-xs bg-red-500/20 text-red-400 border border-red-500/30">
              {summary.criticalAlerts + summary.highAlerts}
            </span>
          )}
        </button>
        <button
          className={`pb-3 px-4 font-semibold text-sm transition-colors border-b-2 flex items-center gap-1.5 ${
            activeTab === "incidents"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("incidents")}
        >
          Incidents
          {summary && summary.openIncidents > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30">
              {summary.openIncidents}
            </span>
          )}
        </button>
        <button
          className={`pb-3 px-4 font-semibold text-sm transition-colors border-b-2 ${
            activeTab === "recommendations"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("recommendations")}
        >
          Recommendations
        </button>
        <button
          className={`pb-3 px-4 font-semibold text-sm transition-colors border-b-2 flex items-center gap-1.5 ${
            activeTab === "gate"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("gate")}
        >
          Destructive Action Gate
          {highRiskApprovals.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-xs bg-red-500/20 text-red-400 border border-red-500/30">
              {highRiskApprovals.length}
            </span>
          )}
        </button>
      </div>

      {/* ======================================================================= */}
      {/* TAB 1: OVERVIEW & POSTURE SCORE                                          */}
      {/* ======================================================================= */}
      {activeTab === "overview" && (
        <PageSection>
          {isSummaryLoading ? (
            <div className="py-16 flex justify-center items-center">
              <Spinner />
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {/* Posture Score Meter / Windows Security Header */}
              <div className="bg-surface/80 backdrop-blur-md rounded-2xl p-6 border border-border shadow-md">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex items-center gap-5">
                    <div
                      className={`w-20 h-20 rounded-2xl flex items-center justify-center border text-2xl font-black ${
                        summary?.overallStatus === "secure"
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                          : summary?.overallStatus === "attention"
                          ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                          : "bg-red-500/10 border-red-500/30 text-red-400"
                      }`}
                    >
                      {summary?.overallScore ?? "--"}
                    </div>
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="text-2xl font-bold">Overall Security Posture</h2>
                        <Badge variant={getStatusBadgeVariant(summary?.overallStatus) as any}>
                          {summary?.overallStatus?.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-sm mt-1">
                        {summary?.overallStatus === "secure"
                          ? "All monitored Zero Trust boundaries, secrets, supply chains, and recovery points are healthy."
                          : summary?.overallStatus === "attention"
                          ? "Elevated risks or medium-priority alerts require administrator attention."
                          : "Critical vulnerabilities, active incidents, or degraded telemetry demand immediate remediation."}
                      </p>
                      <div className="text-xs text-muted-foreground/80 mt-2 flex items-center gap-4">
                        <span>Last evaluated: {new Date(summary?.generatedAt || "").toLocaleString()}</span>
                        {summary?.telemetryDegraded && (
                          <span className="text-amber-400 font-medium">⚠️ Telemetry degraded</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-surface-alt/70 p-3 rounded-xl border border-border/60">
                    <div className="px-3 py-2 text-center">
                      <div className="text-xs text-muted-foreground uppercase font-medium">Critical</div>
                      <div className="text-xl font-bold text-red-400">{summary?.criticalAlerts ?? 0}</div>
                    </div>
                    <div className="px-3 py-2 text-center">
                      <div className="text-xs text-muted-foreground uppercase font-medium">High</div>
                      <div className="text-xl font-bold text-amber-400">{summary?.highAlerts ?? 0}</div>
                    </div>
                    <div className="px-3 py-2 text-center">
                      <div className="text-xs text-muted-foreground uppercase font-medium">Incidents</div>
                      <div className="text-xl font-bold text-primary">{summary?.openIncidents ?? 0}</div>
                    </div>
                    <div className="px-3 py-2 text-center">
                      <div className="text-xs text-muted-foreground uppercase font-medium">Findings</div>
                      <div className="text-xl font-bold text-foreground">{summary?.unresolvedFindings ?? 0}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 13 Domain Bento Cards (Step 18) */}
              <div>
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                  Security Domains & Telemetry
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {summary?.domains.map((dom) => {
                    const info = DOMAIN_LABELS[dom.domain] || { label: dom.domain, icon: Activity };
                    const Icon = info.icon;
                    return (
                      <div
                        key={dom.domain}
                        className="bg-surface/90 border border-border/80 rounded-xl p-5 hover:border-primary/50 transition-all flex flex-col justify-between shadow-sm"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2.5">
                              <div className="p-2 rounded-lg bg-surface-alt border border-border/60">
                                <Icon className="w-4 h-4 text-primary" />
                              </div>
                              <span className="font-semibold text-sm">{info.label}</span>
                            </div>
                            <Badge variant={getStatusBadgeVariant(dom.status) as any}>
                              {dom.configured ? dom.status : "Not Configured"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground min-h-[36px]">{dom.summary}</p>
                        </div>

                        <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-xs">
                          {dom.configured ? (
                            <span className="text-muted-foreground">
                              {dom.openCritical > 0 ? (
                                <span className="text-red-400 font-semibold">{dom.openCritical} critical</span>
                              ) : dom.openHigh > 0 ? (
                                <span className="text-amber-400 font-semibold">{dom.openHigh} high</span>
                              ) : (
                                <span className="text-emerald-400">All clear</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60 italic">Telemetry not integrated</span>
                          )}
                          <Button
                            variant="secondary"
                            className="text-xs px-2 py-1 h-auto"
                            onClick={() => {
                              setActiveTab("alerts");
                            }}
                          >
                            Inspect
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </PageSection>
      )}

      {/* ======================================================================= */}
      {/* TAB 2: ALERTS LIST & DETAIL (Step 20, 21)                                */}
      {/* ======================================================================= */}
      {activeTab === "alerts" && (
        <PageSection>
          <div className="bg-surface rounded-xl p-6 border border-border">
            {/* Filters */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <Select
                  value={alertSeverityFilter}
                  onChange={(e) => setAlertSeverityFilter(e.target.value)}
                  className="w-36 text-xs"
                >
                  <option value="">All Severities</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </Select>

                <Select
                  value={alertStatusFilter}
                  onChange={(e) => setAlertStatusFilter(e.target.value)}
                  className="w-36 text-xs"
                >
                  <option value="">All Statuses</option>
                  <option value="open">Open</option>
                  <option value="acknowledged">Acknowledged</option>
                  <option value="investigating">Investigating</option>
                  <option value="resolved">Resolved</option>
                  <option value="dismissed">Dismissed</option>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => refetchAlerts()} className="text-xs">
                  <RotateCw className="w-3.5 h-3.5 mr-1" /> Refresh
                </Button>
              </div>
            </div>

            {/* Table */}
            {isAlertsLoading ? (
              <div className="py-12 flex justify-center">
                <Spinner />
              </div>
            ) : alerts.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
                No security alerts found matching the active criteria.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground uppercase font-semibold">
                      <th className="py-3 px-3">Severity</th>
                      <th className="py-3 px-3">Title</th>
                      <th className="py-3 px-3">Domain</th>
                      <th className="py-3 px-3">Count</th>
                      <th className="py-3 px-3">Last Observed</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {alerts.map((alert) => (
                      <tr key={alert.id} className="hover:bg-surface-alt/50 transition-colors">
                        <td className="py-3 px-3">
                          <Badge variant={getSeverityBadgeVariant(alert.severity) as any}>
                            {alert.severity.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 font-semibold text-foreground">
                          {alert.title}
                          {alert.incidentId && (
                            <span className="ml-2 text-[10px] text-amber-400 font-normal border border-amber-500/30 px-1 rounded">
                              Linked Incident
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-muted-foreground capitalize">
                          {alert.domain.replace(/_/g, " ")}
                        </td>
                        <td className="py-3 px-3 font-mono">{alert.eventCount}</td>
                        <td className="py-3 px-3 text-muted-foreground">
                          {new Date(alert.lastObservedAt).toLocaleTimeString()}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              alert.status === "open"
                                ? "bg-red-500/20 text-red-300"
                                : alert.status === "acknowledged"
                                ? "bg-amber-500/20 text-amber-300"
                                : "bg-emerald-500/20 text-emerald-300"
                            }`}
                          >
                            {alert.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <Button
                            variant="secondary"
                            className="text-xs px-2.5 py-1"
                            onClick={() => {
                              setSelectedAlert(alert);
                              setShowDismissInput(false);
                            }}
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" /> View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </PageSection>
      )}

      {/* ======================================================================= */}
      {/* TAB 3: INCIDENTS LIST & DETAIL (Step 22, 23)                             */}
      {/* ======================================================================= */}
      {activeTab === "incidents" && (
        <PageSection>
          <div className="bg-surface rounded-xl p-6 border border-border">
            {/* Filters */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <Select
                  value={incidentStatusFilter}
                  onChange={(e) => setIncidentStatusFilter(e.target.value)}
                  className="w-40 text-xs"
                >
                  <option value="">All Statuses</option>
                  <option value="open">Open</option>
                  <option value="triaged">Triaged</option>
                  <option value="investigating">Investigating</option>
                  <option value="contained">Contained</option>
                  <option value="recovering">Recovering</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => refetchIncidents()} className="text-xs">
                  <RotateCw className="w-3.5 h-3.5 mr-1" /> Refresh
                </Button>
              </div>
            </div>

            {/* Table */}
            {isIncidentsLoading ? (
              <div className="py-12 flex justify-center">
                <Spinner />
              </div>
            ) : incidents.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
                No active security incidents recorded.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground uppercase font-semibold">
                      <th className="py-3 px-3">Severity</th>
                      <th className="py-3 px-3">Title</th>
                      <th className="py-3 px-3">Domain</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3">Owner</th>
                      <th className="py-3 px-3">Created</th>
                      <th className="py-3 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {incidents.map((inc) => (
                      <tr key={inc.id} className="hover:bg-surface-alt/50 transition-colors">
                        <td className="py-3 px-3">
                          <Badge variant={getSeverityBadgeVariant(inc.severity) as any}>
                            {inc.severity.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 font-semibold text-foreground">{inc.title}</td>
                        <td className="py-3 px-3 text-muted-foreground capitalize">
                          {inc.domain.replace(/_/g, " ")}
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/20 text-primary-foreground border border-primary/30">
                            {inc.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-muted-foreground">{inc.owner || "Unassigned"}</td>
                        <td className="py-3 px-3 text-muted-foreground">
                          {new Date(inc.createdAt).toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <Button
                            variant="secondary"
                            className="text-xs px-2.5 py-1"
                            onClick={() => {
                              setSelectedIncident(inc);
                              setAssigneeInput(inc.owner || "");
                              setStatusInput(inc.status);
                              setIncidentTab("timeline");
                            }}
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" /> Manage
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </PageSection>
      )}

      {/* ======================================================================= */}
      {/* TAB 4: RECOMMENDATIONS (Step 24)                                         */}
      {/* ======================================================================= */}
      {activeTab === "recommendations" && (
        <PageSection>
          <div className="bg-surface rounded-xl p-6 border border-border">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              Deterministic Security Recommendations
            </h3>
            {isRecsLoading ? (
              <div className="py-12 flex justify-center">
                <Spinner />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {recommendations.map((rec) => (
                  <div
                    key={rec.id}
                    className="p-5 rounded-xl border border-border bg-surface-alt flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant={getSeverityBadgeVariant(rec.severity) as any}>
                          {rec.severity.toUpperCase()}
                        </Badge>
                        <span className="text-xs font-mono text-muted-foreground">{rec.ruleId}</span>
                      </div>
                      <h4 className="font-semibold text-base mb-1">{rec.title}</h4>
                      <p className="text-xs text-muted-foreground mb-3">{rec.description}</p>
                    </div>

                    <div className="p-3 bg-surface rounded-lg border border-border/60 text-xs">
                      <div className="font-semibold text-primary mb-1">Remediation Action:</div>
                      <div className="text-foreground">{rec.remediationAction}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PageSection>
      )}

      {/* ======================================================================= */}
      {/* TAB 5: DESTRUCTIVE ACTION GATE (Preserved from Step 2)                    */}
      {/* ======================================================================= */}
      {activeTab === "gate" && (
        <PageSection>
          <div className="bg-surface rounded-xl p-6 border border-border">
            <h3 className="text-xl font-bold mb-2">Destructive Action Approval Gate</h3>
            <p className="text-muted-foreground text-sm mb-6">
              Intercepted high-risk and critical destructive actions requiring human-in-the-loop authorization.
            </p>

            {highRiskApprovals.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
                No destructive actions pending operator approval.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {highRiskApprovals.map((approval) => (
                  <div
                    key={approval.approvalId}
                    className="flex items-center justify-between p-4 border border-border rounded-lg bg-surface-alt"
                  >
                    <div>
                      <div className="font-semibold text-sm">{approval.action}</div>
                      <div className="text-xs text-muted-foreground">{approval.reason}</div>
                    </div>
                    <Button variant="primary" onClick={() => setSelectedApproval(approval)}>
                      Review Action
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PageSection>
      )}

      {/* ======================================================================= */}
      {/* MODAL: ALERT DETAIL (Step 21, 28)                                       */}
      {/* ======================================================================= */}
      {selectedAlert && (
        <Dialog
          open={Boolean(selectedAlert)}
          onClose={() => setSelectedAlert(null)}
          title={
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-400" />
              <span>Security Alert Details</span>
            </div>
          }
        >
          <div className="flex flex-col gap-4 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <Badge variant={getSeverityBadgeVariant(selectedAlert.severity) as any}>
                {selectedAlert.severity.toUpperCase()}
              </Badge>
              <span className="font-mono text-muted-foreground">{selectedAlert.id}</span>
            </div>

            <div>
              <div className="font-bold text-sm text-foreground">{selectedAlert.title}</div>
              <p className="text-muted-foreground mt-1">{selectedAlert.description}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 bg-surface-alt p-3 rounded-lg border border-border/60">
              <div>
                <span className="text-muted-foreground">Domain: </span>
                <span className="font-semibold capitalize">{selectedAlert.domain.replace(/_/g, " ")}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Status: </span>
                <span className="font-semibold capitalize">{selectedAlert.status}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Event Count: </span>
                <span className="font-semibold">{selectedAlert.eventCount}</span>
              </div>
              <div>
                <span className="text-muted-foreground">First Detected: </span>
                <span>{new Date(selectedAlert.detectedAt).toLocaleString()}</span>
              </div>
            </div>

            {selectedAlert.recommendedAction && (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                <div className="font-bold text-primary mb-1">Recommended Action:</div>
                <div className="text-foreground">{selectedAlert.recommendedAction}</div>
              </div>
            )}

            {/* Redacted evidence summary */}
            {selectedAlert.evidenceSummary && (
              <div className="p-3 rounded-lg bg-surface-alt border border-border">
                <div className="font-bold mb-1">Sanitized Telemetry Evidence:</div>
                <div className="font-mono text-[11px] text-muted-foreground break-all">
                  {selectedAlert.evidenceSummary}
                </div>
              </div>
            )}

            {showDismissInput && (
              <div className="flex flex-col gap-2 mt-2 p-3 bg-surface-alt rounded-lg border border-border">
                <label className="font-semibold">Reason for Dismissal:</label>
                <Input
                  value={dismissReason}
                  onChange={(e) => setDismissReason(e.target.value)}
                  placeholder="e.g. Known benign test run / false positive"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              {selectedAlert.status === "open" && (
                <>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      if (!showDismissInput) {
                        setShowDismissInput(true);
                      } else {
                        await dismissMutation.mutateAsync({
                          alertId: selectedAlert.id,
                          reason: dismissReason || "Dismissed by operator",
                        });
                        setSelectedAlert(null);
                        refetchAlerts();
                        refetchSummary();
                      }
                    }}
                  >
                    <XCircle className="w-3.5 h-3.5 mr-1" />
                    {showDismissInput ? "Confirm Dismissal" : "Dismiss Alert"}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={async () => {
                      await acknowledgeMutation.mutateAsync(selectedAlert.id);
                      setSelectedAlert(null);
                      refetchAlerts();
                      refetchSummary();
                    }}
                  >
                    <Check className="w-3.5 h-3.5 mr-1" /> Acknowledge Alert
                  </Button>
                </>
              )}
              <Button variant="secondary" onClick={() => setSelectedAlert(null)}>
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* ======================================================================= */}
      {/* MODAL: INCIDENT DETAIL & LIFECYCLE (Step 23, 29, 30)                     */}
      {/* ======================================================================= */}
      {selectedIncident && (
        <Dialog
          open={Boolean(selectedIncident)}
          onClose={() => setSelectedIncident(null)}
          title={
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-400" />
              <span>Incident Response: {selectedIncident.title}</span>
            </div>
          }
        >
          <div className="flex flex-col gap-4 text-xs max-h-[75vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center gap-2">
                <Badge variant={getSeverityBadgeVariant(selectedIncident.severity) as any}>
                  {selectedIncident.severity.toUpperCase()}
                </Badge>
                <span className="font-semibold text-primary">{selectedIncident.status.toUpperCase()}</span>
              </div>
              <span className="font-mono text-muted-foreground">{selectedIncident.id}</span>
            </div>

            <div className="flex border-b border-border gap-2">
              <button
                className={`pb-2 px-3 font-semibold ${
                  incidentTab === "timeline" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"
                }`}
                onClick={() => setIncidentTab("timeline")}
              >
                Audit Timeline ({selectedIncident.timeline.length})
              </button>
              <button
                className={`pb-2 px-3 font-semibold ${
                  incidentTab === "notes" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"
                }`}
                onClick={() => setIncidentTab("notes")}
              >
                Investigation Notes ({selectedIncident.investigationNotes.length})
              </button>
              <button
                className={`pb-2 px-3 font-semibold ${
                  incidentTab === "actions" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"
                }`}
                onClick={() => setIncidentTab("actions")}
              >
                Response Actions
              </button>
            </div>

            {/* TIMELINE */}
            {incidentTab === "timeline" && (
              <div className="flex flex-col gap-2.5">
                {selectedIncident.timeline.map((entry) => (
                  <div key={entry.id} className="p-2.5 rounded-lg bg-surface-alt border border-border/60">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-foreground capitalize">
                        {entry.type.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-muted-foreground">{entry.summary}</div>
                    <div className="text-[10px] text-primary/80 mt-1">Actor: {entry.actor}</div>
                  </div>
                ))}
              </div>
            )}

            {/* NOTES */}
            {incidentTab === "notes" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  {selectedIncident.investigationNotes.map((n, idx) => (
                    <div key={idx} className="p-3 bg-surface-alt rounded-lg border border-border">
                      <div className="text-foreground">{n.note}</div>
                      <div className="text-[10px] text-muted-foreground mt-1 flex justify-between">
                        <span>By {n.author}</span>
                        <span>{new Date(n.timestamp).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col gap-2 pt-2 border-t border-border">
                  <Textarea
                    placeholder="Add an investigation finding or triage observation..."
                    value={newNoteInput}
                    onChange={(e) => setNewNoteInput(e.target.value)}
                  />
                  <Button
                    variant="primary"
                    onClick={async () => {
                      if (!newNoteInput) return;
                      await addNoteMutation.mutateAsync({
                        incidentId: selectedIncident.id,
                        note: newNoteInput,
                      });
                      setNewNoteInput("");
                      refetchIncidents();
                      setSelectedIncident(null);
                    }}
                  >
                    Add Note
                  </Button>
                </div>
              </div>
            )}

            {/* RESPONSE ACTIONS */}
            {incidentTab === "actions" && (
              <div className="flex flex-col gap-4">
                {/* Assign */}
                <div className="p-3 bg-surface-alt rounded-lg border border-border flex flex-col gap-2">
                  <label className="font-semibold">Assign Incident Commander:</label>
                  <div className="flex gap-2">
                    <Input
                      value={assigneeInput}
                      onChange={(e) => setAssigneeInput(e.target.value)}
                      placeholder="Username or team..."
                    />
                    <Button
                      variant="primary"
                      onClick={async () => {
                        await assignMutation.mutateAsync({
                          incidentId: selectedIncident.id,
                          owner: assigneeInput,
                        });
                        refetchIncidents();
                        setSelectedIncident(null);
                      }}
                    >
                      Assign
                    </Button>
                  </div>
                </div>

                {/* Status Update */}
                <div className="p-3 bg-surface-alt rounded-lg border border-border flex flex-col gap-2">
                  <label className="font-semibold">Update Status:</label>
                  <Select
                    value={statusInput}
                    onChange={(e) => setStatusInput(e.target.value as any)}
                  >
                    <option value="open">Open</option>
                    <option value="triaged">Triaged</option>
                    <option value="investigating">Investigating</option>
                    <option value="contained">Contained</option>
                    <option value="recovering">Recovering</option>
                  </Select>
                  <Input
                    placeholder="Optional status transition note..."
                    value={statusNoteInput}
                    onChange={(e) => setStatusNoteInput(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      await updateStatusMutation.mutateAsync({
                        incidentId: selectedIncident.id,
                        status: statusInput,
                        note: statusNoteInput,
                      });
                      refetchIncidents();
                      setSelectedIncident(null);
                    }}
                  >
                    Apply Status
                  </Button>
                </div>

                {/* Resolve Incident (Step 29) */}
                {selectedIncident.status !== "resolved" && selectedIncident.status !== "closed" && (
                  <div className="p-3 bg-surface-alt rounded-lg border border-border flex flex-col gap-2">
                    <label className="font-semibold text-emerald-400">Resolve Incident:</label>
                    <Textarea
                      placeholder="Mandatory comprehensive resolution summary (min 15 chars)..."
                      value={resolutionSummary}
                      onChange={(e) => setResolutionSummary(e.target.value)}
                    />
                    <Input
                      placeholder="Identified root cause (optional)..."
                      value={rootCauseInput}
                      onChange={(e) => setRootCauseInput(e.target.value)}
                    />
                    <Button
                      variant="primary"
                      disabled={resolutionSummary.length < 15}
                      onClick={async () => {
                        await resolveMutation.mutateAsync({
                          incidentId: selectedIncident.id,
                          summary: resolutionSummary,
                          rootCause: rootCauseInput,
                        });
                        refetchIncidents();
                        refetchSummary();
                        setSelectedIncident(null);
                      }}
                    >
                      Resolve Incident
                    </Button>
                  </div>
                )}

                {/* Reopen Incident (Step 30) */}
                {(selectedIncident.status === "resolved" || selectedIncident.status === "closed") && (
                  <div className="p-3 bg-surface-alt rounded-lg border border-border flex flex-col gap-2">
                    <label className="font-semibold text-amber-400">Reopen Incident:</label>
                    <Input
                      placeholder="Reason for reopening (min 10 chars)..."
                      value={reopenReasonInput}
                      onChange={(e) => setReopenReasonInput(e.target.value)}
                    />
                    <Button
                      variant="danger"
                      disabled={reopenReasonInput.length < 10}
                      onClick={async () => {
                        await reopenMutation.mutateAsync({
                          incidentId: selectedIncident.id,
                          reason: reopenReasonInput,
                        });
                        refetchIncidents();
                        refetchSummary();
                        setSelectedIncident(null);
                      }}
                    >
                      Reopen Incident
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-3 border-t border-border">
              <Button variant="secondary" onClick={() => setSelectedIncident(null)}>
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Destructive Action Gate modal from legacy approval */}
      {selectedApproval && (
        <DestructiveActionGate
          approval={selectedApproval}
          isOpen={true}
          onClose={() => setSelectedApproval(null)}
        />
      )}
    </PageContainer>
  );
}
