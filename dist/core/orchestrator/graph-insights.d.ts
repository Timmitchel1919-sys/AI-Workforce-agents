import { type SpatialInsight, type WorkforceGraphEdge, type WorkforceGraphNode } from "../../contracts/graph.js";
/**
 * Spatial intelligence (EO-5.8): grounded observations over the AUTHORISED graph.
 *
 * This module is deliberately inert:
 *  - it is a pure function of `nodes` + `edges` — it reads no store, calls no service, and imports
 *    nothing from the command, execution or release code, so it cannot change anything;
 *  - it reports only what the recorded state shows (which node is in which state, which edge links
 *    it to which), with the evidence for each finding;
 *  - it invents no cause, probability, score or ETA. Where the graph records THAT something failed
 *    but not WHY, the finding says so (`cause_not_recorded`);
 *  - its recommendations are labels with a target node — never a payload, never executed.
 *    SUGGESTION != COMMAND.
 */
export interface InsightGraph {
    nodes: readonly WorkforceGraphNode[];
    edges: readonly WorkforceGraphEdge[];
}
export declare function deriveInsights(graph: InsightGraph): {
    findings: SpatialInsight[];
    truncated: boolean;
};
