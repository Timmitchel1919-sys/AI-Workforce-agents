import { ModelRegistryEntry, ModelDeployment, ModelDriftAlert } from "../../contracts/mlops.js";
export declare class MLOpsEngine {
    private models;
    private deployments;
    private alerts;
    registerModel(organizationId: string, name: string, version: string, framework: ModelRegistryEntry["framework"]): ModelRegistryEntry;
    updateModelStatus(modelId: string, status: ModelRegistryEntry["status"], metrics?: Record<string, number>): void;
    deployModel(organizationId: string, modelId: string, environment: "STAGING" | "PRODUCTION", replicaCount: number): ModelDeployment;
    evaluateDrift(deploymentId: string, metric: string, baselineValue: number, currentValue: number): void;
    getModels(organizationId: string): ModelRegistryEntry[];
    getDeployments(organizationId: string): ModelDeployment[];
    getAlerts(deploymentId: string): ModelDriftAlert[];
}
