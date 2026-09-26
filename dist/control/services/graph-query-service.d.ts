import { GraphQueryOptions, WorkforceGraphProjection } from "../../contracts/graph.js";
import { ControlPlaneContext } from "../index.js";
import { OperatorPrincipal } from "../../contracts/index.js";
export declare class GraphQueryService {
    private readonly ctx;
    private readonly projectionService;
    constructor(ctx: ControlPlaneContext);
    getWorkforceGraph(principal: OperatorPrincipal, options: GraphQueryOptions): WorkforceGraphProjection | undefined;
}
