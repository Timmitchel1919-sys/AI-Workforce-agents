import type { GraphMode, WorkforceGraphEdge, WorkforceGraphNode } from "../../../../../contracts/graph";

export type Vec3 = [number, number, number];

/** Preferred ring radius per node type. Unknown types are appended deterministically. */
const LAYER_RADIUS: Readonly<Record<string, number>> = {
  PROJECT: 0,
  CONTROL_PLANE: 0,
  PROGRAM: 10,
  WORKSTREAM: 13,
  WORKFLOW: 16,
  WORKFLOW_STEP: 19,
  AGENT: 22,
  ENVIRONMENT: 26,
  ENVIRONMENT_ROUTER: 28,
  KNOWLEDGE_SOURCE: 32,
  TASK: 36,
};
const UNKNOWN_START = 42;
const LAYER_STEP = 5;
/** Minimum arc distance between neighbours on a ring, so big rings do not overlap. */
const MIN_SPACING = 3.2;

/** FNV-1a 32-bit — stable, dependency-free string hash. */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Spacing of the layered (dependency-depth) layouts. */
const LAYER_GAP = 9;
const SLOT_GAP = 5;
const LAYERED_Y: Readonly<Record<string, number>> = { WORKFLOW_STEP: -14, TASK: -8 };

/**
 * Longest-dependency-chain depth per node (0 = depends on nothing in the set). Cycle-safe:
 * an edge that closes a cycle is ignored, and ids are visited in sorted order, so the
 * result is deterministic. `source DEPENDS_ON target` means target sits at a lower depth.
 */
export function dependencyDepths(
  ids: readonly string[],
  edges: readonly WorkforceGraphEdge[],
): Map<string, number> {
  const set = new Set(ids);
  const deps = new Map<string, string[]>();
  for (const e of edges) {
    if (e.type !== "DEPENDS_ON" || !set.has(e.source) || !set.has(e.target) || e.source === e.target) continue;
    const list = deps.get(e.source);
    if (list) list.push(e.target);
    else deps.set(e.source, [e.target]);
  }
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    visiting.add(id);
    let d = 0;
    for (const dep of (deps.get(id) ?? []).slice().sort(compareIds)) {
      if (visiting.has(dep)) continue; // back edge of a cycle
      d = Math.max(d, visit(dep) + 1);
    }
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const id of ids.slice().sort(compareIds)) visit(id);
  return depth;
}

export interface LayoutOptions {
  mode?: GraphMode;
}

/**
 * Deterministic layout: the same nodes always produce the same positions, regardless
 * of input order (nodes are sorted by id within their type ring; the vertical jitter is
 * derived from a hash of the id). No randomness.
 *
 * - CONTROL_PLANE is the central hub (origin); PROJECT moves to the first ring when one exists.
 * - WORKFLOW_STEP nodes (and TASK nodes in DEPENDENCY mode) are laid out in dependency-depth layers.
 */
export function computeLayout(
  nodes: readonly WorkforceGraphNode[],
  edges: readonly WorkforceGraphEdge[] = [],
  options: LayoutOptions = {},
): Map<string, Vec3> {
  const layeredTypes = new Set<string>(["WORKFLOW_STEP"]);
  if (options.mode === "DEPENDENCY") layeredTypes.add("TASK");
  const hasHub = nodes.some((n) => n.type === "CONTROL_PLANE");

  const groups = new Map<string, WorkforceGraphNode[]>();
  for (const n of nodes) {
    const g = groups.get(n.type);
    if (g) g.push(n);
    else groups.set(n.type, [n]);
  }

  const unknownTypes = Array.from(groups.keys())
    .filter((t) => LAYER_RADIUS[t] === undefined)
    .sort();

  const positions = new Map<string, Vec3>();
  for (const type of Array.from(groups.keys()).sort()) {
    const group = (groups.get(type) ?? []).slice().sort((a, b) => compareIds(a.id, b.id));
    const count = group.length;

    if (layeredTypes.has(type)) {
      const depths = dependencyDepths(group.map((n) => n.id), edges);
      const layers = new Map<number, WorkforceGraphNode[]>();
      for (const n of group) {
        const d = depths.get(n.id) ?? 0;
        const l = layers.get(d);
        if (l) l.push(n);
        else layers.set(d, [n]);
      }
      const maxDepth = Math.max(...layers.keys());
      for (const [d, members] of layers) {
        members.forEach((n, i) => {
          const x = (d - maxDepth / 2) * LAYER_GAP;
          const z = (i - (members.length - 1) / 2) * SLOT_GAP;
          positions.set(n.id, [x, LAYERED_Y[type] ?? -8, z]);
        });
      }
      continue;
    }

    let base = LAYER_RADIUS[type];
    if (base === undefined) base = UNKNOWN_START + unknownTypes.indexOf(type) * LAYER_STEP;
    if (type === "PROJECT" && hasHub) base = 8;
    // The centre ring holds one node at the origin; several spread on a small ring.
    const needed = (count * MIN_SPACING) / (2 * Math.PI);
    const radius = base === 0 && count === 1 ? 0 : Math.max(base, needed, base === 0 ? 4 : 0);

    group.forEach((node, i) => {
      if (radius === 0) {
        positions.set(node.id, [0, 0, 0]);
        return;
      }
      const angle = (i / count) * Math.PI * 2;
      const jitter = (hashString(node.id) / 0xffffffff - 0.5) * (radius / 2);
      positions.set(node.id, [Math.cos(angle) * radius, jitter, Math.sin(angle) * radius]);
    });
  }
  return positions;
}
