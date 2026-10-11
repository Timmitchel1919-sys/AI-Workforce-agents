/**
 * Layer 10 — Business Operating Layer: contracts.
 *
 * A SEPARATE layer that models how work is organised (business → board → executive functions →
 * departments → managers → workforce → objectives → initiatives → projects). It owns no tasks or
 * workflows: it produces execution PLANS that the existing Prompt Intelligence → Project Manager →
 * Workflow Engine → Orchestration chain executes. It is private and single-user: no tenants,
 * customers, billing or enterprise RBAC.
 */
import type { Entity } from "./persistence.js";

export const EXECUTIVE_FUNCTIONS = [
  "STRATEGY",
  "OPERATIONS",
  "FINANCE",
  "TECHNOLOGY",
  "PRODUCT",
  "SECURITY",
] as const;
export type ExecutiveFunction = (typeof EXECUTIVE_FUNCTIONS)[number];

export const OBJECTIVE_LEVELS = [
  "STRATEGIC",
  "OPERATIONAL",
  "PROJECT",
] as const;
export type ObjectiveLevel = (typeof OBJECTIVE_LEVELS)[number];

export const OBJECTIVE_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "ACHIEVED",
  "ON_HOLD",
  "CANCELLED",
] as const;
export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number];

export const BUSINESS_PRIORITIES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "CRITICAL",
] as const;
export type BusinessPriority = (typeof BUSINESS_PRIORITIES)[number];

/** Metrics the platform can MEASURE from its own data. A KPI may also be MANUAL. */
export const MEASURED_METRICS = [
  "PROJECT_COMPLETION",
  "TASK_SUCCESS_RATE",
  "RUN_FAILURE_RATE",
  "AI_COST_USD",
  "OPEN_SECURITY_ALERTS",
  "DEPLOYMENT_SUCCESS_RATE",
] as const;
export type MeasuredMetric = (typeof MEASURED_METRICS)[number];

export interface Measurement {
  /** null = there is no data; never a made-up number. */
  value: number | null;
  sample: number;
  unit: string;
  note: string;
}

export interface KpiReading {
  at: string;
  value: number;
  by: string;
  note?: string;
}

export interface Kpi {
  kpiId: string;
  name: string;
  description: string;
  unit: string;
  direction: "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";
  target: number;
  baseline?: number;
  source:
    | { kind: "MANUAL" }
    | { kind: "MEASURED"; metric: MeasuredMetric; projectId?: string };
  /** MANUAL readings (newest last). */
  readings: KpiReading[];
}

export interface KpiStatus {
  kpiId: string;
  name: string;
  unit: string;
  target: number;
  current: number | null;
  /** 0–100 toward the target; null with no data. */
  attainmentPercent: number | null;
  state: "NO_DATA" | "ON_TRACK" | "AT_RISK" | "OFF_TRACK" | "ACHIEVED";
  sample: number;
  note: string;
}

export interface BusinessProfile extends Entity {
  name: string;
  mission: string;
  updatedAt: string;
  updatedBy: string;
}

export interface Department extends Entity {
  departmentId: string;
  name: string;
  description: string;
  executiveFunction: ExecutiveFunction;
  /** The manager coordinates the department's projects and agents through the existing Project Manager. */
  manager?: { kind: "USER" | "AGENT"; ref: string; responsibilities: string[] };
  /** The workforce: agent ids (the agent registry stays the source of truth for agents). */
  agentIds: string[];
  /** Projects this department is accountable for (the project registry stays the source of truth). */
  projectIds: string[];
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface PlanTask {
  taskKey: string;
  title: string;
  taskType: string;
  agentRole?: string;
  /** Suggested workforce members from the owning department; the Agent Router still decides. */
  suggestedAgentIds: string[];
  requiresApproval: boolean;
  dependsOn: string[];
}

export interface ExecutionPlanProposal {
  planId: string;
  objectiveId: string;
  initiativeId: string;
  projectId?: string;
  /** true = a project must be onboarded first (this layer never creates projects). */
  needsProject: boolean;
  workflow: {
    source: "extension" | "default";
    templateId?: string;
    name: string;
  };
  tasks: PlanTask[];
  /** What to submit to Prompt Intelligence to start this through the normal pipeline. */
  promptObjective: string;
  generatedAt: string;
  status: "PROPOSED" | "APPROVED" | "REJECTED";
  decidedBy?: string;
  decidedAt?: string;
}

export interface Initiative extends Entity {
  initiativeId: string;
  objectiveId: string;
  title: string;
  strategy: string;
  projectIds: string[];
  status: "PROPOSED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  plans: ExecutionPlanProposal[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface BusinessObjective extends Entity {
  objectiveId: string;
  level: ObjectiveLevel;
  title: string;
  description: string;
  /** The strategy that turns the objective into initiatives. */
  strategy: string;
  ownerFunction: ExecutiveFunction;
  departmentId?: string;
  parentObjectiveId?: string;
  projectId?: string;
  priority: BusinessPriority;
  status: ObjectiveStatus;
  targetDate?: string;
  kpis: Kpi[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface DecisionRecord extends Entity {
  decisionId: string;
  title: string;
  decision: string;
  decidedAt: string;
  owner: string;
  context: string;
  alternatives: string[];
  rationale: string;
  actions: string[];
  links: {
    objectiveId?: string;
    initiativeId?: string;
    projectId?: string;
    taskId?: string;
  };
  status: "PROPOSED" | "ADOPTED" | "SUPERSEDED" | "REVERSED";
  supersedes?: string;
  supersededBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BoardView {
  business: { name: string; mission: string };
  objectives: {
    objectiveId: string;
    title: string;
    level: ObjectiveLevel;
    priority: BusinessPriority;
    status: ObjectiveStatus;
    ownerFunction: ExecutiveFunction;
    kpis: KpiStatus[];
  }[];
  initiatives: {
    initiativeId: string;
    objectiveId: string;
    title: string;
    status: Initiative["status"];
    projectIds: string[];
  }[];
  risks: { kind: string; message: string; ref: string }[];
  performance: {
    kpis: number;
    withData: number;
    onTrack: number;
    atRisk: number;
    offTrack: number;
    achieved: number;
  };
  recentDecisions: DecisionRecord[];
  generatedAt: string;
}

export interface OrgNode {
  kind:
    | "BUSINESS"
    | "BOARD"
    | "EXECUTIVE"
    | "DEPARTMENT"
    | "MANAGER"
    | "AGENT"
    | "PROJECT";
  id: string;
  name: string;
  children: OrgNode[];
}

export const BUSINESS_COMMANDS = [
  "business_configure",
  "business_create_department",
  "business_update_department",
  "business_archive_department",
  "business_assign_agent",
  "business_unassign_agent",
  "business_set_manager",
  "business_link_department_project",
  "business_create_objective",
  "business_update_objective",
  "business_set_objective_status",
  "business_add_kpi",
  "business_record_kpi_reading",
  "business_create_initiative",
  "business_set_initiative_status",
  "business_propose_plan",
  "business_decide_plan",
  "business_record_decision",
  "business_adopt_decision",
  "business_supersede_decision",
] as const;
export type BusinessCommand = (typeof BUSINESS_COMMANDS)[number];
