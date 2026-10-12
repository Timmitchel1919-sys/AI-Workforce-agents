/** Wire types for the Security & Trust Center HTTP contract (read endpoints + `security_*` commands). */

export const MANAGE_CAPABILITY = "manage_security";
export const APPROVE_CAPABILITY = "approve";

export const TABS = [
  "overview", "security", "agents", "models", "tools", "policies", "approvals", "simulator", "audit", "secrets", "project", "emergency",
] as const;
export type SecurityTab = (typeof TABS)[number];

export const EMERGENCY_STATES = ["NORMAL", "PAUSED", "INVESTIGATING", "RECOVERY_REQUIRED"] as const;
export type EmergencyState = (typeof EMERGENCY_STATES)[number];

export const DASHBOARD_STATUSES = ["NOMINAL", "ATTENTION", "DEGRADED", "HALTED"] as const;
export type DashboardStatus = (typeof DASHBOARD_STATUSES)[number];

export const ALERT_SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export const ALERT_STATUSES = ["OPEN", "ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const TRUST_STATES = ["TRUSTED", "LIMITED", "REVIEW_REQUIRED", "SUSPENDED", "DISABLED"] as const;
export type TrustState = (typeof TRUST_STATES)[number];

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const ACTION_CLASSES = [
  "READ", "ANALYZE", "CREATE", "UPDATE", "EXECUTE", "PUBLISH", "DEPLOY", "DELETE", "EXPORT", "SHARE", "ADMINISTRATIVE",
] as const;
export const ENVIRONMENTS = ["DEVELOPMENT", "TEST", "STAGING", "PRODUCTION"] as const;
export type GovEnvironment = (typeof ENVIRONMENTS)[number];

export const POLICY_LAYERS = [
  "SYSTEM_SECURITY", "PROJECT_SECURITY", "PROJECT_ARCHITECTURE", "WORKFLOW", "TASK", "AGENT", "USER_REQUEST",
] as const;
/** Policies can only restrict, so ALLOW is never offered when authoring. */
export const AUTHORABLE_EFFECTS = ["REQUIRE_REVIEW", "REQUIRE_SECURITY_REVIEW", "REQUIRE_APPROVAL", "DENY"] as const;
export const DATA_CLASSES = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED", "SECRET"] as const;
export const TOOL_APPROVALS = ["NONE", "HIGH_RISK", "ALWAYS"] as const;
export const ENABLE_STATUSES = ["ENABLED", "DISABLED"] as const;
export const APPROVAL_STATES = ["PENDING", "APPROVED", "DENIED", "EXPIRED", "CANCELLED"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export type Detail = Record<string, string | number | boolean>;

export interface LedgerEntry {
  id: string;
  seq: number;
  at: string;
  operation: string;
  severity?: string;
  actor: string;
  projectId?: string;
  agentId?: string;
  taskId?: string;
  executionId?: string;
  toolId?: string;
  action?: string;
  resource?: string;
  risk?: string;
  policyIds?: string[];
  result: string;
  detail: Detail;
  prevHash: string;
  hash: string;
}

export interface EmergencyHistoryItem { state: string; at: string; by: string; note?: string }
export interface Emergency {
  id: "global";
  state: EmergencyState;
  reason?: string;
  engagedBy?: string;
  engagedAt?: string;
  history: EmergencyHistoryItem[];
}

export interface DependencyVulnerabilities { scannedAt: string; critical: number; high: number; moderate: number; low: number }

export interface Dashboard {
  status: DashboardStatus;
  emergency: EmergencyState;
  openAlerts: number;
  criticalAlerts: number;
  blockedActions24h: number;
  pendingApprovals: number;
  policyViolations7d: number;
  suspendedAgents: number;
  recentEvents: LedgerEntry[];
  dependencyVulnerabilities: DependencyVulnerabilities | null;
  configChangesUnacknowledged: number;
  generatedAt: string;
}

export interface TrustScore {
  score: number;
  label: string;
  factors: { factor: string; count: number; points: number }[];
  disclaimer: string;
}

export interface AuditorFinding {
  findingId: string;
  ruleId: string;
  severity: "low" | "medium" | "high" | "critical";
  subjectId: string;
  detail: string;
}

export interface LedgerVerification { ok: boolean; entries: number; brokenAt?: number }

export interface Overview {
  banner: string | null;
  emergency: Emergency;
  dashboard: Dashboard;
  trustScore: TrustScore;
  auditorFindings: AuditorFinding[];
  ledger: LedgerVerification;
  capabilities: {
    policyEngine: boolean;
    outboundNetworkDetection: boolean;
    dependencyScanning: boolean;
    canManage: boolean;
    isAdmin: boolean;
  };
  generatedAt: string;
}

export interface PolicyConditions {
  actions?: string[];
  resourceKinds?: string[];
  resourceIncludes?: string[];
  environments?: GovEnvironment[];
  minRisk?: RiskLevel;
  minCount?: number;
  dataClasses?: string[];
  agentTrust?: string[];
  contentHasSecret?: boolean;
}
export interface PolicyScope { projectId?: string; workflowId?: string; agentId?: string; taskType?: string }
export interface Policy {
  policyId: string;
  name: string;
  description: string;
  layer: string;
  priority: number;
  scope: PolicyScope;
  conditions: PolicyConditions;
  effect: string;
  approvalRequirement: string | null;
  securityRequirement: string | null;
  status: "ENABLED" | "DISABLED";
  builtin: boolean;
  critical: boolean;
  version: number;
  updatedAt: string;
  updatedBy: string;
}
export interface PoliciesResponse { layers: string[]; policies: Policy[] }

export interface AgentTrust {
  id: string;
  agentId: string;
  state: TrustState;
  riskLevel: string;
  reason?: string;
  updatedAt: string;
  updatedBy: string;
  history: { state: string; at: string; by: string; reason?: string }[];
}
export interface ModelTrust {
  id: string;
  provider: string;
  model: string;
  riskClass: string;
  approvedTaskTypes: string[];
  maxDataClass: string;
  external: boolean;
  dataHandling: string;
  contextCapacity?: number;
  costPolicy?: string;
  status: "ENABLED" | "DISABLED";
  updatedAt: string;
  updatedBy: string;
}
export interface ToolTrust {
  id: string;
  toolId: string;
  name: string;
  capabilities: string[];
  risk: string;
  permissions: string[];
  environments: string[];
  allowedAgents: string[];
  approval: string;
  securityRequirements: string[];
  status: string;
  updatedAt: string;
  updatedBy: string;
}
export interface TrustResponse {
  agents: AgentTrust[];
  models: ModelTrust[];
  defaultModelPolicy: ModelTrust;
  tools: ToolTrust[];
  states: string[];
}

export interface Approval {
  approvalId: string;
  state: ApprovalState;
  executionId?: string;
  taskId?: string;
  projectId: string;
  action: string;
  resource: string;
  risk: string;
  reason: string;
  expectedImpact: string;
  reversibility: string;
  changes: string;
  proposedCommand?: string;
  agentId?: string;
  modelId?: string;
  environment?: string;
  policies: string[];
  requestedBy: string;
  requestedAt: string;
  decision?: string;
  decidedBy?: string;
  decidedAt?: string;
  expiresAt?: string;
}

export interface Alert {
  id: string;
  alertId: string;
  severity: AlertSeverity;
  source: string;
  projectId?: string;
  executionId?: string;
  taskId?: string;
  agentId?: string;
  event: string;
  description: string;
  evidence: Detail;
  createdAt: string;
  updatedAt: string;
  status: AlertStatus;
  dedupeKey: string;
  occurrences: number;
  history: { status: string; at: string; by: string; note?: string }[];
}

export interface AuditRow {
  seq: number;
  at: string;
  who: string;
  actor: string;
  what: string;
  operation: string;
  severity: string;
  projectId?: string;
  agentId?: string;
  taskId?: string;
  executionId?: string;
  toolId?: string;
  action?: string;
  resource?: string;
  risk?: string;
  policyIds: string[];
  result: string;
  detail: Detail;
  hash: string;
}
export interface LedgerResponse { entries: AuditRow[]; verification: LedgerVerification }

export interface AuditFilters {
  agentId: string; taskId: string; toolId: string; action: string; risk: string; policyId: string; result: string; operation: string;
  since: string; until: string;
}
export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  agentId: "", taskId: "", toolId: "", action: "", risk: "", policyId: "", result: "", operation: "", since: "", until: "",
};

export interface SimPolicy { policyId: string; name: string; layer: string; effect: string; builtin: boolean }
export interface SimulationDecision {
  decisionId: string;
  effect: string;
  risk: {
    level: string;
    score: number;
    factors: { factor: string; points: number; detail: string }[];
    blastRadius: string;
    reversible: boolean;
  };
  resource: { ref: string; kind: string; label: string; dataClass: string; production: boolean };
  environment: string;
  action: string;
  policies: SimPolicy[];
  overruled: SimPolicy[];
  obligations: { approval: unknown; review: unknown; securityReview: unknown };
  approval?: unknown;
  reasons: string[];
  explanation: string;
  agentTrust?: string;
  simulated: true;
  at: string;
}
export interface SimulationResponse { decision: SimulationDecision; executed: false }
export interface SimulationRequest {
  projectId: string; action: string; resource: string; agentId: string; taskType: string; environment: string; count: string; toolId: string;
}

export interface SecretsResponse {
  detectionsThisProcess: number;
  detections7d: number;
  recent: LedgerEntry[];
  protections: string[];
  configured: { name: string; configured: boolean }[];
  note: string;
}

export interface ProjectSecurity {
  projectId: string;
  configBaseline: {
    establishedAt: string;
    files: number;
    pending: { path: string; change: "added" | "modified" | "removed"; at: string; severity: string }[];
    acceptedAt: string | null;
  } | null;
  dependencyScan: {
    id: string;
    scannedAt: string;
    counts: { critical: number; high: number; moderate: number; low: number; info: number; total: number };
    top: { name: string; severity: string; fixAvailable: boolean }[];
    source: string;
  } | null;
  openAlerts: number;
  drift7d: number;
}

export const SECURITY_COMMANDS = [
  "security_set_agent_trust", "security_set_model_trust", "security_set_tool_trust", "security_create_policy", "security_update_policy",
  "security_set_policy_status", "security_decide_approval", "security_cancel_approval", "security_alert_transition",
  "security_emergency_stop", "security_emergency_advance", "security_emergency_resume", "security_scan_config",
  "security_accept_config", "security_scan_dependencies",
] as const;
export type SecurityCommandName = (typeof SECURITY_COMMANDS)[number];

export interface CommandResult {
  command: string;
  outcome: "executed" | "denied" | "rejected";
  ok: boolean;
  errorKind?: "forbidden" | "not_found" | "invalid_state" | "invalid_request" | "command_failure";
  reason: string;
  resourceId?: string;
  correlationId: string;
  details: Record<string, unknown>;
  auditEventId: string;
  timestamp: string;
}
export interface CommandInput { command: SecurityCommandName; body: Record<string, unknown> }
