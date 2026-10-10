import {
  EMPTY_FILTERS, type Conflict, type GraphEdge, type GraphNode, type MemoryFilters, type MemoryFull, type MemorySummary, type MemoryType, type SearchHit,
} from "../types";

export const ALL_PROJECTS = "all";

const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as (keyof MemoryFilters)[];

/** Filters live in the URL so a search is linkable and survives navigating to a memory and back. */
export function filtersFromParams(params: URLSearchParams): MemoryFilters {
  const filters: MemoryFilters = { ...EMPTY_FILTERS };
  for (const key of FILTER_KEYS) filters[key] = params.get(key) ?? "";
  return filters;
}

/** Keeps only the project scope of a query string (used for links to other tabs). */
export function projectSearch(search: string): string {
  const project = new URLSearchParams(search).get("project");
  return project ? `?project=${encodeURIComponent(project)}` : "";
}

export function applyFilterChange(params: URLSearchParams, key: keyof MemoryFilters, value: string): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}

export function clearFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of FILTER_KEYS) next.delete(key);
  return next;
}

export function hasActiveFilters(filters: MemoryFilters): boolean {
  return FILTER_KEYS.some((key) => key !== "q" && filters[key] !== "");
}

export function isHit(memory: MemorySummary | SearchHit): memory is SearchHit {
  return "score" in memory && typeof (memory as SearchHit).score === "number";
}

export function splitTags(text: string): string[] {
  return [...new Set(text.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
}

export function groupByType(memories: readonly MemorySummary[]): [MemoryType, MemorySummary[]][] {
  const groups = new Map<MemoryType, MemorySummary[]>();
  for (const memory of memories) {
    const list = groups.get(memory.type) ?? [];
    list.push(memory);
    groups.set(memory.type, list);
  }
  return [...groups.entries()];
}

/** Critical and architectural memory is never deleted; it must be superseded (the server enforces the same rule). */
export function deleteBlockReason(memory: Pick<MemoryFull, "status" | "importance" | "type">): "status" | "protected" | null {
  if (memory.importance === "CRITICAL" || memory.type === "ARCHITECTURAL") return "protected";
  if (memory.status !== "DRAFT" && memory.status !== "ARCHIVED" && memory.status !== "REVOKED") return "status";
  return null;
}

export function budgetPercent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function otherMemory(conflict: Conflict, memoryId: string): string {
  return conflict.memoryIds[0] === memoryId ? conflict.memoryIds[1] : conflict.memoryIds[0];
}

/* ---------------------------------------------------------------- graph */

export interface PlacedNode extends GraphNode { x: number; y: number; level: number }

export const RING_STEP = 130;
const MIN_ARC = 78;

/**
 * Deterministic concentric layout: the project node (or, failing that, the best connected node) sits in the
 * centre, each ring holds the nodes one hop further out, and unreachable nodes form the outermost ring.
 */
export function layoutGraph(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): PlacedNode[] {
  if (nodes.length === 0) return [];
  const ids = new Set(nodes.map((n) => n.id));
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const root =
    sorted.find((n) => n.kind === "PROJECT") ??
    [...sorted].sort((a, b) => (adjacency.get(b.id)?.length ?? 0) - (adjacency.get(a.id)?.length ?? 0))[0]!;

  const level = new Map<string, number>([[root.id, 0]]);
  const queue = [root.id];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of [...(adjacency.get(current) ?? [])].sort()) {
      if (!level.has(next)) {
        level.set(next, (level.get(current) ?? 0) + 1);
        queue.push(next);
      }
    }
  }
  const maxLevel = Math.max(...level.values());
  for (const node of sorted) if (!level.has(node.id)) level.set(node.id, maxLevel + 1);

  const rings = new Map<number, GraphNode[]>();
  for (const node of sorted) {
    const l = level.get(node.id) ?? 0;
    rings.set(l, [...(rings.get(l) ?? []), node]);
  }
  const placed: PlacedNode[] = [];
  for (const [l, members] of [...rings.entries()].sort((a, b) => a[0] - b[0])) {
    if (l === 0) {
      placed.push({ ...members[0]!, x: 0, y: 0, level: 0 });
      continue;
    }
    const radius = Math.max(l * RING_STEP, (members.length * MIN_ARC) / (2 * Math.PI));
    members.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index / members.length) * 2 * Math.PI + (l % 2 === 0 ? Math.PI / members.length : 0);
      placed.push({ ...node, x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius), level: l });
    });
  }
  return placed;
}

export function visibleEdges(edges: readonly GraphEdge[], hiddenTypes: ReadonlySet<string>): GraphEdge[] {
  return edges.filter((edge) => !hiddenTypes.has(edge.type));
}

export interface NodeRelation { edge: GraphEdge; direction: "in" | "out"; neighborId: string }

export function relationsOf(nodeId: string, edges: readonly GraphEdge[]): NodeRelation[] {
  const out: NodeRelation[] = [];
  for (const edge of edges) {
    if (edge.from === nodeId) out.push({ edge, direction: "out", neighborId: edge.to });
    else if (edge.to === nodeId) out.push({ edge, direction: "in", neighborId: edge.from });
  }
  return out;
}

export function matchNodes(nodes: readonly GraphNode[], query: string): GraphNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return nodes.filter((node) => node.label.toLowerCase().includes(needle) || node.id.toLowerCase().includes(needle));
}

export function truncateLabel(label: string, max = 22): string {
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}

export interface View { x: number; y: number; k: number }
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 3;
export const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
export const GRAPH_WIDTH = 760;
export const GRAPH_HEIGHT = 520;

/** View that places the given point at the centre of the viewport. */
export function centerOn(x: number, y: number, k: number): View {
  return { x: GRAPH_WIDTH / 2 - x * k, y: GRAPH_HEIGHT / 2 - y * k, k };
}

export const INITIAL_VIEW: View = centerOn(0, 0, 1);

export function zoomAround(view: View, factor: number): View {
  const k = clampZoom(view.k * factor);
  const cx = GRAPH_WIDTH / 2;
  const cy = GRAPH_HEIGHT / 2;
  const ratio = k / view.k;
  return { k, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio };
}
