import * as crypto from "crypto";
export class KnowledgeEngine {
    contexts = new Map();
    setContext(projectId, key, value, provenance, stalenessThresholdMs) {
        const id = crypto.randomUUID();
        const context = {
            id,
            projectId,
            key,
            value,
            provenance,
            stalenessThresholdMs,
            lastUpdatedAt: new Date(),
        };
        const compositeKey = `${projectId}::${key}`;
        this.contexts.set(compositeKey, context);
        return context;
    }
    getContext(projectId, key) {
        const compositeKey = `${projectId}::${key}`;
        const context = this.contexts.get(compositeKey);
        if (!context)
            return null;
        return context;
    }
    isStale(projectId, key) {
        const compositeKey = `${projectId}::${key}`;
        const context = this.contexts.get(compositeKey);
        if (!context)
            return true;
        const ageMs = Date.now() - context.lastUpdatedAt.getTime();
        return ageMs > context.stalenessThresholdMs;
    }
}
