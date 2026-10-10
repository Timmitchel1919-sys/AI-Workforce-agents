import type { WorkforceGraphNode, WorkforceGraphProjection } from "../../../../../contracts/graph";
import { LIVE_LIMITS } from "./liveStatus";

/**
 * A state transition observed between two AUTHORITATIVE snapshots. Transitions
 * are derived from server state, never invented client-side, and drive both the
 * (optional) animation and the accessible announcement.
 */
export interface GraphTransition {
  kind: "added" | "removed" | "state";
  nodeId: string;
  nodeType: WorkforceGraphNode["type"];
  label: string;
  /** Operational states (translatable). The raw status is `toStatus`. */
  fromState?: string;
  toState?: string;
  toStatus?: string;
  /** Server `generatedAt` of the snapshot that revealed the change. */
  at: string;
}

/**
 * Deterministic (sorted by node id, then kind) diff of two projections of the same scope.
 *
 * Presence changes (added/removed) are only reported when BOTH snapshots are complete. A node that
 * leaves because a source was unreadable (`unavailableSources`) or because the bound cut the view
 * short (`truncated`) has not been removed — that would be a fabricated event — so only state
 * changes of nodes present in both snapshots are reported in that case. UNKNOWN != ABSENT.
 */
export function diffGraphs(prev: WorkforceGraphProjection, next: WorkforceGraphProjection): GraphTransition[] {
  const complete = (g: WorkforceGraphProjection) => !g.truncated && !g.metadata?.unavailableSources;
  const presenceReliable = complete(prev) && complete(next);
  const before = new Map(prev.nodes.map((n) => [n.id, n]));
  const after = new Map(next.nodes.map((n) => [n.id, n]));
  const out: GraphTransition[] = [];
  for (const [id, n] of after) {
    const old = before.get(id);
    if (!old) {
      if (presenceReliable) {
        out.push({ kind: "added", nodeId: id, nodeType: n.type, label: n.label, toState: n.state, toStatus: n.status, at: next.generatedAt });
      }
    } else if (old.state !== n.state || old.status !== n.status) {
      out.push({
        kind: "state",
        nodeId: id,
        nodeType: n.type,
        label: n.label,
        fromState: old.state,
        toState: n.state,
        toStatus: n.status,
        at: next.generatedAt,
      });
    }
  }
  if (presenceReliable) {
    for (const [id, n] of before) {
      if (!after.has(id)) {
        out.push({ kind: "removed", nodeId: id, nodeType: n.type, label: n.label, fromState: n.state, at: next.generatedAt });
      }
    }
  }
  return out.sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : a.kind < b.kind ? -1 : 1));
}

/** Newest-last, hard-capped: browser memory never grows with uptime. */
export function appendBounded<T>(list: readonly T[], more: readonly T[], max: number = LIVE_LIMITS.maxTransitions): T[] {
  const merged = more.length === 0 ? [...list] : [...list, ...more];
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}
