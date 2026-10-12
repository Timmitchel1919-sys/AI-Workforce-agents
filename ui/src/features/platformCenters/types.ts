/** Response shapes of the Layer 9–13 Control Plane routes (mirrors the backend contracts; read-only on the client). */

export type Risk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type DataQuality = "NO_DATA" | "LOW_CONFIDENCE" | "ESTABLISHED";
export interface Rate { value: number | null; numerator: number; denominator: number }

/* ------------------------------ Extensions ------------------------------ */

export type ExtensionHealth = "INSTALLED" | "ACTIVE" | "DISABLED" | "INCOMPATIBLE" | "FAILED" | "UPDATE_AVAILABLE";
export interface DependencyCheck { dependency: { kind: string; id: string; range?: string }; satisfied: boolean; reason: string }
export interface LifecycleStep { step: string; status: "DONE" | "PENDING" | "NOT_APPLICABLE" | "BLOCKED"; note?: string }
export interface ExtensionView {
  extensionId: string;
  type: string;
  name: string;
  description: string;
  source: "builtin" | "user";
  status: string;
  health: ExtensionHealth;
  healthReason: string;
  activeVersion?: string;
  latestVersion: string;
  versions: { version: string; registeredAt: string; tested: boolean | null; review: string | null }[];
  requestedPermissions: string[];
  grantedPermissions: string[];
  missingGrants: string[];
  dependencies: DependencyCheck[];
  capabilities: string[];
  effect: string;
  supportLevel: "ACTIVE" | "REGISTRY_ONLY";
  lifecycle: LifecycleStep[];
  config: Record<string, string | number | boolean>;
  updatedAt: string;
}
export interface ExtensionAuditEvent { id: string; at: string; actor: string; extensionId: string; action: string; version?: string; detail: string }
export interface ExtensionsOverview {
  extensions: ExtensionView[];
  summary: { total: number; installed: number; active: number; disabled: number; incompatible: number; failed: number; updateAvailable: number };
  types: { type: string; level: "ACTIVE" | "REGISTRY_ONLY"; effect: string }[];
  permissions: { scope: string; risk: Risk; description: string; grantable: boolean }[];
  recentAudit: ExtensionAuditEvent[];
  generatedAt: string;
}
export interface ValidationFinding { level: "ERROR" | "WARNING"; path: string; message: string }
export interface ExtensionDetail extends ExtensionView {
  manifests: {
    version: string;
    manifest: Record<string, unknown> & { configSchema?: Record<string, { type: string; description?: string }> };
    test: { passed: boolean; at: string; findings: ValidationFinding[] } | null;
    review: { outcome: string; at: string; findings: string[]; approvedBy?: string } | null;
  }[];
  dependents: { extensionId: string; range?: string }[];
  audit: ExtensionAuditEvent[];
}

/* -------------------------------- Business -------------------------------- */

