import * as crypto from "crypto";

export interface KnowledgeContext {
  id: string;
  projectId: string;
  key: string;
  value: any;
  provenance: string;
  stalenessThresholdMs: number;
  lastUpdatedAt: Date;
}

export class KnowledgeEngine {
  private contexts = new Map<string, KnowledgeContext>();

  setContext(
    projectId: string,
    key: string,
    value: any,
    provenance: string,
    stalenessThresholdMs: number,
  ): KnowledgeContext {
    const id = crypto.randomUUID();
    const context: KnowledgeContext = {
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

  getContext(projectId: string, key: string): KnowledgeContext | null {
    const compositeKey = `${projectId}::${key}`;
    const context = this.contexts.get(compositeKey);

    if (!context) return null;

    return context;
  }

  isStale(projectId: string, key: string): boolean {
    const compositeKey = `${projectId}::${key}`;
    const context = this.contexts.get(compositeKey);
    if (!context) return true;

    const ageMs = Date.now() - context.lastUpdatedAt.getTime();
    return ageMs > context.stalenessThresholdMs;
  }
}
