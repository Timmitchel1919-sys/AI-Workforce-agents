import type { GraphFragment, KnowledgeSource, KnowledgeSourceProvider } from "../../contracts/graph.js";
/**
 * In-memory registry of authoritative knowledge sources. Nothing is scraped
 * from repositories: a source exists only if something registered it.
 */
export declare class KnowledgeSourceRegistry implements KnowledgeSourceProvider {
    private readonly sources;
    register(source: KnowledgeSource): KnowledgeSource;
    list(): readonly KnowledgeSource[];
}
export interface KnowledgeFragmentInput {
    projectId: string;
    projectNodeId: string;
    provider?: KnowledgeSourceProvider;
    agentIds: ReadonlySet<string>;
    taskIds: ReadonlySet<string>;
}
/**
 * Project-scoped knowledge slice. A source is visible only when it lists this
 * project (or "*"); references to sources outside that visible set are dropped
 * so a source's links can never reveal another project's knowledge.
 */
export declare function buildKnowledgeFragment(input: KnowledgeFragmentInput): GraphFragment;
