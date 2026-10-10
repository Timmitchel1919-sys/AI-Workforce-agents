/**
 * Makes everything outside `element` inert (unreachable by keyboard / assistive tech) by
 * marking the siblings of it and of each of its ancestors. Returns a function that restores
 * exactly what it changed. Used by Focus Mode so Tab cannot reach hidden background content.
 */
export function inertSiblings(element: HTMLElement): () => void {
  const changed: Array<{ el: Element; hadAriaHidden: string | null }> = [];
  let node: HTMLElement | null = element;
  while (node && node !== document.body && node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || sibling.hasAttribute("inert")) continue;
      changed.push({ el: sibling, hadAriaHidden: sibling.getAttribute("aria-hidden") });
      sibling.setAttribute("inert", "");
      sibling.setAttribute("aria-hidden", "true");
    }
    node = node.parentElement;
  }
  return () => {
    for (const { el, hadAriaHidden } of changed) {
      el.removeAttribute("inert");
      if (hadAriaHidden === null) el.removeAttribute("aria-hidden");
      else el.setAttribute("aria-hidden", hadAriaHidden);
    }
  };
}
