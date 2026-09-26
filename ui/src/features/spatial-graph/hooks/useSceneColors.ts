import { useEffect, useState } from "react";
import type { GraphOperationalState } from "../../../../../contracts/graph";
import { readStateColors, readToken, SCENE_TOKENS } from "../lib/stateStyle";

export interface SceneColors {
  states: Record<GraphOperationalState, string>;
  edge: string;
  edgeActive: string;
  selection: string;
  blocking: string;
}

function read(): SceneColors {
  return {
    states: readStateColors(),
    edge: readToken(SCENE_TOKENS.edge),
    edgeActive: readToken(SCENE_TOKENS.edgeActive),
    selection: readToken(SCENE_TOKENS.selection),
    blocking: readToken(SCENE_TOKENS.blocking),
  };
}

/** Scene colours resolved from the design tokens; refreshes when the theme changes. */
export function useSceneColors(): SceneColors {
  const [colors, setColors] = useState<SceneColors>(read);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setColors(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    return () => observer.disconnect();
  }, []);
  return colors;
}
