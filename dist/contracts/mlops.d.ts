export interface ModelRegistryEntry {
    modelId: string;
    organizationId: string;
    name: string;
    version: string;
    framework: "TENSORFLOW" | "PYTORCH" | "ONNX" | "LLM_PROMPT";
    status: "TRAINING" | "EVALUATING" | "READY" | "DEPRECATED";
    metrics: Record<string, number>;
    createdAt: Date;
}
export interface ModelDeployment {
    deploymentId: string;
    organizationId: string;
    modelId: string;
    environment: "STAGING" | "PRODUCTION";
    endpointUrl: string;
    replicaCount: number;
    status: "DEPLOYING" | "HEALTHY" | "DEGRADED" | "FAILED";
    lastUpdated: Date;
}
export interface ModelDriftAlert {
    alertId: string;
    deploymentId: string;
    metric: string;
    baselineValue: number;
    currentValue: number;
    deviationPercentage: number;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    detectedAt: Date;
}
