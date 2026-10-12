/**
 * Controlled knowledge ingestion.
 *
 *   identify → extract → structure → classify → metadata → chunk → index →
 *   connect to project → store provenance
 *
 * Nothing is ingested wholesale: paths are classified, denied paths and
 * credential files are skipped, secrets are redacted by the write policy, and
 * every chunk keeps its source reference and hash so a changed source marks
 * dependent knowledge POTENTIALLY_STALE.
 *
 * Code indexing is contextual (symbols, routes, API boundaries), not a compiler.
 * Project discovery REUSES the onboarding analyzer (`analyzeRepositoryEvidence`).
 */
import type { MemorySource } from "../../contracts/knowledge-memory.js";
import type { MemoryService } from "./memory-service.js";
import { slug } from "./text.js";
export interface ProjectFileSource {
    readonly kind: "workspace" | "github" | "memory";
    list(): Promise<{
        paths: string[];
        truncated: boolean;
    }>;
    read(path: string): Promise<string | undefined>;
    commits?(limit: number): Promise<{
        sha: string;
        message: string;
        files: string[];
    }[]>;
}
/** In-memory source (tests, pasted documents). */
export declare class StaticFileSource implements ProjectFileSource {
    private readonly files;
    private readonly history;
    readonly kind: "memory";
    constructor(files: Readonly<Record<string, string>>, history?: {
        sha: string;
        message: string;
        files: string[];
    }[]);
    list(): Promise<{
        paths: string[];
        truncated: boolean;
    }>;
    read(path: string): Promise<string>;
    commits(limit: number): Promise<{
        sha: string;
        message: string;
        files: string[];
    }[]>;
}
export declare function isIngestablePath(path: string): {
    ok: true;
    kind: "doc" | "code" | "config";
} | {
    ok: false;
    reason: string;
};
export declare function classifyDocument(path: string, text: string): {
    tags: string[];
    importance: "NORMAL" | "HIGH";
};
export interface Chunk {
    heading: string;
    text: string;
}
export declare function chunkMarkdown(text: string, max?: 1200): Chunk[];
export interface CodeSymbols {
    components: string[];
    hooks: string[];
    types: string[];
    routes: string[];
    apiCalls: string[];
    integrations: string[];
    services: string[];
}
export declare function extractCodeSymbols(path: string, text: string): CodeSymbols;
export declare function areaOf(path: string): string | undefined;
export interface IngestReport {
    ref: string;
    status: "ingested" | "unchanged" | "skipped";
    reason?: string;
    chunks: number;
    created: string[];
    reinforced: string[];
    archived: string[];
    staleMarked: string[];
    redacted: number;
    steps: string[];
}
export declare class KnowledgeIngestion {
    private readonly memory;
    private readonly clock;
    constructor(memory: MemoryService, clock?: () => number);
    private system;
    ingestDocument(input: {
        projectId: string;
        ref: string;
        text: string;
        contentType?: string;
        source?: MemorySource;
        requestedBy: string;
        tags?: string[];
    }): IngestReport;
    private linkCode;
    /** Git history as low-authority context: commit messages are never architecture. */
    ingestCommits(input: {
        projectId: string;
        source: ProjectFileSource;
        requestedBy: string;
        limit?: number;
    }): Promise<{
        created: number;
        skipped: number;
    }>;
}
export interface DiscoveryReport {
    projectId: string;
    mode: "discover" | "refresh";
    source: ProjectFileSource["kind"];
    truncated: boolean;
    topics: {
        topic: string;
        outcome: "created" | "unchanged" | "superseded" | "candidate" | "reinforced";
    }[];
    documents: IngestReport[];
    commits: {
        created: number;
        skipped: number;
    };
    staleMarked: string[];
    conflicts: number;
    unavailable: string[];
}
export declare class ProjectDiscovery {
    private readonly memory;
    private readonly ingestion;
    private readonly clock;
    constructor(memory: MemoryService, ingestion: KnowledgeIngestion, clock?: () => number);
    run(input: {
        projectId: string;
        source: ProjectFileSource;
        requestedBy: string;
        mode?: "discover" | "refresh";
        maxDocuments?: number;
        maxCode?: number;
    }): Promise<DiscoveryReport>;
    private upsertTopic;
}
export { slug };
