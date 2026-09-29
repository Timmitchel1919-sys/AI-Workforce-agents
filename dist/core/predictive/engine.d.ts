import { PredictiveIntelligenceEngine, PredictiveForecast, Anomaly, RiskEstimate, Scenario, Recommendation, OptimizationGoal, DriftReport, GovernanceApproval } from '../../contracts/predictive.js';
export declare class DefaultPredictiveEngine implements PredictiveIntelligenceEngine {
    verifyPriorLayers(): Promise<boolean>;
    checkDataReadiness(): Promise<boolean>;
    buildDecisionDomainModel(): Promise<void>;
    configureFeatureArchitecture(): Promise<void>;
    establishBaselines(): Promise<void>;
    setupEvaluationFramework(): Promise<void>;
    runForecasting(metric: string, horizon: number): Promise<PredictiveForecast>;
    detectAnomalies(dataStream: any[]): Promise<Anomaly[]>;
    estimateRisk(component: string): Promise<RiskEstimate>;
    simulateScenario(scenario: Scenario): Promise<any>;
    generateRecommendations(): Promise<Recommendation[]>;
    optimizeResources(goal: OptimizationGoal): Promise<any>;
    runDecisionEngine(): Promise<void>;
    detectDrift(modelId: string): Promise<DriftReport>;
    requestGovernanceApproval(recommendationId: string): Promise<GovernanceApproval>;
    runFullLifecycle(): Promise<void>;
}