export interface KpiStatus { kpiId: string; name: string; unit: string; target: number; current: number | null; attainmentPercent: number | null; state: "NO_DATA" | "ON_TRACK" | "AT_RISK" | "OFF_TRACK" | "ACHIEVED"; sample: number; note: string }
export interface Department {
  departmentId: string;
  name: string;
  description: string;
  executiveFunction: string;
  manager?: { kind: "USER" | "AGENT"; ref: string; responsibilities: string[] };
  agentIds: string[];
  projectIds: string[];
  status: "ACTIVE" | "ARCHIVED";
}
export interface OrgNode { kind: string; id: string; name: string; children: OrgNode[] }
export interface BoardObjective { objectiveId: string; title: string; level: string; priority: string; status: string; ownerFunction: string; kpis: KpiStatus[] }
export interface DecisionRecord {
  decisionId: string;
  title: string;
  decision: string;
  decidedAt: string;
  owner: string;
  context: string;
  alternatives: string[];
  rationale: string;
  actions: string[];
  links: { objectiveId?: string; initiativeId?: string; projectId?: string; taskId?: string };
  status: "PROPOSED" | "ADOPTED" | "SUPERSEDED" | "REVERSED";
  supersedes?: string;
  supersededBy?: string;
}
export interface BusinessOverview {
  board: {
    business: { name: string; mission: string };
    objectives: BoardObjective[];
    initiatives: { initiativeId: string; objectiveId: string; title: string; status: string; projectIds: string[] }[];
    risks: { kind: string; message: string; ref: string }[];
    performance: { kpis: number; withData: number; onTrack: number; atRisk: number; offTrack: number; achieved: number };
    recentDecisions: DecisionRecord[];
    generatedAt: string;
  };
  organization: OrgNode;
  departments: Department[];
}
export interface Kpi { kpiId: string; name: string; description: string; unit: string; direction: string; target: number; baseline?: number; source: { kind: "MANUAL" } | { kind: "MEASURED"; metric: string; projectId?: string } }
export interface BusinessObjective {
  objectiveId: string;
  level: string;
  title: string;
  description: string;
  strategy: string;
  ownerFunction: string;
  departmentId?: string;
  projectId?: string;
  priority: string;
  status: string;
  targetDate?: string;
  kpis: Kpi[];
  kpiStatus: KpiStatus[];
}
export interface PlanTask { taskKey: string; title: string; taskType: string; agentRole?: string; suggestedAgentIds: string[]; requiresApproval: boolean; dependsOn: string[] }
export interface PlanProposal {
  planId: string;
  objectiveId: string;
  initiativeId: string;
  projectId?: string;
  needsProject: boolean;
  workflow: { source: string; templateId?: string; name: string };
  tasks: PlanTask[];
  promptObjective: string;
  generatedAt: string;
  status: "PROPOSED" | "APPROVED" | "REJECTED";
  decidedBy?: string;
}
export interface Initiative { initiativeId: string; objectiveId: string; title: string; strategy: string; projectIds: string[]; status: string; plans: PlanProposal[] }
export interface ObjectiveDetail extends BusinessObjective { initiatives: Initiative[]; decisions: DecisionRecord[] }

/* -------------------------------- Portfolio -------------------------------- */

export type HealthState = "HEALTHY" | "AT_RISK" | "CRITICAL" | "BLOCKED" | "UNKNOWN";
export interface HealthSignal { name: string; status: "OK" | "WARN" | "BAD" | "UNKNOWN"; detail: string }
export interface ProjectHealth { projectId: string; state: HealthState; reasons: string[]; signals: HealthSignal[]; evidenceCount: number; computedAt: string }
export interface CostFigure { spentUsd: number | null; tokens: number; unpriced: number }
export interface ProjectSummary {
  projectId: string;
  name: string;
  repository?: string;
  branch?: string;
  stack: string[];
  environment?: string;
  firebaseProject?: string;
  deploymentTarget?: string;
  owner: string;
  priority: string;
  strategicImportance: number;
  urgency: number;
  declaredRisk: number;
  objectives: string[];
  health: ProjectHealth;
  agents: string[];
  workflows: { active: number; total: number };
  cost: CostFigure;
  risks: string[];
  dependsOn: { projectId: string; kind: string }[];
  dependedOnBy: { projectId: string; kind: string }[];
  archived: boolean;
}
export interface ProjectDependency { id: string; from: string; to: string; kind: string; weight: number; note?: string }
export interface ResourceClaim { id: string; projectId: string; kind: string; resourceId: string; exclusive: boolean; note?: string }
export interface ResourceConflict { kind: string; resourceId: string; exclusive: boolean; projects: string[]; source: "declared" | "observed"; severity: "INFO" | "WARNING" | "CONFLICT"; explanation: string }
export interface PortfolioDashboard {
  generatedAt: string;
  counts: { projects: number; active: number; blocked: number; atRisk: number; critical: number; unknown: number; healthy: number };
  activeProjects: ProjectSummary[];
  blockedProjects: { projectId: string; reasons: string[] }[];
  deployments: { projectId: string; total: number; failed: number; lastAt?: string }[];
  failures: { projectId: string; failedTasks: number; failedRuns: number }[];
  security: { projectId: string; openAlerts: number; critical: number }[];
  costs: ({ projectId: string } & CostFigure)[];
  upcomingActions: { projectId: string; kind: string; count: number }[];
  dependencies: ProjectDependency[];
  conflicts: ResourceConflict[];
}
export interface PriorityRank { rank: number; projectId: string; score: number; breakdown: { factor: string; points: number; detail: string }[]; waitFor: string[] }
export interface PortfolioAnswer { question: string; intent: string; answer: string; data: unknown; basis: string[]; confidence: DataQuality }
export interface ReusableKnowledge { kind: string; title: string; projects: string[]; refs: { projectId?: string; memoryId?: string; extensionId?: string }[]; note: string }

