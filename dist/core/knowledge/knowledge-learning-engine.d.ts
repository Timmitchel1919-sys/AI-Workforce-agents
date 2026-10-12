import type { KnowledgeConflict, KnowledgeItem, KnowledgeQualityReport, KnowledgeScope, CreateKnowledgeInput } from "../../contracts/knowledge.js";
/**
 * AI Workforce OS — Layer 14: Knowledge Learning & Organizational Memory Engine
 *
 * Implements:
 * - Deterministic conflict detection between knowledge records
 * - Conflict resolution without silent history overwrite
 * - Knowledge quality, staleness, and confidence audits
 * - Reusable pattern and lesson extraction from operational outcomes
 * - Scoped retrieval with strict project isolation
 */
export interface ScopedRetrievalQuery {
    prompt: string;
    projectId?: string;
    scope?: KnowledgeScope;
    tags?: readonly string[];
    limit?: number;
}
export interface OperationalExecutionRecord {
    taskId: string;
    action: string;
    outcome: "success" | "failure";
    errorOrSummary: string;
    projectId?: string;
    timestamp: string;
}
export declare class KnowledgeLearningEngine {
    private readonly conflicts;
    /**
     * Detects conflicting knowledge statements between items in the same scope or project.
     * Does NOT overwrite either record; flags for human or policy review.
     */
    detectConflicts(items: readonly KnowledgeItem[]): KnowledgeConflict[];
    private evaluateItemPair;
    /**
     * Resolves an identified conflict. Updates the preferred item to validated,
     * marks the rejected item as superseded, and records the resolution audit notes.
     */
    resolveConflict(conflictId: string, winnerItem: KnowledgeItem, loserItem: KnowledgeItem, resolutionNotes: string, resolvedBy: string): {
        updatedWinner: KnowledgeItem;
        updatedLoser: KnowledgeItem;
        resolvedConflict: KnowledgeConflict;
    };
    /**
     * Performs an evidence-based quality audit across the knowledge repository.
     * Identifies stale items, low-confidence records, and unresolved conflicts.
     */
    analyzeQuality(items: readonly KnowledgeItem[]): KnowledgeQualityReport;
    /**
     * Scoped context retrieval for the Context Engine and Prompt Intelligence layer.
     * Enforces strict project isolation — cross-project knowledge (e.g. AIMS vs Money Mind)
     * is never returned unless explicitly marked as global scope.
     */
    retrieveScopedContext(items: readonly KnowledgeItem[], query: ScopedRetrievalQuery): KnowledgeItem[];
    /**
     * Extracts reusable pattern proposals from operational execution records.
     * Repeated failures or successes generate structured knowledge suggestions.
     */
    extractPatterns(executions: readonly OperationalExecutionRecord[]): Partial<CreateKnowledgeInput>[];
}
