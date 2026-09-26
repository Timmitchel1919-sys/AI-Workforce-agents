import { apiRequest } from "../../../api/client";
import type { GraphMode, WorkforceGraphProjection } from "../../../../../contracts/graph";

/** Control Plane routes live under /api (Hosting rewrites /api/** to the function). */
const API = "/api";

export interface FetchGraphOptions {
  mode?: GraphMode;
  depth?: number;
  maxNodes?: number;
  rootNodeId?: string;
}

/**
 * The response crosses a trust boundary: a misrouted request can return HTML with a 200 (the
 * SPA rewrite), and a bad payload must surface as an error state, never crash the renderer.
 */
export function assertProjection(value: unknown): WorkforceGraphProjection {
  const v = value as Partial<WorkforceGraphProjection> | null;
  const ok =
    typeof v === "object" &&
    v !== null &&
    typeof v.projectId === "string" &&
    Array.isArray(v.nodes) &&
    Array.isArray(v.edges) &&
    v.nodes.every((n) => typeof n === "object" && n !== null && typeof n.id === "string" && typeof n.type === "string") &&
    v.edges.every((e) => typeof e === "object" && e !== null && typeof e.source === "string" && typeof e.target === "string");
  if (!ok) throw new Error("The graph service returned an unexpected response.");
  return v as WorkforceGraphProjection;
}

/** Read-only: GET /api/projects/:id/graph. Only options that are provided are sent. */
export async function fetchWorkforceGraph(
  projectId: string,
  options: FetchGraphOptions = {},
  accessToken?: string | null,
): Promise<WorkforceGraphProjection> {
  const query = new URLSearchParams();
  if (options.mode !== undefined) query.append("mode", options.mode);
  if (options.depth !== undefined) query.append("depth", String(options.depth));
  if (options.maxNodes !== undefined) query.append("maxNodes", String(options.maxNodes));
  if (options.rootNodeId !== undefined) query.append("rootNodeId", options.rootNodeId);
  const qs = query.toString();
  const body = await apiRequest<unknown>(`${API}/projects/${encodeURIComponent(projectId)}/graph${qs ? `?${qs}` : ""}`, {
    method: "GET",
    accessToken,
  });
  return assertProjection(body);
}
