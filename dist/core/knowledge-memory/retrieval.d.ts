/**
 * Knowledge index + hybrid retrieval engine.
 *
 * Signals (never a single score): keyword (BM25 with synonym expansion),
 * lexical-semantic (character-trigram cosine — a real embedding provider can be
 * plugged in behind `SemanticScorer`), project, task/tag match, agent-role fit,
 * importance, confidence, recency, and relationship distance in the project
 * graph. Authorization is enforced HERE, independent of any UI.
 */
import { type MemoryConfidence, type MemoryImportance, type MemoryRecord, type MemorySource, type MemoryStatus, type MemoryType, type MemoryUsageRecord, type RetrievalHit, type UsageResult } from "../../contracts/knowledge-memory.js";
import type { MemoryService } from "./memory-service.js";
export interface RetrievalScope {
    /** Projects the caller may read, or "*" for all (administrator/operator with full access). */
    projectIds: readonly string[] | "*";
    /** Present for agent callers: narrows what they may see. */
    agent?: {
        id: string;
        role: string;
    };
    actor: string;
}
export interface RetrievalQuery {
    text: string;
    projectId?: string;
    limit?: number;
    statuses?: readonly MemoryStatus[];
    types?: readonly MemoryType[];
    sources?: readonly MemorySource[];
    confidences?: readonly MemoryConfidence[];
    importances?: readonly MemoryImportance[];
    since?: string;
    /** Extra tag hints from the task (e.g. "security"). */
    taskTags?: readonly string[];
    /** Skip the relevance gate (used for browsing/filtering in the UI). */
    browse?: boolean;
}
/** Optional plug-in point for a real embedding model (not configured by default). */
export interface SemanticScorer {
    readonly id: string;
    score(query: string, memory: MemoryRecord): number;
}
interface Doc {
    tf: Map<string, number>;
    len: number;
    tri: Map<string, number>;
    tags: Set<string>;
    groups: Set<number>;
}
export declare class KnowledgeIndex {
    private readonly docs;
    private readonly df;
    private totalLen;
    constructor(memory: MemoryService);
    get size(): number;
    private remove;
    upsert(m: MemoryRecord): void;
    bm25(id: string, query: ReadonlyMap<string, number>): {
        score: number;
        matched: string[];
    };
    doc(id: string): Doc | undefined;
}
export interface RetrievalLogEntry {
    at: number;
    actor: string;
    projectId?: string;
    count: number;
    denied: boolean;
}
export declare class RetrievalEngine {
    private readonly memory;
    readonly index: KnowledgeIndex;
    private readonly clock;
    private readonly scorer?;
    private readonly cache;
    readonly log: RetrievalLogEntry[];
    constructor(memory: MemoryService, index: KnowledgeIndex, clock?: () => number, scorer?: SemanticScorer | undefined);
    /** Authorization check shared by search and the assembler. */
    authorize(scope: RetrievalScope, projectId: string | undefined): void;
    private deny;
    private visible;
    search(query: RetrievalQuery, scope: RetrievalScope): RetrievalHit[];
    private compute;
    /** Hop distance from query-mentioned entities to each node (≤ 2 hops, undirected). */
    private graphDistances;
    recordUsage(input: Omit<MemoryUsageRecord, "id" | "at" | "result" | "confidenceAtUse">): void;
    recordOutcome(taskId: string, result: Exclude<UsageResult, "PENDING">, executionId?: string): number;
    usageFor(memoryId: string): MemoryUsageRecord[];
}
export {};
