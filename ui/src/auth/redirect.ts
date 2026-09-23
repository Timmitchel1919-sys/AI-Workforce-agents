import { CONTROL_CENTER_ROUTE } from "../components/brand/brand";

const AUTH_PATHS = ["/login", "/signup"];

/**
 * Returns a same-origin, in-app path to continue to after sign-in, or the
 * Control Center. Rejects absolute/protocol-relative URLs, backslash tricks,
 * and auth pages so `?next=` can never become an open redirect or a loop.
 */
export function safeRedirectPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return CONTROL_CENTER_ROUTE;
  }

  try {
    const base = "https://app.invalid";
    const url = new URL(raw, base);
    if (url.origin !== base) return CONTROL_CENTER_ROUTE;
    if (url.pathname === "/" || AUTH_PATHS.some((path) => url.pathname.startsWith(path))) {
      return CONTROL_CENTER_ROUTE;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return CONTROL_CENTER_ROUTE;
  }
}

export function loginPathFor(location: { pathname: string; search: string; hash: string }): string {
  const next = `${location.pathname}${location.search}${location.hash}`;
  return `/login?next=${encodeURIComponent(next)}`;
}
