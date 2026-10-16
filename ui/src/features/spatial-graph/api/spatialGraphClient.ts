import { apiRequest } from "../../../api/client";
import {
  GRAPH_LIMITS,
  GRAPH_MODES,
  GRAPH_OPERATIONAL_STATES,
  type GraphMode,
  type WorkforceGraphProjection,
  type WorkforceGraphUnchanged,
} from "../../../../../contracts/graph";

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
  const nodeTypes = new Set([
    "PROJECT", "PROGRAM", "WORKSTREAM", "TASK", "AGENT", "CAPABILITY", "MODEL", "ENVIRONMENT", "RUNNER",
    "EXECUTION_PLAN", "EXECUTION_SESSION", "WORKSPACE", "WRITE_SCOPE", "CHANGESET", "VERIFICATION", "REVIEW",
    "APPROVAL", "REPOSITORY", "COMMIT", "ARTIFACT", "DEPLOYMENT", "CONTROL_PLANE", "WORKFLOW", "WORKFLOW_STEP",
    "ENVIRONMENT_ROUTER", "KNOWLEDGE_SOURCE",
  ]);
  const edgeTypes = new Set([
    "CONTAINS", "HAS_TASK", "DEPENDS_ON", "ASSIGNED_TO", "REQUIRES", "QUALIFIED_FOR", "ROUTED_TO", "RUNS_ON",
    "HOLDS_LEASE", "OWNS_SCOPE", "USES_MODEL", "EXECUTES", "PRODUCES", "VERIFIED_BY", "REVIEWED_BY",
    "REQUIRES_APPROVAL", "COMMITTED_AS", "PUSHED_TO", "DEPLOYED_TO", "PRODUCES_ARTIFACT", "BELONGS_TO",
    "PART_OF", "EXECUTES_IN", "PARTICIPATES_IN", "REVIEWS", "REFERENCES", "DOCUMENTS", "DESCRIBES", "USED_BY",
  ]);
  const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
    typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);
  const isScalarRecord = (candidate: unknown, allowUndefined: boolean): boolean =>
    candidate === undefined || (isRecord(candidate) && Object.values(candidate).every((item) =>
      typeof item === "string" || typeof item === "number" || typeof item === "boolean" || (allowUndefined && item === undefined)
    ));
  const nodes = Array.isArray(v?.nodes) ? v.nodes : [];
  const edges = Array.isArray(v?.edges) ? v.edges : [];
  const nodeIds = new Set(nodes.map((node) => isRecord(node) && typeof node.id === "string" ? node.id : ""));
  const edgeIds = new Set(edges.map((edge) => isRecord(edge) && typeof edge.id === "string" ? edge.id : ""));
  const ok =
    typeof v === "object" &&
    v !== null &&
    typeof v.projectId === "string" &&
    v.projectId.length > 0 &&
    // A snapshot is bound to what was asked: another project's (or mode's) reply is rejected.
    (expected === undefined || v.projectId === expected.projectId) &&
    GRAPH_MODES.includes(v.mode as GraphMode) &&
    (expected?.mode === undefined || v.mode === expected.mode) &&
    Number.isSafeInteger(v.revision) && (v.revision ?? -1) >= 0 &&
    typeof v.generatedAt === "string" && !Number.isNaN(Date.parse(v.generatedAt)) &&
    typeof v.truncated === "boolean" &&
    isRecord(v.appliedLimits) && Number.isInteger(v.appliedLimits.depth) && Number.isInteger(v.appliedLimits.maxNodes) && Number.isInteger(v.appliedLimits.maxEdges) &&
    Array.isArray(v.nodes) && nodes.length <= GRAPH_LIMITS.maxNodes && nodeIds.size === nodes.length && !nodeIds.has("") &&
    Array.isArray(v.edges) && edges.length <= GRAPH_LIMITS.maxEdges && edgeIds.size === edges.length && !edgeIds.has("") &&
    nodes.every((n) => isRecord(n) && n.projectId === v.projectId && nodeTypes.has(String(n.type)) &&
      typeof n.label === "string" && typeof n.status === "string" && GRAPH_OPERATIONAL_STATES.includes(n.state as never) &&
      typeof n.referenceId === "string" && isScalarRecord(n.metadata, true)) &&
    edges.every((e) => isRecord(e) && edgeTypes.has(String(e.type)) && typeof e.source === "string" && nodeIds.has(e.source) &&
      typeof e.target === "string" && nodeIds.has(e.target) && (e.status === undefined || typeof e.status === "string") &&
      isScalarRecord(e.metadata, false));
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
