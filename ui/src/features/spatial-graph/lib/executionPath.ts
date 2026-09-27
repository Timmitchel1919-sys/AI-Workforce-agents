import type { WorkforceGraphEdge, WorkforceGraphEdgeType } from "../../../../../contracts/graph";

/** Edges that form the execution lifecycle chain (agent/task → session → … → deployment). */
const LIFECYCLE_EDGES: ReadonlySet<WorkforceGraphEdgeType> = new Set<WorkforceGraphEdgeType>([
  "EXECUTES",
  "RUNS_ON",
  "PRODUCES",
  "VERIFIED_BY",
  "REVIEWED_BY",
  "REQUIRES_APPROVAL",
  "COMMITTED_AS",
  "DEPLOYED_TO",
]);

/**
 * The execution path of a selected node: its ANCESTORS (what led to it, walking edges backwards)
 * and its DESCENDANTS (what it led to, walking edges forwards), along real lifecycle edges only.
 * The two walks are never mixed, so a shared agent, task or environment is not a pass-through hub:
 * selecting one session's ChangeSet does not light up a sibling session that merely shares the agent.
 * Selecting an agent itself yields all the work it started (its descendants) — that is accurate.
 * Returns null when the selection has no lifecycle connection, so callers keep their normal
 * emphasis. Bounded by the number of edges; cycle-safe via the visited set.
 */
export function traceExecutionPath(edges: readonly WorkforceGraphEdge[], selectedId: string | null): Set<string> | null {
  if (!selectedId) return null;
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, k: string, v: string) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  for (const e of edges) {
    if (!LIFECYCLE_EDGES.has(e.type)) continue;
    add(forward, e.source, e.target);
    add(backward, e.target, e.source);
  }
  if (!forward.has(selectedId) && !backward.has(selectedId)) return null;
  const seen = new Set<string>([selectedId]);
  const walk = (adjacent: Map<string, string[]>) => {
    const visited = new Set<string>([selectedId]);
    const queue = [selectedId];
    while (queue.length > 0) {
      const id = queue.pop()!;
      for (const next of adjacent.get(id) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          seen.add(next);
          queue.push(next);
        }
      }
    }
  };
  walk(backward);
  walk(forward);
  return seen;
}
