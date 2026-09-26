import { type GraphFragment, type GraphQueryOptions, type WorkforceGraphEdge, type WorkforceGraphNode, type WorkforceGraphProjection } from "../../contracts/graph.js";
import type { KnowledgeSourceProvider } from "../../contracts/graph.js";
import type { AgentRegistry, EnvironmentRegistry, ProjectRegistry, TaskSystem, WorkflowSystem } from "../index.js";
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
export declare function redactSecrets(value: string): string;
export declare function truncate(value: string, max: number): string;
/** Only display-safe scalar metadata survives; undefined entries are dropped. */
export declare function safeMetadata(input: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean> | undefined;
export declare function joinList(values: readonly string[] | undefined): string | undefined;
/** Clamp caller-supplied bounds. Callers can only tighten, never loosen. */
export declare function resolveBounds(options: GraphQueryOptions): ResolvedGraphBounds;
export declare const byId: <T extends {
    id: string;
}>(a: T, b: T) => number;
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
    getProjection(options: GraphQueryOptions): WorkforceGraphProjection;
    private buildBaseGraph;
    /** Redacted routing verdicts for this project's programs only. */
    private routesForProject;
    private addWorkflows;
}
