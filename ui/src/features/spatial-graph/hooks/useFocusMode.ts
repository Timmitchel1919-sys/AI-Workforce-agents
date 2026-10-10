import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { inertSiblings } from "../lib/inertSiblings";

/**
 * Focus Mode: the graph area becomes a fixed, viewport-filling overlay (styled by the caller
 * through `active`). While active: background scroll is locked, everything outside the overlay
 * is inert, Escape exits from anywhere, and focus returns to the trigger on exit.
 * This is deliberately unrelated to the browser Fullscreen API.
 */
export function useFocusMode(rootRef: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const exitRef = useRef<HTMLButtonElement | null>(null);
  const wasActive = useRef(false);

  const enter = useCallback(() => setActive(true), []);
  const exit = useCallback(() => setActive(false), []);
  const toggle = useCallback(() => setActive((a) => !a), []);

  useEffect(() => {
    if (!active) return;
    const root = rootRef.current;
    const restoreInert = root ? inertSiblings(root) : () => {};
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      // A control that already consumed Escape (e.g. clearing the search box) must not also exit.
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        setActive(false);
      }
    };
    window.addEventListener("keydown", onKey);
    exitRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      restoreInert();
    };
  }, [active, rootRef]);

  // Restore focus to the trigger once Focus Mode has been left.
  useEffect(() => {
    if (wasActive.current && !active) triggerRef.current?.focus();
    wasActive.current = active;
  }, [active]);

  return { active, enter, exit, toggle, triggerRef, exitRef };
}
