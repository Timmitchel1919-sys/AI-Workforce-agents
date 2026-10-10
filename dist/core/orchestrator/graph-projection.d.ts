import { type GraphFragment, type GraphQueryOptions, type WorkforceGraphEdge, type WorkforceGraphNode, type WorkforceGraphProjection } from "../../contracts/graph.js";
import type { KnowledgeSourceProvider } from "../../contracts/graph.js";
import type { AgentRegistry, EnvironmentRegistry, ProjectRegistry, TaskSystem, WorkflowSystem } from "../index.js";
import { type ExecutionGraphRecords } from "./graph-execution-fragment.js";
export { byId, joinList, redactSecrets, safeMetadata, truncate, } from "./graph-util.js";
import type { SoftwareFactoryOrchestrator } from "./software-factory-orchestrator.js";
/** Optional read-only collaborators. Absent → that slice is simply omitted. */
export interface GraphProjectionSources {
    /** Operator enable/disable state for agents (never mutated here). */
    agentOps?: {
        isEnabled(agentId: string): boolean;
    };
    workflows?: Pick<WorkflowSystem, "list">;
    /** Registered environment state (read-only). Absent → routing-only view. */
    environments?: Pick<EnvironmentRegistry, "listInstances">;
    /** Registered knowledge sources. Absent → an empty knowledge graph. */
    knowledge?: KnowledgeSourceProvider;
}
export interface ResolvedGraphBounds {
    depth: number;
    maxNodes: number;
    maxEdges: number;
}
/** Clamp caller-supplied bounds. Callers can only tighten, never loosen. */
export declare function resolveBounds(options: GraphQueryOptions): ResolvedGraphBounds;
/**
 * Folds extra authoritative text into a revision. Used when part of what the
 * client sees (e.g. which sources were unreadable) is not in the node/edge set,
 * so a `since` poll can never answer "unchanged" across that change.
 */
export declare function mixRevision(revision: number, text: string): number;
export declare class GraphBuilder {
    readonly nodes: Map<string, WorkforceGraphNode>;
    readonly edges: Map<string, WorkforceGraphEdge>;
    addNode(node: WorkforceGraphNode): void;
    addEdge(edge: WorkforceGraphEdge): void;
    merge(fragment: GraphFragment): void;
}
export interface BoundedView {
    nodes: WorkforceGraphNode[];
    edges: WorkforceGraphEdge[];
    truncated: boolean;
}
/**
 * Deterministic, cycle-safe, bounded breadth-first view over an
 * already-authorised graph. Neighbours are visited in id order; visited-set
 * membership makes cycles harmless; the node cap makes traversal bounded.
 * Edges are only kept when both endpoints survive (no dangling edges).
 */
export declare function boundedView(nodes: readonly WorkforceGraphNode[], edges: readonly WorkforceGraphEdge[], rootIds: string | readonly string[], bounds: ResolvedGraphBounds): BoundedView;
export declare class WorkforceGraphProjectionService {
    private readonly projectRegistry;
    private readonly agentRegistry;
    private readonly taskSystem;
    private readonly sfOrchestrator;
    private readonly sources;
    private readonly clock;
    constructor(projectRegistry: ProjectRegistry, agentRegistry: AgentRegistry, taskSystem: TaskSystem, sfOrchestrator: SoftwareFactoryOrchestrator | undefined, sources?: GraphProjectionSources, clock?: () => Date);
    /**
     * `execution` carries authoritative lifecycle records the caller already
     * fetched through authorised reads. Absent → no execution nodes (sparse real
     * data is correct; nothing is invented).
     */
    getProjection(options: GraphQueryOptions, execution?: ExecutionGraphRecords): WorkforceGraphProjection;
    /**
     * The complete AUTHORISED graph for one project (base + execution lifecycle), before any mode
     * filtering or bounding. Used by the projection itself and by spatial intelligence, so both
     * reason over exactly the same nodes.
     */
    private buildFullGraph;
    /** Full authorised graph + its revision, for read-only derivation (spatial intelligence). */
    getInsightGraph(projectId: string, execution?: ExecutionGraphRecords): {
        nodes: WorkforceGraphNode[];
        edges: WorkforceGraphEdge[];
        revision: number;
        generatedAt: string;
    };
    private buildBaseGraph;
    /** Redacted routing verdicts for this project's programs only. */
    private routesForProject;
    private addWorkflows;
}
