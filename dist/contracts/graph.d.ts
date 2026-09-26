/**
 * One projection architecture, multiple logical views (EO-5.6).
 * Future modes (COST, SECURITY, DEPLOYMENT, AUDIT) are added to this list and
 * to the mode registry in core/orchestrator/graph-modes.ts — no new engine.
 */
export declare const GRAPH_MODES: readonly ["WORKFORCE", "PROJECT", "AGENT", "WORKFLOW", "DEPENDENCY", "ENVIRONMENT", "KNOWLEDGE"];
export type GraphMode = (typeof GRAPH_MODES)[number];
export declare const DEFAULT_GRAPH_MODE: GraphMode;
/** Hard server-side bounds. Query options can only tighten these. */
export declare const GRAPH_LIMITS: {
    readonly defaultDepth: 3;
    readonly maxDepth: 5;
    readonly defaultMaxNodes: 250;
    readonly maxNodes: 500;
    readonly maxEdges: 1500;
};
/**
 * Normalised operational vocabulary the UI colours from. The raw `status`
 * string stays on the node; `state` is derived server-side from authoritative
 * state only (never invented). `unavailable` = authoritative state exposes none.
 */
export declare const GRAPH_OPERATIONAL_STATES: readonly ["active", "running", "queued", "blocked", "failed", "completed", "offline", "unavailable"];
export type GraphOperationalState = (typeof GRAPH_OPERATIONAL_STATES)[number];
export interface WorkforceGraphProjection {
    projectId: string;
    mode: GraphMode;
    revision: number;
    generatedAt: string;
    nodes: WorkforceGraphNode[];
    edges: WorkforceGraphEdge[];
    /** True when node/edge/depth bounds cut the projection short. */
    truncated: boolean;
    /** The bounds actually applied after server-side clamping. */
    appliedLimits: {
        depth: number;
        maxNodes: number;
        maxEdges: number;
    };
    /** Root the projection was scoped to, when one was requested and valid. */
    rootNodeId?: string;
    metadata?: Record<string, string>;
}
export type WorkforceGraphNodeType = "PROJECT" | "PROGRAM" | "WORKSTREAM" | "TASK" | "AGENT" | "CAPABILITY" | "MODEL" | "ENVIRONMENT" | "RUNNER" | "EXECUTION_PLAN" | "EXECUTION_SESSION" | "WORKSPACE" | "WRITE_SCOPE" | "CHANGESET" | "VERIFICATION" | "REVIEW" | "APPROVAL" | "REPOSITORY" | "COMMIT" | "ARTIFACT" | "DEPLOYMENT" | "CONTROL_PLANE" | "WORKFLOW" | "WORKFLOW_STEP" | "ENVIRONMENT_ROUTER" | "KNOWLEDGE_SOURCE";
export interface WorkforceGraphNode {
    id: string;
    type: WorkforceGraphNodeType;
    label: string;
    /** Raw authoritative status string (e.g. a TaskStatus). */
    status: string;
    /** Normalised operational state for visual encoding. */
    state: GraphOperationalState;
    projectId: string;
    referenceId: string;
    /**
     * Whitelisted, non-secret, display-safe fields. Never credentials, hostnames,
     * filesystem paths, tokens or free-form agent/task metadata blobs.
     */
    metadata?: Record<string, string | number | boolean | undefined>;
}
export type WorkforceGraphEdgeType = "CONTAINS" | "HAS_TASK" | "DEPENDS_ON" | "ASSIGNED_TO" | "REQUIRES" | "QUALIFIED_FOR" | "ROUTED_TO" | "RUNS_ON" | "HOLDS_LEASE" | "OWNS_SCOPE" | "USES_MODEL" | "EXECUTES" | "PRODUCES" | "VERIFIED_BY" | "REVIEWED_BY" | "REQUIRES_APPROVAL" | "COMMITTED_AS" | "PUSHED_TO" | "DEPLOYED_TO" | "PRODUCES_ARTIFACT" | "BELONGS_TO" | "PART_OF" | "EXECUTES_IN" | "PARTICIPATES_IN" | "REVIEWS" | "REFERENCES" | "DOCUMENTS" | "DESCRIBES" | "USED_BY";
export interface WorkforceGraphEdge {
    id: string;
    type: WorkforceGraphEdgeType;
    source: string;
    target: string;
    status?: string;
    metadata?: Record<string, string>;
}
export interface GraphQueryOptions {
    projectId: string;
    /** Defaults to WORKFORCE. */
    mode?: GraphMode;
    depth?: number;
    nodeTypes?: WorkforceGraphNodeType[];
    maxNodes?: number;
    maxEdges?: number;
    rootNodeId?: string;
}
/**
 * A registered, authoritative knowledge source (documentation, architecture
 * doc, codebase, policy, lessons learned). Provided by a
 * {@link KnowledgeSourceProvider}; the graph never scrapes repository content.
 */
export declare const KNOWLEDGE_SOURCE_KINDS: readonly ["documentation", "architecture", "codebase", "project_knowledge", "lessons_learned", "policy"];
export type KnowledgeSourceKind = (typeof KNOWLEDGE_SOURCE_KINDS)[number];
export interface KnowledgeSource {
    id: string;
    kind: KnowledgeSourceKind;
    title: string;
    /** Projects allowed to see this source. `"*"` = every project. */
    projectIds: readonly string[];
    /** Agent ids that use this source (drives USED_BY). */
    usedByAgentIds?: readonly string[];
    /** Other registered source ids this one references (drives REFERENCES). */
    referencesSourceIds?: readonly string[];
    /** Source ids this one documents/describes; kind decides DOCUMENTS vs DESCRIBES. */
    describesTaskIds?: readonly string[];
}
export interface KnowledgeSourceProvider {
    list(): readonly KnowledgeSource[];
}
/** A composable slice of the projection; fragments are merged by node/edge id. */
export interface GraphFragment {
    nodes: WorkforceGraphNode[];
    edges: WorkforceGraphEdge[];
}
