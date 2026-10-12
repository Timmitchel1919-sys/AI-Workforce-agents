import type { Entity } from "./persistence.js";

/**
 * AI Workforce OS — Layer 15: Simulation & Decision Intelligence Contracts
 *
 * Defines the decision-support layer between analysis and execution:
 * - What-if scenario modeling across projects, agents, costs, deployments, and security
 * - Decision matrices comparing alternatives (cost, quality, speed, risk, reversibility)
 * - Explicit assumptions and confidence ratings
 * - Reproducible simulation snapshots
 * - Guaranteed dry-run isolation (no production state mutation)
 */

export const SIMULATION_DOMAINS = [
  "project",
  "agent",
  "cost",
  "deployment",
  "security",
  "general",
] as const;
export type SimulationDomain = (typeof SIMULATION_DOMAINS)[number];

export const SIMULATION_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type SimulationConfidence = (typeof SIMULATION_CONFIDENCE_LEVELS)[number];

export const REVERSIBILITY_LEVELS = [
  "easy",
  "moderate",
  "difficult",
  "irreversible",
] as const;
export type ReversibilityLevel = (typeof REVERSIBILITY_LEVELS)[number];

export interface SimulationOption {
  optionId: string;
  name: string;
  description: string;
  changes: Record<string, unknown>;
  estimatedCost: {
    current: number;
    projected: number;
    delta: number;
    currency: string;
  };
  estimatedDurationMs: {
    current: number;
    projected: number;
    delta: number;
  };
  qualityScore: number; // 0 - 100
  riskLevel: "low" | "medium" | "high" | "critical";
  complexity: "low" | "medium" | "high";
  reversibility: ReversibilityLevel;
  dependencies: readonly string[];
}

export interface DecisionMatrixCriteriaWeights {
  cost: number;
  quality: number;
  speed: number;
  risk: number;
  reversibility: number;
}

export interface ScoredOption {
  optionId: string;
  name: string;
  overallScore: number; // 0 - 100
  rank: number;
  tradeoffs: readonly string[];
  pros: readonly string[];
  cons: readonly string[];
}

export interface DecisionMatrix {
  matrixId: string;
  options: readonly SimulationOption[];
  criteriaWeights: DecisionMatrixCriteriaWeights;
  scoredOptions: readonly ScoredOption[];
}

export interface SimulationInput {
  simulationId: string;
  title: string;
  description: string;
  domain: SimulationDomain;
  projectId?: string;
  proposedChange: Record<string, unknown>;
  constraints?: Record<string, unknown>;
  assumptions: readonly string[];
  options?: readonly SimulationOption[];
  createdBy: string;
}

export interface SimulationProjectedEffect {
  component: string;
  effect: string;
  impact: "positive" | "neutral" | "negative";
}

export interface SimulationIdentifiedRisk {
  risk: string;
  severity: "low" | "medium" | "high" | "critical";
  mitigation: string;
}

export interface SimulationResult {
  simulationId: string;
  title: string;
  domain: SimulationDomain;
  projectId?: string;
  status: "completed" | "failed";
  projectedEffects: readonly SimulationProjectedEffect[];
  identifiedRisks: readonly SimulationIdentifiedRisk[];
  decisionMatrix: DecisionMatrix;
  recommendedOptionId: string;
  recommendationReason: string;
  confidence: SimulationConfidence;
  confidenceFactors: readonly string[];
  assumptions: readonly string[];
  dryRunSafetyVerified: boolean;
  createdAt: string;
}

export interface SimulationSnapshot extends Entity {
  snapshotId: string;
  simulationId: string;
  title: string;
  domain: SimulationDomain;
  projectId?: string;
  timestamp: string;
  initialStateHash: string;
  input: SimulationInput;
  result: SimulationResult;
  decidedOptionId?: string;
  decidedAt?: string;
  decidedBy?: string;
}
