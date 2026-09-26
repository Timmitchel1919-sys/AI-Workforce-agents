import { ALL_FILTER, filterGraph, isolate, neighbourIds, type FilterId, type GraphData } from "./graphModel";

/** UI-only exploration state. Never sent to, or derived from writes against, the backend. */
export interface ViewState {
  filter: FilterId;
  selectedId: string | null;
  hoveredId: string | null;
  isolatedId: string | null;
  expandedIds: readonly string[];
}

export const INITIAL_VIEW_STATE: ViewState = {
  filter: ALL_FILTER,
  selectedId: null,
  hoveredId: null,
  isolatedId: null,
  expandedIds: [],
};

export type ViewAction =
  | { type: "hover"; id: string | null }
  | { type: "select"; id: string | null }
  | { type: "deselect" }
  | { type: "setFilter"; filter: FilterId }
  | { type: "isolate"; id: string | null }
  | { type: "toggleExpand"; id: string }
  | { type: "prune"; ids: ReadonlySet<string>; resetFilter: boolean }
  | { type: "reset" };

export function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case "hover":
      return state.hoveredId === action.id ? state : { ...state, hoveredId: action.id };
    case "select":
      return state.selectedId === action.id ? state : { ...state, selectedId: action.id };
    case "deselect":
      return state.selectedId === null ? state : { ...state, selectedId: null };
    case "setFilter":
      return { ...state, filter: action.filter };
    case "isolate":
      return { ...state, isolatedId: action.id };
    case "toggleExpand":
      return state.expandedIds.includes(action.id)
        ? { ...state, expandedIds: state.expandedIds.filter((x) => x !== action.id) }
        : { ...state, expandedIds: [...state.expandedIds, action.id] };
    case "prune":
      return {
        ...state,
        filter: action.resetFilter ? INITIAL_VIEW_STATE.filter : state.filter,
        selectedId: state.selectedId && action.ids.has(state.selectedId) ? state.selectedId : null,
        hoveredId: null,
        isolatedId: action.resetFilter ? null : state.isolatedId && action.ids.has(state.isolatedId) ? state.isolatedId : null,
        expandedIds: action.resetFilter ? [] : state.expandedIds.filter((id) => action.ids.has(id)),
      };
    case "reset":
      return { ...INITIAL_VIEW_STATE };
  }
}

export interface DerivedView {
  visible: GraphData;
  selectedId: string | null;
  isolatedId: string | null;
  /** Expanded nodes that are still visible. */
  expandedIds: string[];
  /** When non-null, everything outside this set is dimmed in the canvas. */
  emphasisIds: ReadonlySet<string> | null;
}

/**
 * Applies filter -> isolation to the projection. Selection / isolation / expansion of a
 * node that the filter hides are treated as absent (state is kept, so clearing the
 * filter restores them).
 */
export function deriveView(graph: GraphData, state: ViewState): DerivedView {
  const filtered = filterGraph(graph, state.filter);
  const has = (id: string | null): id is string => id !== null && filtered.nodes.some((n) => n.id === id);
  const expandedIds = state.expandedIds.filter(has);
  const isolatedId = has(state.isolatedId) ? state.isolatedId : null;
  const selectedId = has(state.selectedId) ? state.selectedId : null;

  const visible = isolatedId ? isolate(filtered, isolatedId, expandedIds) : filtered;

  let emphasisIds: Set<string> | null = null;
  if (!isolatedId && expandedIds.length > 0) {
    emphasisIds = new Set<string>();
    for (const id of expandedIds) {
      emphasisIds.add(id);
      for (const n of neighbourIds(visible, id)) emphasisIds.add(n);
    }
    if (selectedId) emphasisIds.add(selectedId);
  }
  // A selection can also be hidden by isolation of a different node.
  const selectedVisible = selectedId !== null && visible.nodes.some((n) => n.id === selectedId);
  return { visible, selectedId: selectedVisible ? selectedId : null, isolatedId, expandedIds, emphasisIds };
}