/* -------------------------------- Operations -------------------------------- */

export interface StepGate { proposedAction: string; reason: string; affectedResources: string[]; expectedImpact: string; risk: Risk; rollback: string; approvalId?: string; requestedAt: string }
export interface StepRecord {
  stepId: string;
  actionId: string;
  description: string;
  params: Record<string, string | number | boolean>;
  state: string;
  risk: Risk;
  automatic: boolean | null;
  attempts: number;
  notBefore?: string;
  gate?: StepGate;
  output?: string;
  error?: { kind: string; message: string; at: string };
  approvedBy?: string;
  note?: string;
}
export interface AutonomyPlan {
  objective: string;
  context: string;
  dependencies: string[];
  requiredTools: string[];
  agentHint: string;
  modelPolicy: string;
  environment: string;
  expectedResult: string;
  risks: string[];
  rollback: string;
  maxRisk: Risk;
  approvalsExpected: number;
  autoSteps: number;
}
export interface WorkflowInstance {
  instanceId: string;
  definitionId: string;
  name: string;
  projectId: string;
  level: number;
  state: string;
  stateReason: string;
  trigger: { source: string; summary: string; ref?: string; by: string };
  plan: AutonomyPlan;
  planApproved: boolean;
  steps: StepRecord[];
  report?: string;
  createdAt: string;
  updatedAt: string;
}
export interface AutonomyAuditEvent { id: string; at: string; instanceId?: string; projectId?: string; kind: string; actor: string; stepId?: string; risk?: Risk; detail: string }
export interface OperationsView {
  generatedAt: string;
  global: { paused: boolean; reason?: string; emergencyStop: boolean };
  counts: { active: number; queued: number; failed: number; waitingApproval: number; blocked: number; incidents: number; recoveries: number; completed: number };
  active: WorkflowInstance[];
  queued: WorkflowInstance[];
  failed: WorkflowInstance[];
  waitingApprovals: { instanceId: string; projectId: string; stepId: string; gate: StepGate }[];
  autonomousActions: { instanceId: string; projectId: string; stepId: string; actionId: string; at: string; result: string }[];
  blockedOperations: { instanceId: string; projectId: string; stepId?: string; reason: string }[];
  incidents: { instanceId: string; projectId: string; state: string; reason: string; at: string }[];
  recoveries: { instanceId: string; projectId: string; kind: string; detail: string; at: string }[];
  orchestration: { active: number; queued: number; failed: number; waitingApproval: number };
}
export interface AutonomyAction { actionId: string; label: string; kind: string; risk: Risk; restricted: boolean; idempotent: boolean; rollbackAction?: string; impact: string }
export interface WorkflowDefinition { definitionId: string; name: string; description: string; steps: { stepId: string; actionId: string; description: string }[]; boundaries: { allowedActions: string[]; maxRisk: Risk }; builtin: boolean }
export interface TriggerRule { ruleId: string; projectId: string; source: string; eventType?: string; definitionId: string; enabled: boolean }
export interface AutonomyCatalog {
  levels: { level: number; name: string; description: string }[];
  actions: AutonomyAction[];
  definitions: WorkflowDefinition[];
  rules: TriggerRule[];
  settings: { projectId: string; level: number; updatedBy: string }[];
  global: { paused: boolean; reason?: string };
}

