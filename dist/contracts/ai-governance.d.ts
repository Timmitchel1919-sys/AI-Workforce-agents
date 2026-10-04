import type { Entity } from "./persistence.js";
export declare const AI_RISK_LEVELS: readonly ["UNACCEPTABLE", "HIGH", "LIMITED", "MINIMAL", "UNKNOWN"];
export type AIRiskLevel = typeof AI_RISK_LEVELS[number];
export declare const AI_GOV_MODEL_CAPABILITIES: readonly ["TEXT_GENERATION", "CODE_GENERATION", "IMAGE_GENERATION", "AUDIO_GENERATION", "EMBEDDING", "REASONING", "TOOL_USE", "VISION"];
export type AIGovModelCapability = typeof AI_GOV_MODEL_CAPABILITIES[number];
export interface AIModelRecord extends Entity {
    modelId: string;
    organizationId?: string;
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
    evaluatedBy: string;
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
