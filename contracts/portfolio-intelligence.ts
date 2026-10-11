/**
 * Layer 11 — Portfolio & Multi-Project Intelligence: contracts.
 *
 * Project portfolio management for the owner's OWN projects (AIMS, Money Mind, …). It is not
 * tenancy: projects stay individually isolated, every read is filtered to the projects the
 * principal may see, and an operation that spans two projects needs access to both. The legacy
 * `EnterprisePortfolio`/`PortfolioProgram` stubs in `portfolio.ts` are not used.
 *
 * Everything computed here comes from real platform data (runs, tasks, alerts, approvals, usage).
 * Where there is no data the answer is UNKNOWN, never an invented percentage.
 */
import type { Entity } from "./persistence.js";

export const PORTFOLIO_PRIORITIES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "CRITICAL",
] as const;
export type PortfolioPriority = (typeof PORTFOLIO_PRIORITIES)[number];

export const HEALTH_STATES = [
  "HEALTHY",
  "AT_RISK",
  "CRITICAL",
  "BLOCKED",
  "UNKNOWN",
] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

/** Attributes the owner sets on a project; registry facts (repo, stack, …) are resolved, not copied. */
export interface ProjectProfile extends Entity {
  projectId: string;
  priority: PortfolioPriority;
  /** 1 (low) – 5 (high) */
  strategicImportance: number;
  urgency: number;
  /** Owner-declared risk 1–5 (health adds evidence-based risk on top). */
  declaredRisk: number;
  objectives: string[];
  stack: string[];
  deploymentTarget?: string;
  firebaseProject?: string;
  environment?: string;
  archived: boolean;
  updatedAt: string;
  updatedBy: string;
}

export const DEPENDENCY_KINDS_PORTFOLIO = [
  "DEPENDS_ON",
  "ORCHESTRATES",
  "CONSUMES",
] as const;
export type ProjectDependencyKind = (typeof DEPENDENCY_KINDS_PORTFOLIO)[number];

/** "from <kind> to": AI Workforce OS ORCHESTRATES AIMS; AIMS CONSUMES AI Workforce capability. */
export interface ProjectDependency extends Entity {
  from: string;
  to: string;
  kind: ProjectDependencyKind;
  /** 1–5: how much `from` suffers if `to` is unhealthy. */
  weight: number;
  note?: string;
  createdAt: string;
  createdBy: string;
}

export const PORTFOLIO_RESOURCE_KINDS = [
  "ENVIRONMENT",
  "AGENT",
  "MODEL",
  "TOOL",
  "COMPUTE",
] as const;
export type PortfolioResourceKind = (typeof PORTFOLIO_RESOURCE_KINDS)[number];

export interface ResourceClaim extends Entity {
  projectId: string;
  kind: PortfolioResourceKind;
  resourceId: string;
  exclusive: boolean;
  note?: string;
  createdAt: string;
  createdBy: string;
}

export interface PortfolioHealthSignal {
  name: string;
  status: "OK" | "WARN" | "BAD" | "UNKNOWN";
  detail: string;
}

export interface ProjectHealth {
  projectId: string;
  state: HealthState;
  reasons: string[];
  signals: PortfolioHealthSignal[];
  /** Runs/tasks/alerts examined; 0 means there is no operational data. */
  evidenceCount: number;
  computedAt: string;
}

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
  priority: PortfolioPriority;
  strategicImportance: number;
  urgency: number;
  declaredRisk: number;
  objectives: string[];
  health: ProjectHealth;
  agents: string[];
  workflows: { active: number; total: number };
  cost: { spentUsd: number | null; tokens: number; unpriced: number };
  risks: string[];
  dependsOn: { projectId: string; kind: ProjectDependencyKind }[];
  dependedOnBy: { projectId: string; kind: ProjectDependencyKind }[];
  archived: boolean;
}

export interface ResourceConflict {
  kind: PortfolioResourceKind | "LOCK";
  resourceId: string;
  exclusive: boolean;
  projects: string[];
  source: "declared" | "observed";
  severity: "INFO" | "WARNING" | "CONFLICT";
  explanation: string;
}

export interface PriorityRank {
  rank: number;
  projectId: string;
  score: number;
  breakdown: { factor: string; points: number; detail: string }[];
  /** Projects that should be handled first because this one depends on them and they are not healthy. */
  waitFor: string[];
}

export interface PortfolioDashboard {
  generatedAt: string;
  counts: {
    projects: number;
    active: number;
    blocked: number;
    atRisk: number;
    critical: number;
    unknown: number;
    healthy: number;
  };
  activeProjects: ProjectSummary[];
  blockedProjects: { projectId: string; reasons: string[] }[];
  deployments: {
    projectId: string;
    total: number;
    failed: number;
    lastAt?: string;
  }[];
  failures: { projectId: string; failedTasks: number; failedRuns: number }[];
  security: { projectId: string; openAlerts: number; critical: number }[];
  costs: {
    projectId: string;
    spentUsd: number | null;
    tokens: number;
    unpriced: number;
  }[];
  upcomingActions: {
    projectId: string;
    kind: "APPROVAL" | "READY_TASK" | "BLOCKED_TASK";
    count: number;
  }[];
  dependencies: ProjectDependency[];
  conflicts: ResourceConflict[];
}

export interface PortfolioAnswer {
  question: string;
  intent: string;
  answer: string;
  data: unknown;
  /** What the answer was computed from; empty when there was nothing to compute from. */
  basis: string[];
  confidence: "ESTABLISHED" | "LIMITED_DATA" | "NO_DATA";
}

export interface ReusableKnowledge {
  kind: "PATTERN" | "SKILL" | "WORKFLOW";
  title: string;
  projects: string[];
  refs: { projectId?: string; memoryId?: string; extensionId?: string }[];
  note: string;
}

export const PORTFOLIO_COMMANDS = [
  "portfolio_set_profile",
  "portfolio_archive_project",
  "portfolio_restore_project",
  "portfolio_add_dependency",
  "portfolio_remove_dependency",
  "portfolio_claim_resource",
  "portfolio_release_resource",
] as const;
export type PortfolioCommand = (typeof PORTFOLIO_COMMANDS)[number];
