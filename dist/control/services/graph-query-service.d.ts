import { type GraphQueryOptions, type WorkforceGraphProjection } from "../../contracts/graph.js";
import type { ControlPlaneContext } from "../index.js";
import { type SpatialInsightsReport } from "../../contracts/graph.js";
import { OperatorPrincipal } from "../../contracts/index.js";
/**
 * Parses and validates the graph query string. Numeric bounds are clamped
 * later by the projection service; here we only reject malformed input.
 */
export declare function parseGraphQueryParams(projectId: string, params: URLSearchParams): GraphQueryOptions;
export declare class GraphQueryService {
    private readonly ctx;
    private readonly projectionService;
    private readonly recordCache;
    constructor(ctx: ControlPlaneContext);
    /**
     * Authorisation happens here, before any projection work: an operator who
     * cannot access the project gets `undefined` (indistinguishable from a
     * missing project). The projection service re-clamps all bounds.
     *
     * Lifecycle records are fetched through the SAME authorised, project-scoped
     * reads the Control Center uses, with the caller's principal — the graph
     * never reads a store directly.
     */
    getWorkforceGraph(principal: OperatorPrincipal, options: GraphQueryOptions): Promise<WorkforceGraphProjection | undefined>;
    /**
     * Spatial intelligence for one project (EO-5.8): grounded observations over the SAME authorised
     * graph the operator can see. Authorisation is identical to the graph's, and it is read-only —
     * nothing here writes, executes or invokes a command.
     */
    getInsights(principal: OperatorPrincipal, projectId: string): Promise<SpatialInsightsReport | undefined>;
    /** Release capabilities this deployment lacks (empty when it declares none or has them all). */
    private inertCapabilities;
    /**
     * Lifecycle records are project-scoped and identical for every operator who passed the project
     * gate above, so one short-lived (promise-shared) read serves every concurrent poll for the
     * project. This bounds the per-poll cost (reconcile + ChangeSet fan-out) to roughly one read
     * per project per TTL no matter how many tabs are open. The cache is consulted only AFTER
     * authorisation, so it can never serve an unauthorised caller.
     */
    private collectExecutionRecords;
    private readExecutionRecords;
}
