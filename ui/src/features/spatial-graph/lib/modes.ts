import { DEFAULT_GRAPH_MODE, GRAPH_MODES } from "../../../../../contracts/graph";
import type { GraphMode, WorkforceGraphNode, WorkforceGraphNodeType } from "../../../../../contracts/graph";

export const MODE_LIST: readonly GraphMode[] = GRAPH_MODES;
export const MODE_PARAM = "mode";

export function isGraphMode(value: unknown): value is GraphMode {
  return typeof value === "string" && (MODE_LIST as readonly string[]).includes(value);
}

/** Validates a URL value; anything unknown falls back to the default mode. */
export function parseMode(value: string | null | undefined): GraphMode {
  return isGraphMode(value) ? value : DEFAULT_GRAPH_MODE;
}

/** Node types that may scope (root) a projection in a given mode. */
const ROOT_TYPES: Readonly<Partial<Record<GraphMode, readonly WorkforceGraphNodeType[]>>> = {
  AGENT: ["AGENT"],
  WORKFLOW: ["WORKFLOW"],
  DEPENDENCY: ["TASK"],
};

/** The selected node may become rootNodeId only when it is valid for the target mode. */
export function rootNodeFor(mode: GraphMode, selected: WorkforceGraphNode | null): string | undefined {
  if (!selected) return undefined;
  return ROOT_TYPES[mode]?.includes(selected.type) ? selected.id : undefined;
}

/** Next mode for arrow-key navigation in the radio group (wraps). */
export function stepMode(current: GraphMode, delta: 1 | -1): GraphMode {
  const i = MODE_LIST.indexOf(current);
  return MODE_LIST[(i + delta + MODE_LIST.length) % MODE_LIST.length];
}
