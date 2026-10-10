/**
 * DAG layout for the Software Factory program view. A tiny, dependency-free
 * layering pass (longest-path, Kahn-based) that turns the backend's
 * `graph.nodes` + `graph.edges` into node rectangles and edge endpoints for
 * an inline SVG. No graph library: the repo deliberately has none.
 */
import type { GraphEdge } from "../../features/softwareFactory";

export const DAG_NODE_WIDTH = 180;
export const DAG_NODE_HEIGHT = 64;
export const DAG_GAP_X = 80;
export const DAG_GAP_Y = 28;
export const DAG_PADDING = 24;

export interface DagNodeLayout {
  id: string;
  x: number;
  y: number;
}

export interface DagEdgeLayout {
  from: string;
  to: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface DagLayout {
  nodes: readonly DagNodeLayout[];
  edges: readonly DagEdgeLayout[];
  width: number;
  height: number;
}

export function layoutGraph(nodes: readonly { id: string }[], edges: readonly GraphEdge[]): DagLayout {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    children.set(node.id, []);
  }
  for (const edge of edges) {
    if (inDegree.has(edge.from) && inDegree.has(edge.to)) {
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
      children.get(edge.from)?.push(edge.to);
    }
  }

  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const id of nodes.map((n) => n.id)) {
    if ((inDegree.get(id) ?? 0) === 0) {
      layer.set(id, 0);
      queue.push(id);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++]!;
    const current = layer.get(id) ?? 0;
    for (const child of children.get(id) ?? []) {
      const next = current + 1;
      layer.set(child, Math.max(layer.get(child) ?? 0, next));
      inDegree.set(child, (inDegree.get(child) ?? 1) - 1);
      if ((inDegree.get(child) ?? 0) === 0) queue.push(child);
    }
  }

  // Defensive: any node left out (input contained a cycle) still gets a slot.
  let fallback = -1;
  for (const node of nodes) {
    if (!layer.has(node.id)) {
      fallback += 1;
      layer.set(node.id, Math.max(...layer.values(), 0) + 1 + fallback);
    }
  }

  const byLayer = new Map<number, string[]>();
  for (const [id, at] of layer) {
    const list = byLayer.get(at) ?? [];
    list.push(id);
    byLayer.set(at, list);
  }
  const layers: string[][] = [...byLayer.keys()].sort((a, b) => a - b).map((at) => byLayer.get(at)!);

  const placed = new Map<string, DagNodeLayout>();
  layers.forEach((ids, at) => {
    ids.forEach((id, row) => {
      placed.set(id, {
        id,
        x: DAG_PADDING + at * (DAG_NODE_WIDTH + DAG_GAP_X),
        y: DAG_PADDING + row * (DAG_NODE_HEIGHT + DAG_GAP_Y),
      });
    });
  });

  const placedEdges: DagEdgeLayout[] = [];
  for (const edge of edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) continue;
    placedEdges.push({
      from: edge.from,
      to: edge.to,
      fromX: from.x + DAG_NODE_WIDTH,
      fromY: from.y + DAG_NODE_HEIGHT / 2,
      toX: to.x,
      toY: to.y + DAG_NODE_HEIGHT / 2,
    });
  }

  const maxRows = Math.max(...layers.map((ids) => ids.length), 1);
  const width = DAG_PADDING * 2 + layers.length * DAG_NODE_WIDTH + (layers.length - 1) * DAG_GAP_X;
  const height = DAG_PADDING * 2 + maxRows * DAG_NODE_HEIGHT + (maxRows - 1) * DAG_GAP_Y;

  return { nodes: [...placed.values()], edges: placedEdges, width, height };
}