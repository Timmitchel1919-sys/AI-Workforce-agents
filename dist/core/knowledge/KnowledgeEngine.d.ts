export interface KnowledgeSource {
    id: string;
    content: string;
    metadata: Record<string, any>;
}
export interface NormalizedData {
    sourceId: string;
    text: string;
}
export interface Chunk {
    id: string;
    content: string;
    embedding: number[];
}
export declare class KnowledgeEngine {
    constructor();
    preflight(): Promise<void>;
    verify(): Promise<void>;
    knowledgeArchitectureAudit(): Promise<void>;
    knowledgeContracts(): Promise<void>;
    projectKnowledgeStore(): Promise<void>;
    sourceIngestion(sources: KnowledgeSource[]): Promise<void>;
    normalization(source: KnowledgeSource): Promise<NormalizedData>;
    chunkingAndIndexing(data: NormalizedData): Promise<Chunk[]>;
    retrieval(query: string): Promise<Chunk[]>;
    contextAssembly(): Promise<void>;
    manageMemory(): Promise<void>;
    knowledgeGraph(): Promise<void>;
    provenance(): Promise<void>;
    permissions(): Promise<void>;
    governance(): Promise<void>;
    contextBudgeting(): Promise<void>;
    controlCenter(): Promise<void>;
    spatialIntegration(): Promise<void>;
}
