import { ModelRegistryEntry, ModelDeployment, ModelDriftAlert } from "../../contracts/mlops.js";

export class MLOpsEngine {
  private models = new Map<string, ModelRegistryEntry>();
  private deployments = new Map<string, ModelDeployment>();
  private alerts = new Map<string, ModelDriftAlert>();

  registerModel(organizationId: string, name: string, version: string, framework: ModelRegistryEntry["framework"]): ModelRegistryEntry {
    const model: ModelRegistryEntry = {
      modelId: `mod_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      organizationId,
      name,
      version,
      framework,
      status: "EVALUATING",
      metrics: {},
      createdAt: new Date()
    };
    this.models.set(model.modelId, model);
    return model;
  }

  updateModelStatus(modelId: string, status: ModelRegistryEntry["status"], metrics?: Record<string, number>) {
    const model = this.models.get(modelId);
    if (!model) throw new Error("Model not found");
    model.status = status;
    if (metrics) {
      model.metrics = { ...model.metrics, ...metrics };
    }
  }

  deployModel(organizationId: string, modelId: string, environment: "STAGING" | "PRODUCTION", replicaCount: number): ModelDeployment {
    const model = this.models.get(modelId);
    if (!model || model.status !== "READY") {
      throw new Error("Model not ready for deployment");
    }

    const deployment: ModelDeployment = {
      deploymentId: `dep_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      organizationId,
      modelId,
      environment,
      endpointUrl: `https://models.internal.ai/${model.name}-${environment.toLowerCase()}`,
      replicaCount,
      status: "HEALTHY",
      lastUpdated: new Date()
    };
    this.deployments.set(deployment.deploymentId, deployment);
    return deployment;
  }

  evaluateDrift(deploymentId: string, metric: string, baselineValue: number, currentValue: number) {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) return;

    const deviation = Math.abs((currentValue - baselineValue) / baselineValue) * 100;
    
    if (deviation > 10) { // 10% drift threshold
      const alert: ModelDriftAlert = {
        alertId: `alt_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        deploymentId,
        metric,
        baselineValue,
        currentValue,
        deviationPercentage: deviation,
        severity: deviation > 25 ? "CRITICAL" : "HIGH",
        detectedAt: new Date()
      };
      this.alerts.set(alert.alertId, alert);
      
      if (alert.severity === "CRITICAL") {
        deployment.status = "DEGRADED";
      }
    }
  }

  getModels(organizationId: string): ModelRegistryEntry[] {
    return Array.from(this.models.values()).filter(m => m.organizationId === organizationId);
  }

  getDeployments(organizationId: string): ModelDeployment[] {
    return Array.from(this.deployments.values()).filter(d => d.organizationId === organizationId);
  }

  getAlerts(deploymentId: string): ModelDriftAlert[] {
    return Array.from(this.alerts.values()).filter(a => a.deploymentId === deploymentId);
  }
}
