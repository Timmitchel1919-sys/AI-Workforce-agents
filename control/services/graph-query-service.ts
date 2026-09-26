import { WorkforceGraphProjectionService } from "../../core/orchestrator/graph-projection.js";
import { GraphQueryOptions, WorkforceGraphProjection } from "../../contracts/graph.js";
import { ControlPlaneContext } from "../index.js";
import { 
  OperatorPrincipal, 
  operatorCanAccessProject, 
  validateOperatorPrincipal, 
  operatorCan, 
  PermissionDeniedError 
} from "../../contracts/index.js";

export class GraphQueryService {
  private readonly projectionService: WorkforceGraphProjectionService;

  constructor(private readonly ctx: ControlPlaneContext) {
    this.projectionService = new WorkforceGraphProjectionService(
      ctx.projects,
      ctx.agents,
      ctx.tasks,
      ctx.softwareFactory!,
    );
  }

  public getWorkforceGraph(
    principal: OperatorPrincipal,
    options: GraphQueryOptions,
  ): WorkforceGraphProjection | undefined {
    validateOperatorPrincipal(principal);
    if (!operatorCan(principal, "view")) {
      throw new PermissionDeniedError("Operator cannot view Control Center.");
    }
    if (!operatorCanAccessProject(principal, options.projectId)) {
      return undefined; // Hide existence of the project
    }
    
    // Bounds checking
    const depth = options.depth !== undefined ? Math.min(options.depth, 5) : undefined;
    const boundedOptions = { ...options, depth, maxNodes: Math.min(options.maxNodes || 250, 500) };

    return this.projectionService.getProjection(boundedOptions);
  }
}
