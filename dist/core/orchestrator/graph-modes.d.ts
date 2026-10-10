import type { GraphMode, WorkforceGraphEdge, WorkforceGraphNode, WorkforceGraphNodeType } from "../../contracts/graph.js";
/**
 * One projection architecture, multiple logical views. A mode is a pure
 * selection over the SAME authorised base graph: which node types are visible,
 * where traversal starts, and which nodes are pruned as irrelevant. Adding a
 * future mode (COST, SECURITY, DEPLOYMENT, AUDIT) means adding one entry to
 * {@link MODE_DEFINITIONS} — never a second graph engine.
 */
export interface ModeSelection {
    nodes: WorkforceGraphNode[];
    edges: WorkforceGraphEdge[];
    /** Traversal roots, sorted. Empty → nothing reachable (empty view). */
    rootIds: string[];
    /** Human note surfaced in projection.metadata when the view is empty/limited. */
    note?: string;
}
interface ModeContext {
    nodes: readonly WorkforceGraphNode[];
    edges: readonly WorkforceGraphEdge[];
    projectNodeId: string;
    /** Caller-requested root, already verified to exist in the base graph. */
    requestedRoot?: string;
}
interface ModeDefinition {
    /** Node types visible in this mode. */
    types: ReadonlySet<WorkforceGraphNodeType>;
    select(ctx: ModeContext, visible: WorkforceGraphNode[]): ModeSelection;
}
declare const CONTROL_PLANE_ID = "control-plane";
export declare const MODE_DEFINITIONS: Readonly<Record<GraphMode, ModeDefinition>>;
/** Select the mode's visible slice of the authorised base graph. */
export declare function selectMode(mode: GraphMode, ctx: ModeContext): ModeSelection;
export { CONTROL_PLANE_ID };
