import { test } from 'node:test';
import * as assert from 'node:assert';
import { ExecutionOrchestrator } from '../core/foundation/execution-chain.js';
import { AnalyticsTracker } from '../core/foundation/analytics-tracker.js';
import { DataQualityEngine } from '../core/foundation/data-quality.js';
import { KnowledgeEngine } from '../core/foundation/knowledge-engine.js';

test('ExecutionOrchestrator chains properly', () => {
  const orchestrator = new ExecutionOrchestrator();
  const obj = orchestrator.createObjective('proj1', 'Test Objective', ['Success1']);
  assert.ok(obj.id);
  
  const plan = orchestrator.createExecutionPlan(obj.id, ['Phase1']);
  assert.ok(plan.id);
  
  orchestrator.approveExecutionPlan(plan.id);
  
  const delivery = orchestrator.createDeliveryPlan(plan.id, ['Task1'], ['Agent1']);
  assert.ok(delivery.id);
  
  const changeSet = orchestrator.createChangeSet(delivery.id, ['file1.ts'], 'diff content');
  assert.ok(changeSet.id);
  
  const verification = orchestrator.createVerification(changeSet.id, true, 100);
  assert.ok(verification.id);
  
  const release = orchestrator.createReleaseRecord(verification.id, 'prod');
  assert.ok(release.id);
});

test('AnalyticsTracker works', () => {
  const tracker = new AnalyticsTracker();
  tracker.trackEvent('proj1', 'START', { foo: 'bar' });
  const events = tracker.getEventsByProject('proj1');
  assert.strictEqual(events.length, 1);
});

test('DataQualityEngine tracks properly', () => {
  const dq = new DataQualityEngine();
  const lineage = dq.recordLineage('dataset', 'ds1', 'source', 'src1');
  assert.ok(lineage.id);
  
  const check = dq.runQualityCheck('dataset', 'ds1', [], 100);
  assert.strictEqual(check.passed, true);
  
  const cost = dq.bindCost('proj1', 'res1', 10.5);
  assert.strictEqual(cost.costActual, 10.5);
});

test('KnowledgeEngine tracks staleness', () => {
  const engine = new KnowledgeEngine();
  engine.setContext('proj1', 'key1', { data: 1 }, 'sourceA', 1000);
  
  const ctx = engine.getContext('proj1', 'key1');
  assert.strictEqual(ctx?.value.data, 1);
  assert.strictEqual(engine.isStale('proj1', 'key1'), false);
});
