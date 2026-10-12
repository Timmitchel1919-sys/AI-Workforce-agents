import type { Entity } from "./persistence.js";
/**
 * AI Workforce OS — Layer 14: Knowledge Learning & Organizational Memory Contracts
 *
 * Extends the knowledge module to distinguish between:
 * - facts, decisions, lessons, patterns, procedures, solutions, incidents, ADRs
 * - explicit provenance tracking (where information came from)
 * - confidence levels (verified, high, medium, low, unverified, conflicting)
 * - scoped retrieval & project isolation (global, project, workflow, agent, task)
 * - knowledge lifecycle (created -> validated -> active -> updated -> superseded -> archived)
 * - conflict detection and resolution
 * - quality analysis (stale, low-confidence, duplicate, unverified)
 */
export declare const KNOWLEDGE_ITEM_TYPES: readonly ["fact", "decision", "lesson", "pattern", "procedure", "solution", "incident", "architecture_decision", "prompt_pattern", "workflow_pattern", "agent_pattern", "tool_pattern", "project_knowledge", "technical_documentation", "architecture", "requirement", "note"];
export type KnowledgeItemType = (typeof KNOWLEDGE_ITEM_TYPES)[number];
export declare const KNOWLEDGE_CATEGORIES: readonly ["fact", "decision", "lesson", "pattern", "procedure", "solution", "incident", "architecture_decision", "prompt_pattern", "workflow_pattern", "agent_pattern", "tool_pattern", "project_knowledge", "technical_documentation", "architecture", "requirement", "note"];
export declare const KNOWLEDGE_CONFIDENCE_LEVELS: readonly ["verified", "high_confidence", "medium_confidence", "low_confidence", "unverified", "conflicting"];
export type KnowledgeConfidence = (typeof KNOWLEDGE_CONFIDENCE_LEVELS)[number];
export declare const KNOWLEDGE_PROVENANCE_SOURCES: readonly ["user_input", "project_document", "github", "workflow_result", "agent_output", "tool_result", "meeting_transcript", "approved_decision", "external_research", "system_observation"];
export type KnowledgeProvenanceSource = (typeof KNOWLEDGE_PROVENANCE_SOURCES)[number];
export declare const KNOWLEDGE_SCOPES: readonly ["global", "project", "workflow", "agent", "task", "domain"];
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];
export declare const KNOWLEDGE_LIFECYCLE_STATES: readonly ["created", "validated", "active", "updated", "superseded", "archived"];
export type KnowledgeLifecycleState = (typeof KNOWLEDGE_LIFECYCLE_STATES)[number];
export declare const ADR_STATUSES: readonly ["proposed", "accepted", "superseded", "rejected"];
export type AdrStatus = (typeof ADR_STATUSES)[number];
export interface KnowledgeProvenance {
    sourceType: KnowledgeProvenanceSource;
    sourceUri?: string;
    extractedBy?: string;
    extractionContext?: Record<string, unknown>;
    verifiedBy?: string;
    verifiedAt?: string;
}
export interface ArchitectureDecisionRecord {
    decision: string;
    context: string;
    alternatives: readonly string[];
    rationale: string;
    consequences: readonly string[];
    status: AdrStatus;
    decidedAt?: string;
    decidedBy?: string;
    supersededByAdrId?: string;
}
export interface LessonLearned {
    whatHappened: string;
    why: string;
    whatWorked: string;
    whatFailed: string;
    whatShouldChange: string;
    whatShouldBeRepeated: string;
}
export interface KnowledgeItem extends Entity {
    knowledgeId: string;
    /** Omitted for system-wide knowledge not owned by a single project. */
    projectId?: string;
    type: KnowledgeItemType;
    title: string;
    /** Markdown-capable free text. Never carries a credential. */
    body: string;
    tags: string[];
    /** Where the knowledge came from (a doc path, a session, "manual", ...). */
    source?: string;
    /** Layer 14: Structured provenance metadata. */
    provenance?: KnowledgeProvenance;
    /** Layer 14: Verification confidence rating. */
    confidence: KnowledgeConfidence;
    /** Layer 14: Scope boundary. */
    scope: KnowledgeScope;
    /** Layer 14: Lifecycle status. */
    lifecycleState: KnowledgeLifecycleState;
    /** Layer 14: Schema versioning. */
    version: number;
    /** Layer 14: Associated entity IDs (task, agent, workflow, doc). */
    relatedEntityIds?: readonly string[];
    /** Layer 14: ADR details if type is architecture_decision. */
    adr?: ArchitectureDecisionRecord;
    /** Layer 14: Lesson learned details if type is lesson. */
    lesson?: LessonLearned;
    /** Layer 14: Conflict tracking IDs. */
    conflictingItemIds?: readonly string[];
    /** Layer 14: Successor knowledge ID if superseded. */
    supersededById?: string;
    /** Operator or agent id that created the item. */
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}
export interface CreateKnowledgeInput {
    projectId?: string;
    type: KnowledgeItemType;
    title: string;
    body: string;
    tags?: string[];
    source?: string;
    provenance?: KnowledgeProvenance;
    confidence?: KnowledgeConfidence;
    scope?: KnowledgeScope;
    relatedEntityIds?: string[];
    adr?: ArchitectureDecisionRecord;
    lesson?: LessonLearned;
}
export interface UpdateKnowledgeInput {
    type?: KnowledgeItemType;
    title?: string;
    body?: string;
    tags?: string[];
    source?: string;
    provenance?: KnowledgeProvenance;
    confidence?: KnowledgeConfidence;
    scope?: KnowledgeScope;
    lifecycleState?: KnowledgeLifecycleState;
    relatedEntityIds?: string[];
    adr?: ArchitectureDecisionRecord;
    lesson?: LessonLearned;
    supersededById?: string;
}
export interface KnowledgeQuery {
    projectId?: string;
    type?: KnowledgeItemType;
    scope?: KnowledgeScope;
    confidence?: KnowledgeConfidence;
    lifecycleState?: KnowledgeLifecycleState;
    /** Case-insensitive substring match over title, body and tags. */
    search?: string;
}
export interface KnowledgeItemConflict {
    conflictId: string;
    itemAId: string;
    itemBId: string;
    titleA: string;
    titleB: string;
    summary: string;
    detectedAt: string;
    status: "open" | "resolved" | "dismissed";
    resolutionNotes?: string;
    resolvedBy?: string;
    resolvedAt?: string;
}
export interface KnowledgeQualityReport {
    generatedAt: string;
    totalItems: number;
    activeItems: number;
    verifiedItems: number;
    unverifiedItems: number;
    lowConfidenceItems: number;
    staleItems: number;
    conflictingItems: number;
    openConflictsCount: number;
    staleItemIds: readonly string[];
    lowConfidenceItemIds: readonly string[];
    conflicts: readonly KnowledgeItemConflict[];
    recommendations: readonly string[];
}
