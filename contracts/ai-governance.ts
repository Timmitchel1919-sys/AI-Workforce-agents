import type { Entity } from "./persistence.js";

export const AI_RISK_LEVELS = ["UNACCEPTABLE", "HIGH", "LIMITED", "MINIMAL", "UNKNOWN"] as const;
export type AIRiskLevel = typeof AI_RISK_LEVELS[number];

export const AI_GOV_MODEL_CAPABILITIES = [
  "TEXT_GENERATION",
  "CODE_GENERATION",
  "IMAGE_GENERATION",
  "AUDIO_GENERATION",
  "EMBEDDING",
  "REASONING",
  "TOOL_USE",
  "VISION",
] as const;
export type AIGovModelCapability = typeof AI_GOV_MODEL_CAPABILITIES[number];

export interface AIModelRecord extends Entity {
  modelId: string;
  organizationId?: string; // If custom fine-tuned model
  providerId: string;
  name: string;
  version: string;
  capabilities: readonly AIGovModelCapability[];
  contextWindow: number;
  approvedForUse: boolean;
  riskLevel: AIRiskLevel;
  safetyEvaluations: readonly string[];
  createdAt: string;
}

export interface AIUseCase extends Entity {
  useCaseId: string;
  organizationId: string;
  name: string;
  description: string;
  owner: string;
  purpose: string;
  modelRefs: readonly string[];
  agentRefs: readonly string[];
  dataCategories: readonly string[];
  riskLevel: AIRiskLevel;
  humanOversightRequired: boolean;
  status: "PROPOSED" | "EVALUATING" | "APPROVED" | "REJECTED" | "ACTIVE" | "RETIRED";
  evaluationRefs: readonly string[];
  createdAt: string;
}

export interface ModelEvaluation extends Entity {
  evaluationId: string;
  modelId: string;
  type: "SAFETY" | "BIAS" | "HALLUCINATION" | "QUALITY" | "SECURITY" | "PERFORMANCE";
  score: number;
  threshold: number;
  passed: boolean;
  evidenceRef: string;
  evaluatedAt: string;
  evaluatedBy: string; // Automated system or operator ID
}

export interface AIIncident extends Entity {
  incidentId: string;
  useCaseId?: string;
  modelId?: string;
  type: "HALLUCINATION" | "JAILBREAK" | "PROMPT_INJECTION" | "DATA_LEAK" | "BIAS" | "OTHER";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
  evidenceRef: string;
  status: "OPEN" | "INVESTIGATING" | "MITIGATED" | "RESOLVED";
  createdAt: string;
  resolvedAt?: string;
}
