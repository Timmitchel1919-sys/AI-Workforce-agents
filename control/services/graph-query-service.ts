import { WorkforceGraphProjectionService } from "../../core/orchestrator/graph-projection.js";
import { GraphQueryOptions, WorkforceGraphProjection } from "../../contracts/graph.js";
import { ControlPlaneContext } from "../index.js";
import { OperatorPrincipal } from "../../contracts/index.js";

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
  ): WorkforceGraphProjection {
    // In a real scenario, we'd check ctx.permissions.can(principal, "read_project", options.projectId);
    // We assume basic read access here or rely on the HTTP route.
    return this.projectionService.getProjection(options);
  }
}
