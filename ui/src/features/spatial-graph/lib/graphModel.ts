import type {
  WorkforceGraphEdge,
  WorkforceGraphNode,
  WorkforceGraphNodeType,
  WorkforceGraphProjection,
} from "../../../../../contracts/graph";

/** Pure graph shape used by every lib helper (a projection minus its envelope). */
export interface GraphData {
  nodes: readonly WorkforceGraphNode[];
  edges: readonly WorkforceGraphEdge[];
}

/** "ALL", one of the grouped filters below, or any other node type present. */
export type FilterId = string;
export const ALL_FILTER: FilterId = "ALL";

/** Fixed, always-offered filter groups. Other node types get their own filter when present. */
export const FILTER_GROUPS: Readonly<Record<string, readonly WorkforceGraphNodeType[]>> = {
  PROJECT: ["PROJECT"],
  AGENT: ["AGENT"],
  TASK: ["TASK"],
  WORKFLOW: ["WORKFLOW", "WORKFLOW_STEP"],
  ENVIRONMENT: ["ENVIRONMENT", "ENVIRONMENT_ROUTER"],
};
const FIXED_FILTER_ORDER = ["PROJECT", "AGENT", "TASK", "WORKFLOW", "ENVIRONMENT"] as const;

function typesFor(filter: FilterId): readonly string[] {
  return FILTER_GROUPS[filter] ?? [filter];
}

export function nodeMatchesFilter(node: WorkforceGraphNode, filter: FilterId): boolean {
  return filter === ALL_FILTER || typesFor(filter).includes(node.type);
}

export interface FilterOption {
  id: FilterId;
  count: number;
}

/** All + the five fixed groups + every other node type present (sorted, deterministic). */
export function availableFilters(nodes: readonly WorkforceGraphNode[]): FilterOption[] {
  const groupedTypes = new Set<string>(Object.values(FILTER_GROUPS).flat());
  const extra = Array.from(new Set(nodes.map((n) => n.type).filter((t) => !groupedTypes.has(t)))).sort();
  const ids: FilterId[] = [ALL_FILTER, ...FIXED_FILTER_ORDER, ...extra];
  return ids.map((id) => ({ id, count: nodes.filter((n) => nodeMatchesFilter(n, id)).length }));
}

/** Keep only edges whose endpoints are both in the node set. */
export function edgesBetween(
  edges: readonly WorkforceGraphEdge[],
  nodeIds: ReadonlySet<string>,
): WorkforceGraphEdge[] {
  return edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
}

export function subgraph(graph: GraphData, nodeIds: ReadonlySet<string>): GraphData {
  const nodes = graph.nodes.filter((n) => nodeIds.has(n.id));
  const present = new Set(nodes.map((n) => n.id));
  return { nodes, edges: edgesBetween(graph.edges, present) };
}

/** Client-side filter; an edge is visible only when both endpoints are. */
export function filterGraph(graph: GraphData, filter: FilterId): GraphData {
  if (filter === ALL_FILTER) return subgraph(graph, new Set(graph.nodes.map((n) => n.id)));
  return subgraph(graph, new Set(graph.nodes.filter((n) => nodeMatchesFilter(n, filter)).map((n) => n.id)));
}

/** Ids of nodes directly connected (either direction) to `id`, excluding itself. */
export function neighbourIds(graph: GraphData, id: string): Set<string> {
  const out = new Set<string>();
  const known = new Set(graph.nodes.map((n) => n.id));
  for (const e of graph.edges) {
    if (e.source === id && known.has(e.target)) out.add(e.target);
    else if (e.target === id && known.has(e.source)) out.add(e.source);
  }
  out.delete(id);
  return out;
}

/** Only the node and its direct neighbours (plus edges among them). */
export function isolate(graph: GraphData, id: string, alsoExpanded: readonly string[] = []): GraphData {
  if (!graph.nodes.some((n) => n.id === id)) return graph;
  const keep = new Set<string>([id]);
  for (const root of [id, ...alsoExpanded]) {
    if (!graph.nodes.some((n) => n.id === root)) continue;
    keep.add(root);
    for (const n of neighbourIds(graph, root)) keep.add(n);
  }
  return subgraph(graph, keep);
}

/** Edges touching a node. */
export function incidentEdges(graph: GraphData, id: string): WorkforceGraphEdge[] {
  return graph.edges.filter((e) => e.source === id || e.target === id);
}

export function toGraphData(projection: WorkforceGraphProjection): GraphData {
  return { nodes: projection.nodes, edges: projection.edges };
}

/** Case-insensitive label search over the given nodes; empty query matches nothing (null = no search). */
export function matchNodes(nodes: readonly WorkforceGraphNode[], query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (q === "") return null;
  return new Set(nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id));
}
