/**
 * Knowledge, Memory & Context Intelligence — contracts.
 *
 * DATA, KNOWLEDGE, MEMORY, CONTEXT and EXECUTION HISTORY are separate things:
 * memory records carry a TYPE, provenance, confidence and lifecycle; context is
 * assembled per request from memory and never stored as memory itself.
 * Private single-user platform: no tenancy, only project isolation.
 */
import type { Entity } from "./persistence.js";
export declare const MEMORY_TYPES: readonly ["SYSTEM", "PROJECT", "ARCHITECTURAL", "USER_PREFERENCE", "EXECUTION", "AGENT", "DOCUMENT"];
export type MemoryType = (typeof MEMORY_TYPES)[number];
export declare const MEMORY_STATUSES: readonly ["DRAFT", "ACTIVE", "SUPERSEDED", "ARCHIVED", "REVOKED"];
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export declare const MEMORY_CONFIDENCE: readonly ["VERIFIED", "USER_CONFIRMED", "SYSTEM_GENERATED", "AGENT_GENERATED", "INFERRED", "UNVERIFIED"];
export type MemoryConfidence = (typeof MEMORY_CONFIDENCE)[number];
export declare const MEMORY_IMPORTANCE: readonly ["LOW", "NORMAL", "HIGH", "CRITICAL"];
export type MemoryImportance = (typeof MEMORY_IMPORTANCE)[number];
export declare const MEMORY_SOURCES: readonly ["USER", "PROJECT_FILE", "GITHUB", "EXECUTION", "AGENT", "DOCUMENT", "SYSTEM", "EXTERNAL_RESEARCH"];
export type MemorySource = (typeof MEMORY_SOURCES)[number];
export declare const RELATION_TYPES: readonly ["DEPENDS_ON", "USES", "BELONGS_TO", "RELATED_TO", "SUPERSEDES", "CONFLICTS_WITH", "DERIVED_FROM", "IMPLEMENTS", "AFFECTS", "REQUIRES"];
export type RelationType = (typeof RELATION_TYPES)[number];
export type MemoryRetention = "PERMANENT" | "TEMPORARY";
export type MemoryFreshness = "FRESH" | "POTENTIALLY_STALE";
export interface MemoryReference {
    kind: "file" | "document" | "execution" | "task" | "commit" | "memory" | "url";
    ref: string;
    note?: string;
}
/** Normalized memory record (`memories`). `id` === `memoryId`. */
export interface MemoryRecord extends Entity {
    memoryId: string;
    type: MemoryType;
    title: string;
    content: string;
    summary: string;
    /** Undefined = platform-wide (SYSTEM memory only). */
    projectId?: string;
    source: MemorySource;
    /** Where exactly (file path, execution id, URL) — answers "where did this come from?". */
    sourceRef?: string;
    /** Hash of the source content at ingestion (stale detection). */
    sourceHash?: string;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
    confidence: MemoryConfidence;
    importance: MemoryImportance;
    status: MemoryStatus;
    version: number;
    tags: string[];
    references: MemoryReference[];
    retention: MemoryRetention;
    expiresAt?: string;
    freshness: MemoryFreshness;
    supersedes?: string;
    supersededBy?: string;
    /** Closed-vocabulary facts extracted from the text (conflict detection). */
    facets: Record<string, string>;
    /** Hash of the normalized content (duplicate detection). */
    contentHash: string;
    /** Only for AGENT memory: the owning agent. */
    agentId?: string;
    reinforced: number;
    lastReinforcedAt?: string;
    statusReason?: string;
}
/** An immutable snapshot of a previous version (`memory_versions`). */
export interface MemoryVersionRecord extends Entity {
    memoryId: string;
    version: number;
    at: string;
    by: string;
    change: string;
    snapshot: Pick<MemoryRecord, "title" | "content" | "summary" | "status" | "confidence" | "importance" | "tags" | "references">;
}
/** A named thing in the project graph (`knowledge_entities`). */
export interface KnowledgeEntity extends Entity {
    projectId?: string;
    label: string;
    kind: "PROJECT" | "TECHNOLOGY" | "COMPONENT" | "AREA" | "INTEGRATION" | "MEMORY" | "OTHER";
    createdAt: string;
}
export interface KnowledgeEdge extends Entity {
    projectId?: string;
    from: string;
    to: string;
    type: RelationType;
    createdAt: string;
    createdBy: string;
    source: MemorySource;
}
export type UsageResult = "PENDING" | "TASK_SUCCEEDED" | "TASK_FAILED";
/** "This agent used this memory for this task" (`memory_usage`). */
export interface MemoryUsageRecord extends Entity {
    memoryId: string;
    projectId: string;
    taskId: string;
    agentId: string;
    executionId?: string;
    reason: string;
    result: UsageResult;
    confidenceAtUse: MemoryConfidence;
    at: string;
}
export interface ConflictResolutionRecord extends Entity {
    /** Sorted pair of memory ids. */
    conflictId: string;
    projectId: string;
    resolution: "SUPERSEDED_OTHER" | "KEPT_BOTH" | "ARCHIVED_OTHER";
    winner?: string;
    by: string;
    at: string;
    note?: string;
}
/** What a source looked like when it was last ingested (`knowledge_sources`). */
export interface KnowledgeSourceState extends Entity {
    projectId: string;
    ref: string;
    hash: string;
    ingestedAt: string;
    memoryIds: string[];
}
export interface KnowledgeConflict {
    conflictId: string;
    projectId: string;
    facet: string;
    memoryIds: [string, string];
    values: [string, string];
    titles: [string, string];
    /** Advice only. The system never silently picks a side. */
    suggestion: string;
}
export interface RetrievalSignals {
    keyword: number;
    semantic: number;
    project: number;
    task: number;
    agent: number;
    importance: number;
    confidence: number;
    recency: number;
    relationship: number;
}
export interface RetrievalHit {
    memory: MemoryRecord;
    score: number;
    signals: RetrievalSignals;
    /** WHY it was retrieved, in plain words. */
    reasons: string[];
    conflictWith: string[];
    stale: boolean;
}
export interface ContextPackageItem {
    memoryId: string;
    section: ContextSectionName;
    title: string;
    text: string;
    citation: string;
    why: string;
    confidence: MemoryConfidence;
    importance: MemoryImportance;
    stale: boolean;
    conflict: boolean;
    score: number;
}
export declare const CONTEXT_SECTIONS: readonly ["currentTask", "projectContext", "architecture", "decisions", "files", "previousAttempts", "constraints", "security", "acceptance"];
export type ContextSectionName = (typeof CONTEXT_SECTIONS)[number];
export interface ContextPackage {
    projectId: string;
    taskId?: string;
    status: "OK" | "KNOWLEDGE_CONFLICT_DETECTED";
    sections: Record<ContextSectionName, string[]>;
    items: ContextPackageItem[];
    conflicts: KnowledgeConflict[];
    excluded: {
        memoryId: string;
        reason: "over_budget" | "not_relevant" | "not_authorized";
    }[];
    budget: {
        limitChars: number;
        usedChars: number;
    };
    /** Ready to hand to the Prompt Engineer. Secret-masked. */
    rendered: string;
    assembledAt: string;
}
export interface KnowledgeHealth {
    projectId?: string;
    total: number;
    byStatus: Record<MemoryStatus, number>;
    byType: Record<MemoryType, number>;
    potentiallyStale: number;
    conflicts: number;
    unverified: number;
    drafts: number;
    expiringSoon: number;
    documents: number;
    edges: number;
    generatedAt: string;
}
export interface KnowledgeAuditFinding {
    findingId: string;
    ruleId: "knowledge.suspicious_creation" | "knowledge.unauthorized_retrieval" | "knowledge.excessive_retrieval" | "knowledge.conflicting_memory" | "knowledge.low_confidence_usage" | "knowledge.unusual_modification";
    severity: "low" | "medium" | "high";
    subjectId: string;
    projectId?: string;
    detail: string;
}
export declare const KNOWLEDGE_COMMANDS: readonly ["knowledge_create_memory", "knowledge_update_memory", "knowledge_confirm_memory", "knowledge_archive_memory", "knowledge_restore_memory", "knowledge_supersede_memory", "knowledge_revoke_memory", "knowledge_delete_memory", "knowledge_link", "knowledge_resolve_conflict", "knowledge_ingest_document", "knowledge_discover_project", "knowledge_refresh_project", "knowledge_apply_retention"];
export type KnowledgeCommand = (typeof KNOWLEDGE_COMMANDS)[number];
export declare const KNOWLEDGE_LIMITS: Readonly<{
    maxContent: 8000;
    maxTitle: 160;
    maxTags: 12;
    maxSearchResults: 50;
    maxDocumentBytes: 200000;
    chunkChars: 1200;
    defaultBudgetChars: 6000;
    maxItemChars: 700;
}>;
