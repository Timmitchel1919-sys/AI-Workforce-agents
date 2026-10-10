export interface PredictiveForecast {
    id: string;
    metric: string;
    horizon: number;
    confidenceInterval: [number, number];
    predictedValues: number[];
    timestamp: Date;
}
export interface Anomaly {
    id: string;
    metric: string;
    severity: "low" | "medium" | "high" | "critical";
    detectedAt: Date;
    context: Record<string, unknown>;
    expectedRange: [number, number];
    actualValue: number;
}
export interface RiskEstimate {
    id: string;
    component: string;
    probability: number;
    impact: number;
    score: number;
    factors: string[];
}
export interface Scenario {
    id: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    expectedOutcomes: Record<string, unknown>;
}
export interface Recommendation {
    id: string;
    action: string;
    rationale: string;
    confidence: number;
    impactEstimate: Record<string, unknown>;
    status: "pending" | "approved" | "rejected" | "implemented";
}
export interface OptimizationGoal {
    id: string;
    targetMetric: string;
    constraints: Record<string, unknown>;
    currentValue: number;
    targetValue: number;
}
export interface DriftReport {
    id: string;
    modelId: string;
    driftScore: number;
    detectedAt: Date;
    features: string[];
    requiresRetraining: boolean;
}
export interface GovernanceApproval {
    id: string;
    recommendationId: string;
    approvedBy: string;
    approvedAt: Date;
    comments: string;
    status: "approved" | "rejected";
}
export interface PredictiveIntelligenceEngine {
    verifyPriorLayers(): Promise<boolean>;
    checkDataReadiness(): Promise<boolean>;
    runForecasting(metric: string, horizon: number): Promise<PredictiveForecast>;
    detectAnomalies(dataStream: readonly unknown[]): Promise<Anomaly[]>;
    estimateRisk(component: string): Promise<RiskEstimate>;
    simulateScenario(scenario: Scenario): Promise<unknown>;
    generateRecommendations(): Promise<Recommendation[]>;
    optimizeResources(goal: OptimizationGoal): Promise<unknown>;
    detectDrift(modelId: string): Promise<DriftReport>;
    requestGovernanceApproval(recommendationId: string): Promise<GovernanceApproval>;
}
