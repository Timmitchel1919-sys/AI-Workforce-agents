import { type ExecutionRecordStore } from "../../contracts/index.js";
export declare const KNOWLEDGE_KINDS: readonly ["architecture_decision", "documentation", "specification", "research", "procedure", "lesson_learned", "note"];
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];
export declare const MAX_KNOWLEDGE_BYTES: number;
export interface KnowledgeDocument {
    documentId: string;
    projectId: string;
    title: string;
    kind: KnowledgeKind;
    tags: string[];
    status: "active" | "archived";
    /** Where the content came from (free text, e.g. "upload: notes.md"). */
    source: string;
    latestVersion: number;
    contentHash: string;
    bytes: number;
    createdAt: string;
    createdBy: string;
    updatedAt: string;
    updatedBy: string;
}
export interface KnowledgeVersion {
    documentId: string;
    projectId: string;
    version: number;
    content: string;
    contentHash: string;
    createdAt: string;
    createdBy: string;
}
export interface KnowledgeSearchHit {
    documentId: string;
    title: string;
    kind: KnowledgeKind;
    score: number;
    snippet: string;
    version: number;
}
export declare class KnowledgeDocumentService {
    private readonly store;
    private readonly clock;
    private readonly newId;
    constructor(store: ExecutionRecordStore, clock?: () => number, newId?: () => string);
    private iso;
    list(projectId: string): Promise<KnowledgeDocument[]>;
    get(projectId: string, documentId: string): Promise<{
        document: KnowledgeDocument;
        content: string | null;
    } | undefined>;
    versions(projectId: string, documentId: string): Promise<Omit<KnowledgeVersion, "content">[]>;
    /** Create a document, or add a new immutable version to an existing one. */
    save(input: {
        projectId: string;
        documentId?: unknown;
        title: unknown;
        kind: unknown;
        tags?: unknown;
        source?: unknown;
        content: unknown;
    }, actor: string): Promise<KnowledgeDocument>;
    archive(projectId: string, documentId: unknown, actor: string): Promise<KnowledgeDocument>;
    /**
     * Keyword search within ONE project: all query terms must appear (title or
     * body); score = term frequency, title hits weighted x3. Archived excluded.
     */
    search(projectId: string, query: string, limit?: number): Promise<KnowledgeSearchHit[]>;
}
