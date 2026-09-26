import type { GraphOperationalState } from "../../../../../contracts/graph";
import { GRAPH_OPERATIONAL_STATES } from "../../../../../contracts/graph";

/**
 * The single mapping from operational state to visual encoding. Colour comes from the
 * design tokens (CSS custom properties); shape / glyph / ring encode the same state
 * redundantly so colour is never the only signal.
 */
export type StateShape =
  | "sphere"
  | "octahedron"
  | "box"
  | "tetrahedron"
  | "dodecahedron"
  | "icosahedron";

export interface StateStyle {
  /** CSS custom property (design token) that holds the colour. */
  token: string;
  shape: StateShape;
  /** Draw an equatorial ring around the node. */
  ring: boolean;
  /** Render the mesh as an outline only (absent / unknown). */
  wireframe: boolean;
  /** Text glyph for DOM surfaces (never the only signal; a text label always accompanies it). */
  glyph: string;
}

export const STATE_STYLES: Readonly<Record<GraphOperationalState, StateStyle>> = {
  active: { token: "--color-success", shape: "sphere", ring: false, wireframe: false, glyph: "●" },
  running: { token: "--color-info", shape: "sphere", ring: true, wireframe: false, glyph: "◉" },
  queued: { token: "--aw-gold-400", shape: "octahedron", ring: false, wireframe: false, glyph: "◇" },
  blocked: { token: "--color-warning", shape: "box", ring: false, wireframe: false, glyph: "■" },
  failed: { token: "--color-danger", shape: "tetrahedron", ring: false, wireframe: false, glyph: "▲" },
  completed: { token: "--aw-purple-500", shape: "dodecahedron", ring: false, wireframe: false, glyph: "✓" },
  offline: { token: "--aw-blue-300", shape: "sphere", ring: false, wireframe: true, glyph: "○" },
  unavailable: { token: "--color-text-disabled", shape: "icosahedron", ring: false, wireframe: true, glyph: "?" },
};

export const ALL_STATES: readonly GraphOperationalState[] = GRAPH_OPERATIONAL_STATES;

/** Tokens the scene itself needs besides state colours. */
export const SCENE_TOKENS = {
  // The canvas is a dark surface in both themes, so the scene uses light palette tokens.
  edge: "--aw-blue-300",
  edgeActive: "--aw-gold-200",
  selection: "--aw-gold-200",
  blocking: "--color-danger",
} as const;

/** Last-resort values, used only when a token cannot be read (e.g. jsdom, SSR). */
const FALLBACKS: Readonly<Record<string, string>> = {
  "--color-success": "#159447",
  "--color-info": "#1459d9",
  "--aw-gold-400": "#d9a72e",
  "--color-warning": "#b97800",
  "--color-danger": "#c83b4d",
  "--aw-purple-500": "#7137e8",
  "--aw-blue-300": "#8eb8ff",
  "--aw-gold-200": "#f7d978",
  "--color-text-disabled": "#9aa8c1",
};

export function isKnownState(value: string): value is GraphOperationalState {
  return (GRAPH_OPERATIONAL_STATES as readonly string[]).includes(value);
}

/** Defensive: a state outside the vocabulary renders as "unavailable". */
export function normaliseState(value: string | undefined): GraphOperationalState {
  return value !== undefined && isKnownState(value) ? value : "unavailable";
}

export function stateStyle(state: string | undefined): StateStyle {
  return STATE_STYLES[normaliseState(state)];
}

/** `var(--token)` reference for DOM/CSS surfaces. */
export function stateCssVar(state: string | undefined): string {
  return `var(${stateStyle(state).token})`;
}

/** Reads a token's current computed colour; falls back to the central defaults. */
export function readToken(token: string, root?: Element | null): string {
  try {
    const el = root ?? (typeof document !== "undefined" ? document.documentElement : null);
    if (el) {
      const value = getComputedStyle(el).getPropertyValue(token).trim();
      if (value && !value.startsWith("var(")) return value;
    }
  } catch {
    // fall through
  }
  return FALLBACKS[token] ?? "#808080";
}

export function readStateColors(root?: Element | null): Record<GraphOperationalState, string> {
  const out = {} as Record<GraphOperationalState, string>;
  for (const s of ALL_STATES) out[s] = readToken(STATE_STYLES[s].token, root);
  return out;
}