/* -------------------------------- Analytics -------------------------------- */

export interface AgentAnalytics {
  agentId: string;
  assigned: number;
  completed: number;
  failed: number;
  inProgress: number;
  successRate: Rate;
  avgExecutionMs: number | null;
  retried: number;
  correctionsRequested: number;
  tokens: number;
  costUsd: number | null;
  unpricedCalls: number;
  models: { model: string; calls: number }[];
  tools: { tool: string; calls: number }[];
  quality: DataQuality;
}
export interface WorkflowAnalytics {
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  active: number;
  completionRate: Rate;
  failureRate: Rate;
  avgDurationMs: number | null;
  medianDurationMs: number | null;
  retryFrequency: Rate;
  failurePoints: { taskType: string; title: string; failures: number }[];
  approvalWait: { decided: number; avgMs: number | null; pending: number; oldestPendingMs: number | null };
  quality: DataQuality;
}
export interface ProjectAnalytics {
  projectId: string;
  completionTrend: { weekStart: string; completed: number }[];
  velocityPerWeek: number | null;
  blockers: { taskId: string; title: string; reason: string }[];
  defectRate: Rate;
  deploymentSuccess: Rate;
  securityIssues: { open: number; highOrCritical: number };
  cost: { usd: number | null; tokens: number; unpriced: number };
  quality: DataQuality;
}
export interface CostIntelligence {
  totalTokens: number;
  pricedUsd: number | null;
  unpricedCalls: number;
  calls: number;
  byProject: { projectId: string; tokens: number; usd: number | null; unpriced: number }[];
  byModel: { model: string; provider: string; calls: number; tokens: number; usd: number | null; unpriced: number }[];
  byAgent: { agentId: string; tokens: number; usd: number | null }[];
  byWorkflow: { runId: string; projectId: string; tokens: number; usd: number | null }[];
  perTask: { average: number | null; sampled: number; unit: string };
  weekly: { weekStart: string; tokens: number; usd: number | null }[];
  note: string;
}
export interface Prediction { kind: string; subject: string; label: "HIGH_RISK" | "LIKELY" | "POSSIBLE" | "LOW_CONFIDENCE"; range?: [number, number]; unit?: string; statement: string; basis: string; sample: number }
export interface Bottleneck { kind: string; subject: string; projectId?: string; severity: "INFO" | "WARNING" | "SERIOUS"; evidence: string }
export interface Recommendation {
  recommendationId: string;
  area: string;
  projectId?: string;
  observation: string;
  evidence: string[];
  recommendation: string;
  tradeoff: string;
  expectedBenefit?: string;
  confidence: DataQuality;
  status: "OPEN" | "APPROVED" | "REJECTED" | "APPLIED" | "MEASURED";
  metric?: { name: string; baseline: number | null; unit: string; lowerIsBetter: boolean };
  appliedNote?: string;
  measurement?: { measuredAt: string; value: number | null; verdict: "IMPROVED" | "NO_CHANGE" | "WORSE" | "NO_DATA"; delta: number | null };
}
export interface Lesson { lessonId: string; kind: string; projectId?: string; title: string; content: string; evidence: string[]; storedInKnowledge: boolean; createdAt: string }
export interface AnalyticsOverview {
  generatedAt: string;
  scope: { projects: number };
  workflows: WorkflowAnalytics;
  cost: CostIntelligence;
  topAgents: AgentAnalytics[];
  bottlenecks: Bottleneck[];
  predictions: Prediction[];
  openRecommendations: number;
  autonomy: { workflows: number; completed: number; escalated: number; failed: number };
  quality: DataQuality;
}
export interface WhatIfResult { simulated: boolean; summary: string; impacts: { area: string; statement: string; value?: number | null; unit?: string }[]; assumptions: string[]; confidence: DataQuality }
