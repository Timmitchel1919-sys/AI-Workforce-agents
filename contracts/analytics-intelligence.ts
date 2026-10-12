/**
 * Layer 13 — Analytics, Prediction & Optimization: contracts.
 *
 * Turns recorded operational data into: what is happening, why, what is likely next, and what to
 * do. Every figure is computed from real runs, tasks, usage, alerts, approvals and tool activity.
 * With too little data the answer says so (NO_DATA / LOW CONFIDENCE) instead of inventing a number,
 * and a prediction is always a range with a label, never a certainty.
 */
import type { Entity } from "./persistence.js";

export type DataQuality = "NO_DATA" | "LOW_CONFIDENCE" | "ESTABLISHED";

export interface Rate {
  /** null = there was nothing to measure. */
  value: number | null;
  numerator: number;
  denominator: number;
}

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
  approvalWait: {
    decided: number;
    avgMs: number | null;
    pending: number;
    oldestPendingMs: number | null;
  };
  quality: DataQuality;
}

export interface ProjectAnalytics {
  projectId: string;
  /** Tasks completed per week, oldest first (last 8 weeks). */
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
  byProject: {
    projectId: string;
    tokens: number;
    usd: number | null;
    unpriced: number;
  }[];
  byModel: {
    model: string;
    provider: string;
    calls: number;
    tokens: number;
    usd: number | null;
    unpriced: number;
  }[];
  byAgent: { agentId: string; tokens: number; usd: number | null }[];
  byWorkflow: {
    runId: string;
    projectId: string;
    tokens: number;
    usd: number | null;
  }[];
  perTask: { average: number | null; sampled: number; unit: "tokens" };
  weekly: { weekStart: string; tokens: number; usd: number | null }[];
  note: string;
}

export type Prediction = {
  kind:
    | "WORKFLOW_FAILURE"
    | "DEPLOYMENT_RISK"
    | "COST_TREND"
    | "PROJECT_DELAY"
    | "RESOURCE_BOTTLENECK"
    | "RECURRING_FAILURE";
  subject: string;
  /** Never "certain": HIGH RISK / LIKELY / POSSIBLE, or LOW CONFIDENCE when the sample is small. */
  label: "HIGH_RISK" | "LIKELY" | "POSSIBLE" | "LOW_CONFIDENCE";
  /** Plausible range for the quantity (a probability for failures, USD or tokens for cost, days for delay). */
  range?: [number, number];
  unit?: string;
  statement: string;
  basis: string;
  sample: number;
};

export interface Bottleneck {
  kind:
    | "REPEATED_FAILURE"
    | "APPROVAL_QUEUE"
    | "OVERLOADED_AGENT"
    | "SLOW_WORKFLOW"
    | "UNAVAILABLE_TOOL"
    | "DEPLOYMENT"
    | "REPEATED_MANUAL_STEP";
  subject: string;
  projectId?: string;
  severity: "INFO" | "WARNING" | "SERIOUS";
  evidence: string;
}

export const RECOMMENDATION_AREAS = [
  "PROMPT",
  "WORKFLOW",
  "ROUTING",
  "MODEL",
  "TOOL",
  "UX",
  "TESTING",
  "DEPLOYMENT",
  "COST",
] as const;
export type RecommendationArea = (typeof RECOMMENDATION_AREAS)[number];

export const RECOMMENDATION_STATUSES = [
  "OPEN",
  "APPROVED",
  "REJECTED",
  "APPLIED",
  "MEASURED",
] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export interface Recommendation extends Entity {
  recommendationId: string;
  area: RecommendationArea;
  projectId?: string;
  observation: string;
  evidence: string[];
  recommendation: string;
  /** What gets worse or must be checked if this is applied. Always stated for cost advice. */
  tradeoff: string;
  expectedBenefit?: string;
  confidence: DataQuality;
  status: RecommendationStatus;
  /** Applying a recommendation always passes the owner. */
  requiresApproval: true;
  metric?: {
    name: string;
    baseline: number | null;
    unit: string;
    lowerIsBetter: boolean;
  };
  decidedBy?: string;
  decidedAt?: string;
  appliedBy?: string;
  appliedAt?: string;
  appliedNote?: string;
  measurement?: {
    measuredAt: string;
    value: number | null;
    verdict: "IMPROVED" | "NO_CHANGE" | "WORSE" | "NO_DATA";
    delta: number | null;
  };
  createdAt: string;
  updatedAt: string;
}

export type WhatIfScenario =
  | { kind: "PRIORITIZE"; projectId: string; above: string }
  | { kind: "PAUSE_PROJECT"; projectId: string }
  | { kind: "SWITCH_MODEL"; fromModel: string; toModel: string };

export interface WhatIfResult {
  scenario: WhatIfScenario;
  /** Always true: the simulation reads state and never writes it. */
  simulated: true;
  summary: string;
  impacts: {
    area: "RESOURCES" | "AGENTS" | "DELAY" | "COST" | "DEPENDENCIES";
    statement: string;
    value?: number | null;
    unit?: string;
  }[];
  assumptions: string[];
  confidence: DataQuality;
}

export interface Lesson extends Entity {
  lessonId: string;
  kind:
    | "SUCCESSFUL_WORKFLOW"
    | "FAILED_WORKFLOW"
    | "COMMON_ERROR"
    | "EFFECTIVE_AGENT"
    | "EFFECTIVE_MODEL"
    | "DEPLOYMENT"
    | "SECURITY";
  projectId?: string;
  title: string;
  content: string;
  evidence: string[];
  key: string;
  storedInKnowledge: boolean;
  createdAt: string;
}

export interface AnalyticsOverview {
  generatedAt: string;
  scope: { projects: number };
  workflows: WorkflowAnalytics;
  cost: CostIntelligence;
  topAgents: AgentAnalytics[];
  bottlenecks: Bottleneck[];
  predictions: Prediction[];
  openRecommendations: number;
  autonomy: {
    workflows: number;
    completed: number;
    escalated: number;
    failed: number;
  };
  quality: DataQuality;
}

export const ANALYTICS_COMMANDS = [
  "analytics_refresh_recommendations",
  "analytics_decide_recommendation",
  "analytics_mark_applied",
  "analytics_measure_recommendation",
  "analytics_run_what_if",
  "analytics_capture_lessons",
] as const;
export type AnalyticsCommand = (typeof ANALYTICS_COMMANDS)[number];
