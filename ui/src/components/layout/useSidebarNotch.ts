import { useLayoutEffect, type RefObject } from "react";

/**
 * Positions the sidebar-edge notch: a triangular cutout in the RIGHT EDGE of
 * the sidebar container, vertically centred on the active navigation item.
 *
 * The notch is geometry, not an element: the container is clipped with
 * `clip-path` (see AppShell.css), so the real page background shows through —
 * no border, seam, shadow or hard-coded colour, and nothing focusable,
 * announced or clickable. The position is measured from the actual DOM of the
 * active NavLink (nested routes keep their parent module active), and follows
 * route changes, sidebar scrolling, collapse and resizing. When no module is
 * active, or the active item is scrolled out of view, the notch is removed.
 */
export function useSidebarNotch(
  hostRef: RefObject<HTMLElement | null>,
  deps: readonly unknown[],
): void {
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const active = host.querySelector<HTMLElement>(".sidebar__link.is-active");
      const scroller = host.querySelector<HTMLElement>(".sidebar__scroll");
      if (!active) {
        host.removeAttribute("data-notch");
        return;
      }
      const hostBox = host.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      const centre = item.top + item.height / 2;
      if (scroller) {
        const view = scroller.getBoundingClientRect();
        // Hide rather than point at nothing while the item is scrolled away.
        if (centre < view.top || centre > view.bottom) {
          host.removeAttribute("data-notch");
          return;
        }
      }
      host.style.setProperty("--sidebar-notch-y", `${Math.round(centre - hostBox.top)}px`);
      host.setAttribute("data-notch", "");
    };
    // Measured synchronously: scroll/resize events already arrive at most once
    // per frame, and rAF is paused in background tabs (the notch would go stale).
    const schedule = update;

    update();
    const scroller = host.querySelector<HTMLElement>(".sidebar__scroll");
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    host.addEventListener("transitionend", schedule);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    observer?.observe(host);
    if (scroller) observer?.observe(scroller);

    return () => {
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      host.removeEventListener("transitionend", schedule);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
