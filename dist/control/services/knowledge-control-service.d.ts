/**
 * KnowledgeControlService — the governed read/command surface for Knowledge,
 * Memory & Context Intelligence.
 *
 * Reads need `view` plus access to the memory's project (platform SYSTEM memory
 * is readable by every operator). Commands need `manage_knowledge`, are audited
 * as `control_command`, and act as the signed-in user: only a user can confirm
 * memory, resolve a conflict or mark something CRITICAL. Frontend claims are
 * never trusted — authorization is derived from the principal here, and the
 * retrieval engine enforces project scope again independently.
 */
import { type CommandOptions, type ControlCommandResult, type OperatorPrincipal } from "../../contracts/index.js";
import { type ContextPackage, type MemoryRecord } from "../../contracts/knowledge-memory.js";
import { type KnowledgeSystem, type ProjectFileSource } from "../../core/index.js";
type Body = Record<string, unknown>;
export interface KnowledgeControlDeps {
    knowledge: KnowledgeSystem;
    audit: import("../../core/index.js").AuditLog;
    /** Does the project exist in the registry? */
    projectExists: (projectId: string) => boolean;
    /** Where a project's files can be read from (workspace / GitHub), if anywhere. */
    sourceFor?: (projectId: string) => Promise<ProjectFileSource | undefined>;
    clock?: () => string;
}
export declare function summaryOf(m: MemoryRecord): {
    memoryId: string;
    type: "SYSTEM" | "PROJECT" | "ARCHITECTURAL" | "USER_PREFERENCE" | "EXECUTION" | "AGENT" | "DOCUMENT";
    title: string;
    summary: string;
    projectId: string | null;
    source: "SYSTEM" | "EXECUTION" | "AGENT" | "DOCUMENT" | "USER" | "PROJECT_FILE" | "GITHUB" | "EXTERNAL_RESEARCH";
    sourceRef: string | null;
    confidence: "VERIFIED" | "USER_CONFIRMED" | "SYSTEM_GENERATED" | "AGENT_GENERATED" | "INFERRED" | "UNVERIFIED";
    importance: "LOW" | "HIGH" | "CRITICAL" | "NORMAL";
    status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "ARCHIVED" | "REVOKED";
    freshness: import("../../contracts/knowledge-memory.js").MemoryFreshness;
    version: number;
    tags: string[];
    retention: import("../../contracts/knowledge-memory.js").MemoryRetention;
    expiresAt: string | null;
    updatedAt: string;
    createdAt: string;
};
export declare class KnowledgeControlService {
    private readonly deps;
    private readonly clock;
    private readonly k;
    constructor(deps: KnowledgeControlDeps);
    private requireReader;
    private canSee;
    private requireProject;
    private mustSee;
    private scope;
    private actor;
    overview(p: OperatorPrincipal, projectId?: string): {
        health: import("../../contracts/knowledge-memory.js").KnowledgeHealth;
        findings: import("../../contracts/knowledge-memory.js").KnowledgeAuditFinding[];
        conflicts: number;
        candidates: number;
        capabilities: {
            retrieval: string;
            embeddings: boolean;
            pdfExtraction: boolean;
            canWrite: boolean;
        };
        generatedAt: string;
    };
    private visibleHealth;
    private listFiltered;
    private csv;
    list(p: OperatorPrincipal, params: URLSearchParams): {
        memories: {
            memoryId: string;
            type: "SYSTEM" | "PROJECT" | "ARCHITECTURAL" | "USER_PREFERENCE" | "EXECUTION" | "AGENT" | "DOCUMENT";
            title: string;
            summary: string;
            projectId: string | null;
            source: "SYSTEM" | "EXECUTION" | "AGENT" | "DOCUMENT" | "USER" | "PROJECT_FILE" | "GITHUB" | "EXTERNAL_RESEARCH";
            sourceRef: string | null;
            confidence: "VERIFIED" | "USER_CONFIRMED" | "SYSTEM_GENERATED" | "AGENT_GENERATED" | "INFERRED" | "UNVERIFIED";
            importance: "LOW" | "HIGH" | "CRITICAL" | "NORMAL";
            status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "ARCHIVED" | "REVOKED";
            freshness: import("../../contracts/knowledge-memory.js").MemoryFreshness;
            version: number;
            tags: string[];
            retention: import("../../contracts/knowledge-memory.js").MemoryRetention;
            expiresAt: string | null;
            updatedAt: string;
            createdAt: string;
        }[];
        total: number;
    };
    search(p: OperatorPrincipal, params: URLSearchParams): {
        hits: {
            score: number;
            signals: import("../../contracts/knowledge-memory.js").RetrievalSignals;
            reasons: string[];
            stale: boolean;
            conflictWith: string[];
            memoryId: string;
            type: "SYSTEM" | "PROJECT" | "ARCHITECTURAL" | "USER_PREFERENCE" | "EXECUTION" | "AGENT" | "DOCUMENT";
            title: string;
            summary: string;
            projectId: string | null;
            source: "SYSTEM" | "EXECUTION" | "AGENT" | "DOCUMENT" | "USER" | "PROJECT_FILE" | "GITHUB" | "EXTERNAL_RESEARCH";
            sourceRef: string | null;
            confidence: "VERIFIED" | "USER_CONFIRMED" | "SYSTEM_GENERATED" | "AGENT_GENERATED" | "INFERRED" | "UNVERIFIED";
            importance: "LOW" | "HIGH" | "CRITICAL" | "NORMAL";
            status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "ARCHIVED" | "REVOKED";
            freshness: import("../../contracts/knowledge-memory.js").MemoryFreshness;
            version: number;
            tags: string[];
            retention: import("../../contracts/knowledge-memory.js").MemoryRetention;
            expiresAt: string | null;
            updatedAt: string;
            createdAt: string;
        }[];
    };
    detail(p: OperatorPrincipal, memoryId: string): {
        memory: {
            content: string;
            references: import("../../contracts/knowledge-memory.js").MemoryReference[];
            facets: Record<string, string>;
            createdBy: string;
            statusReason: string | null;
            reinforced: number;
            agentId: string | null;
            memoryId: string;
            type: "SYSTEM" | "PROJECT" | "ARCHITECTURAL" | "USER_PREFERENCE" | "EXECUTION" | "AGENT" | "DOCUMENT";
            title: string;
            summary: string;
            projectId: string | null;
            source: "SYSTEM" | "EXECUTION" | "AGENT" | "DOCUMENT" | "USER" | "PROJECT_FILE" | "GITHUB" | "EXTERNAL_RESEARCH";
            sourceRef: string | null;
            confidence: "VERIFIED" | "USER_CONFIRMED" | "SYSTEM_GENERATED" | "AGENT_GENERATED" | "INFERRED" | "UNVERIFIED";
            importance: "LOW" | "HIGH" | "CRITICAL" | "NORMAL";
            status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "ARCHIVED" | "REVOKED";
            freshness: import("../../contracts/knowledge-memory.js").MemoryFreshness;
            version: number;
            tags: string[];
            retention: import("../../contracts/knowledge-memory.js").MemoryRetention;
            expiresAt: string | null;
            updatedAt: string;
            createdAt: string;
        };
        provenance: {
            source: "SYSTEM" | "EXECUTION" | "AGENT" | "DOCUMENT" | "USER" | "PROJECT_FILE" | "GITHUB" | "EXTERNAL_RESEARCH";
            sourceRef: string | null;
            createdBy: string;
            createdAt: string;
            answer: string;
        };
        supersedes: {
            memoryId: string;
            title: string;
            status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "ARCHIVED" | "REVOKED";
        } | null;
        supersededBy: {
            memoryId: string;
            title: string;
            status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "ARCHIVED" | "REVOKED";
        } | null;
        versions: {
            version: number;
            at: string;
            by: string;
            change: string;
            status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "ARCHIVED" | "REVOKED";
            title: string;
        }[];
        related: {
            relation: "DEPENDS_ON" | "USES" | "BELONGS_TO" | "RELATED_TO" | "SUPERSEDES" | "CONFLICTS_WITH" | "DERIVED_FROM" | "IMPLEMENTS" | "AFFECTS" | "REQUIRES";
            direction: string;
            node: string;
            label: string;
            memoryId: string | null;
        }[];
        usage: {
            taskId: string;
            agentId: string;
            reason: string;
            result: import("../../contracts/knowledge-memory.js").UsageResult;
            at: string;
        }[];
        conflicts: import("../../contracts/knowledge-memory.js").KnowledgeConflict[];
    };
    graph(p: OperatorPrincipal, params: URLSearchParams): {
        projectId: string;
        nodes: {
            id: string;
            label: string;
            kind: "PROJECT" | "TECHNOLOGY" | "COMPONENT" | "AREA" | "INTEGRATION" | "MEMORY" | "OTHER";
        }[];
        edges: {
            id: string;
            from: string;
            to: string;
            type: "DEPENDS_ON" | "USES" | "BELONGS_TO" | "RELATED_TO" | "SUPERSEDES" | "CONFLICTS_WITH" | "DERIVED_FROM" | "IMPLEMENTS" | "AFFECTS" | "REQUIRES";
            source: "SYSTEM" | "EXECUTION" | "AGENT" | "DOCUMENT" | "USER" | "PROJECT_FILE" | "GITHUB" | "EXTERNAL_RESEARCH";
        }[];
        truncated: boolean;
    };
    conflicts(p: OperatorPrincipal, projectId?: string): {
        conflicts: import("../../contracts/knowledge-memory.js").KnowledgeConflict[];
    };
    documents(p: OperatorPrincipal, projectId?: string): {
        documents: {
            projectId: string;
            ref: string;
            ingestedAt: string;
            chunks: number;
            active: number;
            potentiallyStale: number;
            tags: string[];
        }[];
    };
    decisions(p: OperatorPrincipal, projectId?: string): {
        decisions: {
            memoryId: string;
            type: "SYSTEM" | "PROJECT" | "ARCHITECTURAL" | "USER_PREFERENCE" | "EXECUTION" | "AGENT" | "DOCUMENT";
            title: string;
            summary: string;
            projectId: string | null;
            source: "SYSTEM" | "EXECUTION" | "AGENT" | "DOCUMENT" | "USER" | "PROJECT_FILE" | "GITHUB" | "EXTERNAL_RESEARCH";
            sourceRef: string | null;
            confidence: "VERIFIED" | "USER_CONFIRMED" | "SYSTEM_GENERATED" | "AGENT_GENERATED" | "INFERRED" | "UNVERIFIED";
            importance: "LOW" | "HIGH" | "CRITICAL" | "NORMAL";
            status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "ARCHIVED" | "REVOKED";
            freshness: import("../../contracts/knowledge-memory.js").MemoryFreshness;
            version: number;
            tags: string[];
            retention: import("../../contracts/knowledge-memory.js").MemoryRetention;
            expiresAt: string | null;
            updatedAt: string;
            createdAt: string;
        }[];
    };
    candidates(p: OperatorPrincipal, projectId?: string): {
        candidates: {
            memoryId: string;
            type: "SYSTEM" | "PROJECT" | "ARCHITECTURAL" | "USER_PREFERENCE" | "EXECUTION" | "AGENT" | "DOCUMENT";
            title: string;
            summary: string;
            projectId: string | null;
            source: "SYSTEM" | "EXECUTION" | "AGENT" | "DOCUMENT" | "USER" | "PROJECT_FILE" | "GITHUB" | "EXTERNAL_RESEARCH";
            sourceRef: string | null;
            confidence: "VERIFIED" | "USER_CONFIRMED" | "SYSTEM_GENERATED" | "AGENT_GENERATED" | "INFERRED" | "UNVERIFIED";
            importance: "LOW" | "HIGH" | "CRITICAL" | "NORMAL";
            status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "ARCHIVED" | "REVOKED";
            freshness: import("../../contracts/knowledge-memory.js").MemoryFreshness;
            version: number;
            tags: string[];
            retention: import("../../contracts/knowledge-memory.js").MemoryRetention;
            expiresAt: string | null;
            updatedAt: string;
            createdAt: string;
        }[];
    };
    health(p: OperatorPrincipal, projectId?: string): import("../../contracts/knowledge-memory.js").KnowledgeHealth;
    findings(p: OperatorPrincipal, projectId?: string): {
        findings: import("../../contracts/knowledge-memory.js").KnowledgeAuditFinding[];
    };
    /** Preview the context package an agent of `role` would receive. */
    context(p: OperatorPrincipal, params: URLSearchParams): ContextPackage;
    execute(command: string, principal: OperatorPrincipal, body: Body, options?: CommandOptions): Promise<ControlCommandResult>;
    private proposal;
    private run;
    private result;
}
export {};
