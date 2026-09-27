import { apiRequest } from "../../../api/client";
import type { GraphMode, WorkforceGraphProjection, WorkforceGraphUnchanged } from "../../../../../contracts/graph";

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
export function assertProjection(
  value: unknown,
  expected?: { projectId: string; mode: GraphMode | undefined },
): WorkforceGraphProjection {
  const v = value as Partial<WorkforceGraphProjection> | null;
  const ok =
    typeof v === "object" &&
    v !== null &&
    typeof v.projectId === "string" &&
    // A snapshot is bound to what was asked: another project's (or mode's) reply is rejected.
    (expected === undefined || v.projectId === expected.projectId) &&
    (expected?.mode === undefined || v.mode === expected.mode) &&
    (expected === undefined || (typeof v.revision === "number" && typeof v.generatedAt === "string")) &&
    Array.isArray(v.nodes) &&
    Array.isArray(v.edges) &&
    v.nodes.every((n) => typeof n === "object" && n !== null && typeof n.id === "string" && typeof n.type === "string") &&
    v.edges.every((e) => typeof e === "object" && e !== null && typeof e.source === "string" && typeof e.target === "string");
  if (!ok) throw new Error("The graph service returned an unexpected response.");
  return v as WorkforceGraphProjection;
}

function graphUrl(projectId: string, options: FetchGraphOptions, since?: number): string {
  const query = new URLSearchParams();
  if (options.mode !== undefined) query.append("mode", options.mode);
  if (options.depth !== undefined) query.append("depth", String(options.depth));
  if (options.maxNodes !== undefined) query.append("maxNodes", String(options.maxNodes));
  if (options.rootNodeId !== undefined) query.append("rootNodeId", options.rootNodeId);
  if (since !== undefined) query.append("since", String(since));
  const qs = query.toString();
  return `${API}/projects/${encodeURIComponent(projectId)}/graph${qs ? `?${qs}` : ""}`;
}

/** Read-only: GET /api/projects/:id/graph. Only options that are provided are sent. */
export async function fetchWorkforceGraph(
  projectId: string,
  options: FetchGraphOptions = {},
  accessToken?: string | null,
): Promise<WorkforceGraphProjection> {
  const body = await apiRequest<unknown>(graphUrl(projectId, options), { method: "GET", accessToken });
  return assertProjection(body, { projectId, mode: options.mode });
}

/**
 * The reply proves only that the server's revision is still `expectedRevision`. It is bound to the
 * project and mode that were asked for: a reply for anything else is rejected, not trusted.
 */
export function assertUnchanged(
  value: unknown,
  expected: { projectId: string; mode: GraphMode | undefined; revision: number },
): WorkforceGraphUnchanged {
  const v = value as Partial<WorkforceGraphUnchanged> | null;
  const ok =
    typeof v === "object" &&
    v !== null &&
    v.unchanged === true &&
    v.projectId === expected.projectId &&
    (expected.mode === undefined || v.mode === expected.mode) &&
    v.revision === expected.revision &&
    typeof v.generatedAt === "string";
  if (!ok) throw new Error("The graph service returned an unexpected response.");
  return v as WorkforceGraphUnchanged;
}

/**
 * Conditional live poll: GET …/graph?since=<revision>. The server always authorises and projects;
 * `since` only lets it answer "unchanged" without resending the graph. Resolves to either a full
 * (validated) projection or a validated `unchanged` proof.
 */
export async function pollWorkforceGraph(
  projectId: string,
  options: FetchGraphOptions,
  accessToken: string | null | undefined,
  sinceRevision: number,
): Promise<WorkforceGraphProjection | WorkforceGraphUnchanged> {
  const body = await apiRequest<unknown>(graphUrl(projectId, options, sinceRevision), { method: "GET", accessToken });
  if (typeof body === "object" && body !== null && (body as { unchanged?: unknown }).unchanged === true) {
    return assertUnchanged(body, { projectId, mode: options.mode, revision: sinceRevision });
  }
  return assertProjection(body, { projectId, mode: options.mode });
}
