import { WorkforceGraphProjectionService } from "../../core/orchestrator/graph-projection.js";
import {
  GRAPH_MODES,
  type GraphMode,
  type GraphQueryOptions,
  type WorkforceGraphProjection,
} from "../../contracts/graph.js";
import type { ControlPlaneContext } from "../index.js";
import {
  OperatorPrincipal,
  operatorCanAccessProject,
  validateOperatorPrincipal,
  operatorCan,
  PermissionDeniedError,
  ValidationError,
} from "../../contracts/index.js";

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

function parseBoundedInt(
  params: URLSearchParams,
  key: string,
): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw === "") return undefined;
  if (!/^\d{1,6}$/.test(raw)) {
    throw new ValidationError(`${key} must be a positive integer`);
  }
  const value = Number(raw);
  if (value < 1) throw new ValidationError(`${key} must be a positive integer`);
  return value;
}

/**
 * Parses and validates the graph query string. Numeric bounds are clamped
 * later by the projection service; here we only reject malformed input.
 */
export function parseGraphQueryParams(
  projectId: string,
  params: URLSearchParams,
): GraphQueryOptions {
  const options: GraphQueryOptions = { projectId };
  const mode = params.get("mode");
  if (mode !== null && mode !== "") {
    const upper = mode.toUpperCase();
    if (!(GRAPH_MODES as readonly string[]).includes(upper)) {
      throw new ValidationError(`unsupported graph mode: ${mode}`);
    }
    options.mode = upper as GraphMode;
  }
  const depth = parseBoundedInt(params, "depth");
  if (depth !== undefined) options.depth = depth;
  const maxNodes = parseBoundedInt(params, "maxNodes");
  if (maxNodes !== undefined) options.maxNodes = maxNodes;
  const rootNodeId = params.get("rootNodeId");
  if (rootNodeId !== null && rootNodeId !== "") {
    if (!ID_PATTERN.test(rootNodeId)) {
      throw new ValidationError("rootNodeId is malformed");
    }
    options.rootNodeId = rootNodeId;
  }
  return options;
}

export class GraphQueryService {
  private readonly projectionService: WorkforceGraphProjectionService;

  constructor(ctx: ControlPlaneContext) {
    this.projectionService = new WorkforceGraphProjectionService(
      ctx.projects,
      ctx.agents,
      ctx.tasks,
      ctx.softwareFactory,
      {
        agentOps: ctx.agentOps,
        workflows: ctx.workflows,
        ...(ctx.environments ? { environments: ctx.environments } : {}),
        ...(ctx.knowledge ? { knowledge: ctx.knowledge } : {}),
      },
    );
  }

  /**
   * Authorisation happens here, before any projection work: an operator who
   * cannot access the project gets `undefined` (indistinguishable from a
   * missing project). The projection service re-clamps all bounds.
   */
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
    return this.projectionService.getProjection(options);
  }
}
