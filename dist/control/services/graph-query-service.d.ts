import { type GraphQueryOptions, type WorkforceGraphProjection } from "../../contracts/graph.js";
import type { ControlPlaneContext } from "../index.js";
import { OperatorPrincipal } from "../../contracts/index.js";
/**
 * Parses and validates the graph query string. Numeric bounds are clamped
 * later by the projection service; here we only reject malformed input.
 */
export declare function parseGraphQueryParams(projectId: string, params: URLSearchParams): GraphQueryOptions;
export declare class GraphQueryService {
    private readonly projectionService;
    constructor(ctx: ControlPlaneContext);
    /**
     * Authorisation happens here, before any projection work: an operator who
     * cannot access the project gets `undefined` (indistinguishable from a
     * missing project). The projection service re-clamps all bounds.
     */
    getWorkforceGraph(principal: OperatorPrincipal, options: GraphQueryOptions): WorkforceGraphProjection | undefined;
}
