import * as crypto from "crypto";
export class DataQualityEngine {
    lineage = new Map();
    qualityChecks = new Map();
    costs = new Map();
    recordLineage(entityType, entityId, sourceType, sourceId, transformationId) {
        const record = {
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
        this.lineage.get(entityId).push(record);
        return record;
    }
    runQualityCheck(entityType, entityId, violations, score) {
        const check = {
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
        this.qualityChecks.get(entityId).push(check);
        return check;
    }
    bindCost(projectId, resourceId, costActual, currency = "USD") {
        const binding = {
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
        this.costs.get(projectId).push(binding);
        return binding;
    }
}
