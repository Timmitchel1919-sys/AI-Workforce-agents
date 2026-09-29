import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { AnalyticsIngestion } from '../../core/analytics/AnalyticsIngestion.js';
import { DataQualityEngine } from '../../core/analytics/DataQualityEngine.js';
import { AnalyticsDomains } from '../../core/analytics/DomainModel.js';

describe('Analytics Layer', () => {
  it('should validate and ingest a valid analytics event', async () => {
    const ingestion = new AnalyticsIngestion();
    const quality = new DataQualityEngine();

    const event = {
      eventId: 'evt_12345',
      timestamp: new Date().toISOString(),
      source: 'test_runner',
      eventType: 'SYSTEM_START',
      domain: AnalyticsDomains.EXECUTION,
      payload: { status: 'ok' }
    };

    const isValid = quality.validate(event);
    assert.strictEqual(isValid, true, 'Event should be valid');

    const isIngested = await ingestion.ingestEvent(event);
    assert.strictEqual(isIngested, true, 'Event should be successfully ingested');
  });

  it('should fail validation for invalid event', () => {
    const quality = new DataQualityEngine();
    const event = {
      eventId: '', // invalid
      timestamp: new Date().toISOString(),
      source: 'test_runner',
      eventType: '', // invalid
      payload: {}
    };

    const isValid = quality.validate(event);
    assert.strictEqual(isValid, false, 'Event should fail validation due to missing fields');
  });
});
