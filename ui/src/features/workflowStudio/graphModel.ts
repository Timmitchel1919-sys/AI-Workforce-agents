/**
 * Pure editor model for the Workflow Studio: node/edge edits, undo/redo,
 * auto-layout, version diff, and a FAST client-side validation that only
 * improves feedback. The Control Plane re-validates every save and publish;
 * nothing here is a security decision.
 */
import type { StudioCatalog, ValidationIssue, WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowNodeKind } from "./studioClient";

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 64;
const COL = 240;
const ROW = 100;

let counter = 0;
export function newId(prefix: string, taken: ReadonlySet<string>): string {
  let id: string;
  do {
    counter += 1;
    id = `${prefix}-${counter.toString(36)}`;
  } while (taken.has(id));
  return id;
}

export function emptyGraph(): WorkflowGraph {
  return {
    nodes: [
      { id: "start", kind: "trigger", label: "Start", config: {}, position: { x: 40, y: 80 } },
      { id: "end", kind: "terminal", label: "Done", config: {}, position: { x: 520, y: 80 } },
    ],
    edges: [],
  };
}

export function addNode(graph: WorkflowGraph, kind: WorkflowNodeKind, label: string): { graph: WorkflowGraph; id: string } {
  const taken = new Set(graph.nodes.map((n) => n.id));
  const id = newId(kind.replace("_", "-"), taken);
  const maxX = graph.nodes.reduce((m, n) => Math.max(m, n.position.x), 0);
  const node: WorkflowNode = {
    id,
    kind,
    label,
    config: {},
    position: { x: graph.nodes.length ? maxX + COL : 40, y: 80 },
  };
  return { graph: { ...graph, nodes: [...graph.nodes, node] }, id };
}

export function updateNode(graph: WorkflowGraph, id: string, patch: Partial<WorkflowNode>): WorkflowGraph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

export function moveNodes(graph: WorkflowGraph, ids: ReadonlySet<string>, dx: number, dy: number): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      ids.has(n.id) ? { ...n, position: { x: Math.round(n.position.x + dx), y: Math.round(n.position.y + dy) } } : n,
    ),
  };
}

export function removeNodes(graph: WorkflowGraph, ids: ReadonlySet<string>): WorkflowGraph {
  return {
    nodes: graph.nodes.filter((n) => !ids.has(n.id)),
    edges: graph.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to)),
  };
}

export type ConnectResult = { ok: true; graph: WorkflowGraph } | { ok: false; reason: "self" | "duplicate" | "missing" | "cycle" };

export function connect(graph: WorkflowGraph, from: string, to: string): ConnectResult {
  if (from === to) return { ok: false, reason: "self" };
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (!ids.has(from) || !ids.has(to)) return { ok: false, reason: "missing" };
  if (graph.edges.some((e) => e.from === from && e.to === to)) return { ok: false, reason: "duplicate" };
  if (reaches(graph, to, from)) return { ok: false, reason: "cycle" };
  const edge: WorkflowEdge = { id: newId("e", new Set(graph.edges.map((e) => e.id))), from, to };
  return { ok: true, graph: { ...graph, edges: [...graph.edges, edge] } };
}

export function removeEdge(graph: WorkflowGraph, edgeId: string): WorkflowGraph {
  return { ...graph, edges: graph.edges.filter((e) => e.id !== edgeId) };
}

function reaches(graph: WorkflowGraph, from: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of graph.edges) if (e.from === id) stack.push(e.to);
  }
  return false;
}

