export interface KnowledgeRecord {
    id: string;
    domain: string;
    content: string;
    metadata: Record<string, unknown>;
    provenance: {
        source: string;
        timestamp: number;
        author: string;
    };
}
export declare class KnowledgeEngine {
    private records;
    ingest(domain: string, content: string, source: string, author: string): KnowledgeRecord;
    search(query: string, domain?: string): KnowledgeRecord[];
    getContext(query: string): string;
}
