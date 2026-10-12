import type { AuditLog, Repository } from "../index.js";
import { type ConflictResolutionRecord, type KnowledgeConflict, type KnowledgeEdge, type KnowledgeEntity, type KnowledgeSourceState, type MemoryRecord, type MemoryUsageRecord, type MemoryVersionRecord, type RelationType } from "../../contracts/knowledge-memory.js";
import { type Actor, type MemoryProposal } from "./write-policy.js";
export interface KnowledgeRepos {
    memories: Repository<MemoryRecord>;
    versions: Repository<MemoryVersionRecord>;
    entities: Repository<KnowledgeEntity>;
    edges: Repository<KnowledgeEdge>;
    usage: Repository<MemoryUsageRecord>;
    resolutions: Repository<ConflictResolutionRecord>;
    sources: Repository<KnowledgeSourceState>;
}
/**
 * Write-through cache: the durable repository stays the source of truth, but
 * reads come from memory without defensive copies. Records are treated as
 * immutable by every caller (updates always build a new object).
 */
export declare class SyncCache<T extends {
    id: string;
}> implements Repository<T> {
    private readonly inner;
    private readonly items;
    constructor(inner: Repository<T>);
    upsert(entity: T): void;
    findById(id: string): T | undefined;
    list(): T[];
    delete(id: string): boolean;
    clear(): void;
}
export type MemoryChange = {
    kind: "upsert";
    memory: MemoryRecord;
} | {
    kind: "remove";
    id: string;
} | {
    kind: "graph";
};
export interface CreateResult {
    memory: MemoryRecord;
    outcome: "CREATED" | "REINFORCED";
    decision: string;
}
export declare class MemoryService {
    private readonly audit;
    private readonly clock;
    private readonly listeners;
    private readonly announced;
    private readonly suppress;
    /** Bumped on every change; retrieval caches key on it. */
    version: number;
    /** Cached view over the durable repositories (reads never clone). */
    readonly repos: KnowledgeRepos;
    private readonly tokenCache;
    constructor(repos: KnowledgeRepos, audit: AuditLog, clock?: () => number);
    subscribe(listener: (change: MemoryChange) => void): () => void;
    private notify;
    private iso;
    record(operation: string, actor: Actor | string, fields: {
        projectId?: string | undefined;
        memoryId?: string | undefined;
        source?: string | undefined;
        result?: string;
        detail?: Record<string, unknown>;
    }): void;
    get(memoryId: string): MemoryRecord | undefined;
    require(memoryId: string): MemoryRecord;
    all(): MemoryRecord[];
    history(memoryId: string): MemoryVersionRecord[];
    create(proposal: MemoryProposal, actor: Actor): CreateResult;
    private findDuplicate;
    private tokensOf;
    private reinforce;
    private snapshot;
    private afterActivation;
    /** LINK: a memory is attached to its project entity in the graph. */
    private ensureProjectLinks;
    update(memoryId: string, patch: {
        title?: string;
        content?: string;
        tags?: string[];
        importance?: MemoryRecord["importance"];
    }, actor: Actor, reason?: string): MemoryRecord;
    /** The user confirms a candidate: DRAFT → ACTIVE, USER_CONFIRMED. */
    confirm(memoryId: string, actor: Actor): MemoryRecord;
    archive(memoryId: string, actor: Actor, reason?: string): MemoryRecord;
    restore(memoryId: string, actor: Actor): MemoryRecord;
    revoke(memoryId: string, actor: Actor, reason?: string): MemoryRecord;
    /**
     * Replace a decision by a new one. The old record is kept as SUPERSEDED and the
     * two are linked both ways (`supersedes` / `supersededBy` + a SUPERSEDES edge).
     */
    supersede(oldId: string, proposal: MemoryProposal, actor: Actor): {
        old: MemoryRecord;
        created: MemoryRecord;
    };
    remove(memoryId: string, actor: Actor): void;
    private assertWritable;
    private transition;
    markStale(memoryId: string, reason: string, actor?: Actor | string): MemoryRecord | undefined;
    /** Re-validate: the memory is checked by a human and is fresh again. */
    validateFresh(memoryId: string, actor: Actor): MemoryRecord;
    /** Expire TEMPORARY memories. Permanent decisions are never touched; audit is never deleted. */
    applyRetention(actor?: Actor | string): {
        archived: string[];
    };
    entity(projectId: string | undefined, label: string, kind: KnowledgeEntity["kind"]): KnowledgeEntity;
    link(from: string, to: string, type: RelationType, by: string, source?: KnowledgeEdge["source"], projectId?: string): KnowledgeEdge;
    private resolved;
    conflictsFor(memory: MemoryRecord): KnowledgeConflict[];
    private conflictEdgeCache;
    private conflictEdges;
    listConflicts(projectId?: string): KnowledgeConflict[];
    private suggest;
    resolveConflict(conflictId: string, resolution: ConflictResolutionRecord["resolution"], actor: Actor, winner?: string, note?: string): ConflictResolutionRecord;
}
