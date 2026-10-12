/**
 * KnowledgeCrudControlService — the authorized read/write surface for the Knowledge
 * module (Phase 2 — Control Plane §17 & Layer 14 Knowledge Learning).
 *
 * Repository-backed, authorized server-side, audit-logged on every change.
 * Integrates the KnowledgeLearningEngine for conflict detection, ADR lifecycles,
 * quality analysis, lessons learned, and scoped context retrieval.
 */
import { type OperatorPrincipal } from "../../contracts/index.js";
import { type CreateKnowledgeInput, type KnowledgeItem, type KnowledgeQuery, type UpdateKnowledgeInput, type KnowledgeItemConflict, type KnowledgeQualityReport, type AdrStatus } from "../../contracts/knowledge.js";
import type { Repository } from "../../contracts/persistence.js";
import type { AuditLog } from "../../core/index.js";
import { KnowledgeLearningEngine, type ScopedRetrievalQuery } from "../../core/knowledge/knowledge-learning-engine.js";
export declare class KnowledgeCrudControlService {
    private readonly items;
    private readonly audit?;
    private readonly engine;
    constructor(items: Repository<KnowledgeItem>, audit?: AuditLog | undefined, engine?: KnowledgeLearningEngine);
    /** Reads require only the `view` capability (every role has it). */
    private requireReader;
    /**
     * Writes are administrator-only, consistent with the other Control Plane
     * domain services.
     */
    private requireWriter;
    private requireProjectAccess;
    list(principal: OperatorPrincipal, filter?: KnowledgeQuery): KnowledgeItem[];
    get(principal: OperatorPrincipal, id: string): KnowledgeItem | undefined;
    create(principal: OperatorPrincipal, input: CreateKnowledgeInput): KnowledgeItem;
    update(principal: OperatorPrincipal, id: string, patch: UpdateKnowledgeInput): KnowledgeItem;
    /** Proposes a new Architecture Decision Record. */
    proposeADR(principal: OperatorPrincipal, input: {
        projectId?: string;
        title: string;
        decision: string;
        context: string;
        alternatives: string[];
        rationale: string;
        consequences: string[];
    }): KnowledgeItem;
    /** Transitions the lifecycle of an Architecture Decision Record. */
    updateADRStatus(principal: OperatorPrincipal, knowledgeId: string, status: AdrStatus, notes?: string): KnowledgeItem;
    /** Records a verified lesson learned from significant operational successes or failures. */
    recordLesson(principal: OperatorPrincipal, input: {
        projectId?: string;
        title: string;
        whatHappened: string;
        why: string;
        whatWorked: string;
        whatFailed: string;
        whatShouldChange: string;
        whatShouldBeRepeated: string;
        tags?: string[];
    }): KnowledgeItem;
    /** Scans knowledge base for contradictory assertions and returns active conflicts. */
    getConflicts(principal: OperatorPrincipal, projectId?: string): KnowledgeItemConflict[];
    /** Resolves an active knowledge conflict between two items. */
    resolveConflict(principal: OperatorPrincipal, conflictId: string, winnerId: string, resolutionNotes: string): {
        winner: KnowledgeItem;
        loser: KnowledgeItem;
        conflict: KnowledgeItemConflict;
    };
    /** Generates an organizational memory quality & staleness audit report. */
    getQualityReport(principal: OperatorPrincipal, projectId?: string): KnowledgeQualityReport;
    /**
     * Scoped context retrieval for Context Engine / Prompt Intelligence.
     * Strictly enforces project isolation (e.g. AIMS vs Money Mind).
     */
    retrieveContextKnowledge(principal: OperatorPrincipal, query: ScopedRetrievalQuery): KnowledgeItem[];
}
