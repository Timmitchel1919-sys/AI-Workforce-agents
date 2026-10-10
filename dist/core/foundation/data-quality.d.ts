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
export declare class DataQualityEngine {
    private lineage;
    private qualityChecks;
    private costs;
    recordLineage(entityType: string, entityId: string, sourceType: string, sourceId: string, transformationId?: string): LineageRecord;
    runQualityCheck(entityType: string, entityId: string, violations: string[], score: number): DataQualityCheck;
    bindCost(projectId: string, resourceId: string, costActual: number, currency?: string): CostBinding;
}