/** Longest-path layering, left → right. Deterministic. */
export function autoLayout(graph: WorkflowGraph): WorkflowGraph {
  const layer = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < graph.nodes.length; pass += 1) {
    let changed = false;
    for (const e of graph.edges) {
      const next = (layer.get(e.from) ?? 0) + 1;
      if (layer.has(e.to) && next > (layer.get(e.to) ?? 0)) {
        layer.set(e.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const rows = new Map<number, number>();
  const sorted = [...graph.nodes].sort((a, b) => (layer.get(a.id)! - layer.get(b.id)!) || a.id.localeCompare(b.id));
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of sorted) {
    const l = layer.get(n.id) ?? 0;
    const r = rows.get(l) ?? 0;
    rows.set(l, r + 1);
    positions.set(n.id, { x: 40 + l * COL, y: 40 + r * ROW });
  }
  return { ...graph, nodes: graph.nodes.map((n) => ({ ...n, position: positions.get(n.id)! })) };
}

export function bounds(graph: WorkflowGraph) {
  if (graph.nodes.length === 0) return { x: 0, y: 0, width: 600, height: 300 };
  const xs = graph.nodes.map((n) => n.position.x);
  const ys = graph.nodes.map((n) => n.position.y);
  const x = Math.min(...xs) - 40;
  const y = Math.min(...ys) - 40;
  return { x, y, width: Math.max(...xs) + NODE_WIDTH + 40 - x, height: Math.max(...ys) + NODE_HEIGHT + 40 - y };
}

/** Topological order for the accessible outline (falls back to id order on cycles). */
export function outlineOrder(graph: WorkflowGraph): WorkflowNode[] {
  const indeg = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) if (indeg.has(e.to)) indeg.set(e.to, indeg.get(e.to)! + 1);
  const ready = graph.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id).sort();
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const e of graph.edges.filter((x) => x.from === id)) {
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (indeg.get(e.to) === 0) ready.push(e.to);
    }
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const rest = graph.nodes.filter((n) => !order.includes(n.id)).map((n) => n.id).sort();
  return [...order, ...rest].map((id) => byId.get(id)!);
}

/** Client-side hints only (subset of the server rules). */
export function clientValidate(graph: WorkflowGraph, catalog?: StudioCatalog): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string, nodeId?: string) => issues.push({ code, severity: "error", message, nodeId });
  const triggers = graph.nodes.filter((n) => n.kind === "trigger");
  if (triggers.length !== 1) err(triggers.length ? "MULTIPLE_TRIGGERS" : "MISSING_TRIGGER", "");
  if (!graph.nodes.some((n) => n.kind === "terminal")) err("MISSING_TERMINAL", "");
  const reached = new Set<string>();
  const queue = triggers.slice(0, 1).map((t) => t.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const e of graph.edges) if (e.from === id) queue.push(e.to);
  }
  const usable = new Set(catalog?.agents.filter((a) => a.usableOnProject).map((a) => a.agentId) ?? []);
  for (const n of graph.nodes) {
    if (triggers.length && !reached.has(n.id)) err("UNREACHABLE", "", n.id);
    if (n.kind === "agent_task") {
      if (!n.config.taskType) err("MISSING_TASK_TYPE", "", n.id);
      if (!n.config.agentId && !n.config.capability) err("MISSING_AGENT_OR_CAPABILITY", "", n.id);
      if (catalog && n.config.agentId && !usable.has(n.config.agentId)) err("AGENT_UNQUALIFIED", "", n.id);
    }
    if (n.kind === "approval" && !n.config.approvalAction) err("INVALID_APPROVAL", "", n.id);
    if (n.kind === "terminal" && graph.edges.some((e) => e.from === n.id)) err("TERMINAL_HAS_OUTPUT", "", n.id);
    if (n.kind === "trigger" && graph.edges.some((e) => e.to === n.id)) err("TRIGGER_HAS_INPUT", "", n.id);
  }
  return issues;
}

export interface GraphDiff {
  added: string[];
  removed: string[];
  changed: string[];
  edgesAdded: number;
  edgesRemoved: number;
}

/** Semantic diff (positions ignored). */
export function diffGraphs(from: WorkflowGraph, to: WorkflowGraph): GraphDiff {
  const a = new Map(from.nodes.map((n) => [n.id, n]));
  const b = new Map(to.nodes.map((n) => [n.id, n]));
  const strip = (n: WorkflowNode) => JSON.stringify({ k: n.kind, l: n.label, d: n.description ?? "", c: n.config });
  const key = (e: WorkflowEdge) => `${e.from}->${e.to}`;
  const ea = new Set(from.edges.map(key));
  const eb = new Set(to.edges.map(key));
  return {
    added: [...b.keys()].filter((id) => !a.has(id)),
    removed: [...a.keys()].filter((id) => !b.has(id)),
    changed: [...b.keys()].filter((id) => a.has(id) && strip(a.get(id)!) !== strip(b.get(id)!)),
    edgesAdded: [...eb].filter((k) => !ea.has(k)).length,
    edgesRemoved: [...ea].filter((k) => !eb.has(k)).length,
  };
}

/* ---------------- undo / redo ---------------- */

export interface History {
  past: WorkflowGraph[];
  present: WorkflowGraph;
  future: WorkflowGraph[];
}

const LIMIT = 50;

export function historyOf(graph: WorkflowGraph): History {
  return { past: [], present: graph, future: [] };
}

export function commit(h: History, next: WorkflowGraph): History {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] };
}

export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) };
}
