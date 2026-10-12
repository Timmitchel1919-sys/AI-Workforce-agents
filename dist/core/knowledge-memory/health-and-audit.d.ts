/**
 * Knowledge health metrics and the rule-based Knowledge Auditor.
 *
 * Findings are recomputed on demand from the stored records and the retrieval
 * log (nothing cached) and are raised once through the platform AuditLog
 * as `knowledge_event` (operation `audit.finding`).
 */
import { type KnowledgeAuditFinding, type KnowledgeHealth } from "../../contracts/knowledge-memory.js";
import type { MemoryService } from "./memory-service.js";
import type { RetrievalEngine } from "./retrieval.js";
export declare function computeHealth(memory: MemoryService, now: number, projectId?: string): KnowledgeHealth;
export interface AuditorLimits {
    windowMs: number;
    maxRetrievalsPerWindow: number;
    maxDeniedPerWindow: number;
    maxVersionsPerDay: number;
    maxAgentDraftsPerWindow: number;
}
export declare const DEFAULT_AUDITOR_LIMITS: AuditorLimits;
export declare class KnowledgeAuditor {
    private readonly memory;
    private readonly retrieval;
    private readonly clock;
    private readonly limits;
    private readonly raised;
    constructor(memory: MemoryService, retrieval: RetrievalEngine, clock?: () => number, limits?: AuditorLimits);
    run(projectId?: string): KnowledgeAuditFinding[];
}
