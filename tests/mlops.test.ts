import { test, assert } from "vitest";
import { MLOpsEngine } from "../core/mlops/index.js";

test("MLOps: Model Registration, Deployment, and Drift Detection", () => {
  const engine = new MLOpsEngine();
  
  // Register Model
  const model = engine.registerModel("org_1", "ChurnPredictor", "v1.0", "PYTORCH");
  assert.equal(model.status, "EVALUATING");
  
  // Update status to READY
  engine.updateModelStatus(model.modelId, "READY", { accuracy: 0.95 });
  const updatedModel = engine.getModels("org_1")[0];
  assert.equal(updatedModel.status, "READY");
  assert.equal(updatedModel.metrics.accuracy, 0.95);

  // Deploy
  const deployment = engine.deployModel("org_1", model.modelId, "PRODUCTION", 3);
  assert.equal(deployment.status, "HEALTHY");
  assert.equal(deployment.replicaCount, 3);
  assert.isTrue(deployment.endpointUrl.includes("ChurnPredictor-production"));

  // Drift below threshold (9%)
  engine.evaluateDrift(deployment.deploymentId, "prediction_latency", 100, 109);
  assert.equal(engine.getAlerts(deployment.deploymentId).length, 0);

  // Drift above HIGH threshold but below CRITICAL (15%)
  engine.evaluateDrift(deployment.deploymentId, "accuracy", 0.95, 0.80);
  const alerts = engine.getAlerts(deployment.deploymentId);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, "HIGH");
  assert.equal(engine.getDeployments("org_1")[0].status, "HEALTHY"); // Still healthy

  // Drift above CRITICAL threshold (30%)
  engine.evaluateDrift(deployment.deploymentId, "data_drift_score", 0.1, 0.15);
  const criticalAlerts = engine.getAlerts(deployment.deploymentId).filter(a => a.severity === "CRITICAL");
  assert.equal(criticalAlerts.length, 1);
  assert.equal(engine.getDeployments("org_1")[0].status, "DEGRADED"); // Degraded
});
