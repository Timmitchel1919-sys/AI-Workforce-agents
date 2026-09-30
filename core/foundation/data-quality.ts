import * as crypto from 'crypto';

export interface LineageRecord {
  id: string;
  entityType: string;
  entityId: string;
  sourceType: string;
  sourceId: string;
  transformationId?: string;
  timestamp: Date;
}

export interface DataQualityCheck {
  id: string;
  entityType: string;
  entityId: string;
  passed: boolean;
  score: number;
  violations: string[];
  checkedAt: Date;
}

export interface CostBinding {
  id: string;
  projectId: string;
  resourceId: string;
  costActual: number;
  currency: string;
  timestamp: Date;
}

export class DataQualityEngine {
  private lineage = new Map<string, LineageRecord[]>();
  private qualityChecks = new Map<string, DataQualityCheck[]>();
  private costs = new Map<string, CostBinding[]>();

  recordLineage(entityType: string, entityId: string, sourceType: string, sourceId: string, transformationId?: string): LineageRecord {
    const record: LineageRecord = {
      id: crypto.randomUUID(),
      entityType,
      entityId,
      sourceType,
      sourceId,
      transformationId,
      timestamp: new Date(),
    };
    
    if (!this.lineage.has(entityId)) {
      this.lineage.set(entityId, []);
    }
    this.lineage.get(entityId)!.push(record);
    
    return record;
  }

  runQualityCheck(entityType: string, entityId: string, violations: string[], score: number): DataQualityCheck {
    const check: DataQualityCheck = {
      id: crypto.randomUUID(),
      entityType,
      entityId,
      passed: violations.length === 0,
      score,
      violations,
      checkedAt: new Date(),
    };

    if (!this.qualityChecks.has(entityId)) {
      this.qualityChecks.set(entityId, []);
    }
    this.qualityChecks.get(entityId)!.push(check);

    return check;
  }

  bindCost(projectId: string, resourceId: string, costActual: number, currency: string = 'USD'): CostBinding {
    const binding: CostBinding = {
      id: crypto.randomUUID(),
      projectId,
      resourceId,
      costActual,
      currency,
      timestamp: new Date(),
    };

    if (!this.costs.has(projectId)) {
      this.costs.set(projectId, []);
    }
    this.costs.get(projectId)!.push(binding);

    return binding;
  }
}
