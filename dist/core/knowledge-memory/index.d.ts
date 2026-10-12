/**
 * Knowledge, Memory & Context Intelligence — composition.
 *
 * `KnowledgeSystem` wires the memory service, index, retrieval, assembler,
 * ingestion, discovery, learner and auditor over the platform repositories and
 * AuditLog. Source adapters reuse existing readers (the governed workspace file
 * system, the onboarding GitHub repository reader).
 */
import type { AuditLog } from "../index.js";
import type { GovernedFileSystem } from "../execution-runtime/workspace.js";
import type { LocalGitOps } from "../execution-runtime/git-ops.js";
import type { RepositorySourceReader } from "../onboarding/repository-source.js";
import { ContextAssembler, MemoryContextSource } from "./context-assembler.js";
import { KnowledgeAuditor } from "./health-and-audit.js";
import { KnowledgeIngestion, ProjectDiscovery, type ProjectFileSource } from "./ingestion.js";
import { ExecutionLearner } from "./learning.js";
import { MemoryService, type KnowledgeRepos } from "./memory-service.js";
import { KnowledgeIndex, RetrievalEngine, type SemanticScorer } from "./retrieval.js";
export * from "./text.js";
export * from "./facets.js";
export * from "./write-policy.js";
export * from "./memory-service.js";
export * from "./retrieval.js";
export * from "./context-assembler.js";
export * from "./ingestion.js";
export * from "./learning.js";
export * from "./health-and-audit.js";
export declare function inMemoryKnowledgeRepos(): KnowledgeRepos;
export declare class KnowledgeSystem {
    readonly memory: MemoryService;
    readonly index: KnowledgeIndex;
    readonly retrieval: RetrievalEngine;
    readonly assembler: ContextAssembler;
    readonly ingestion: KnowledgeIngestion;
    readonly discovery: ProjectDiscovery;
    readonly learner: ExecutionLearner;
    readonly auditor: KnowledgeAuditor;
    readonly contextSource: MemoryContextSource;
    constructor(options: {
        repos: KnowledgeRepos;
        audit: AuditLog;
        clock?: () => number;
        scorer?: SemanticScorer;
    });
    private readonly clock;
    health(projectId?: string): import("../index.js").KnowledgeHealth;
}
/** A registered local workspace, read through the governed (read-only) file system. */
export declare function workspaceFileSource(fs: Pick<GovernedFileSystem, "tree" | "read">, git?: Pick<LocalGitOps, "log">): ProjectFileSource;
/** A remote repository read through the onboarding GitHub reader (allow-listed files only). */
export declare function githubFileSource(reader: RepositorySourceReader, target: {
    url: string;
    branch?: string;
}): ProjectFileSource;
