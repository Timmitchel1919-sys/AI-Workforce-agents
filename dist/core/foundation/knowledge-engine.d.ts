export interface KnowledgeContext {
    id: string;
    projectId: string;
    key: string;
    value: any;
    provenance: string;
    stalenessThresholdMs: number;
    lastUpdatedAt: Date;
}
export declare class KnowledgeEngine {
    private contexts;
    setContext(projectId: string, key: string, value: any, provenance: string, stalenessThresholdMs: number): KnowledgeContext;
    getContext(projectId: string, key: string): KnowledgeContext | null;
    isStale(projectId: string, key: string): boolean;
}
