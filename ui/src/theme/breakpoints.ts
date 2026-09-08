import { useEffect, useState } from "react";

/** Central breakpoint scale (px). Mirrors `--bp-*` in tokens.css. */
export const BREAKPOINTS = {
  sm: 768,
  md: 1024,
  lg: 1280,
  xl: 1440,
} as const;

export type BreakpointName = keyof typeof BREAKPOINTS;

/** Subscribe to a media query. SSR-safe (returns `false` before mount). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** True when the viewport is at least the named breakpoint. */
export function useBreakpointUp(name: BreakpointName): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS[name]}px)`);
}

/** True when the OS "reduce motion" setting is on. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
