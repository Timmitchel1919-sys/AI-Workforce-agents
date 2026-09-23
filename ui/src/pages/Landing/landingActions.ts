import type { MouseEvent } from "react";
import { prefersReducedMotion } from "./hooks/useLandingMotion";

export { CONTROL_CENTER_ROUTE, LOGO_MARK_SRC, LOGO_ALT } from "../../components/brand/brand";

/** In-page anchor navigation that honours reduced motion; plain `#id` links still work without JS. */
export function scrollToSection(event: MouseEvent<HTMLAnchorElement>, id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  window.history.replaceState(null, "", `#${id}`);
}
