import test from "node:test";
import assert from "node:assert";
import { DefaultPredictiveEngine } from "../../core/predictive/engine.js";

test("Predictive Intelligence Engine", async (t) => {
  const engine = new DefaultPredictiveEngine();

  await t.test("verifyPriorLayers returns true", async () => {
    const result = await engine.verifyPriorLayers();
    assert.strictEqual(result, true);
  });

  await t.test("runForecasting generates forecast", async () => {
    const forecast = await engine.runForecasting("sales", 10);
    assert.strictEqual(forecast.metric, "sales");
    assert.strictEqual(forecast.horizon, 10);
    assert.strictEqual(forecast.predictedValues.length, 10);
  });

  await t.test("detectAnomalies returns anomalies", async () => {
    const anomalies = await engine.detectAnomalies([]);
    assert.strictEqual(anomalies.length > 0, true);
    assert.strictEqual(anomalies[0].severity, "high");
  });

  await t.test("requestGovernanceApproval returns approval", async () => {
    const approval = await engine.requestGovernanceApproval("rec-123");
    assert.strictEqual(approval.recommendationId, "rec-123");
    assert.strictEqual(approval.status, "approved");
  });

  await t.test("Full lifecycle runs without errors", async () => {
    await assert.doesNotReject(engine.runFullLifecycle());
  });
});
