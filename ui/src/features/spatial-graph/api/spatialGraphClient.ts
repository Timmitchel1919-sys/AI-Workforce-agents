import { apiRequest } from "../../../api/client";
import type { GraphMode, WorkforceGraphProjection } from "../../../../../contracts/graph";

export interface FetchGraphOptions {
  mode?: GraphMode;
  depth?: number;
  maxNodes?: number;
  rootNodeId?: string;
}

/** Read-only: GET /projects/:id/graph. Only options that are provided are sent. */
export async function fetchWorkforceGraph(
  projectId: string,
  options: FetchGraphOptions = {},
): Promise<WorkforceGraphProjection> {
  const query = new URLSearchParams();
  if (options.mode !== undefined) query.append("mode", options.mode);
  if (options.depth !== undefined) query.append("depth", String(options.depth));
  if (options.maxNodes !== undefined) query.append("maxNodes", String(options.maxNodes));
  if (options.rootNodeId !== undefined) query.append("rootNodeId", options.rootNodeId);
  const qs = query.toString();
  return apiRequest<WorkforceGraphProjection>(`/projects/${encodeURIComponent(projectId)}/graph${qs ? `?${qs}` : ""}`);
}
