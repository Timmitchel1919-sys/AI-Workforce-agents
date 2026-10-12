import type { ServerResponse } from "node:http";

/**
 * Baseline response-header set applied to every API response. The
 * values are intentionally conservative for a JSON API served under
 * `/api/**`; a stricter CSP for the Hosting-served UI is defined
 * separately in the Hosting config.
 */
export const DEFAULT_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy":
    "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "x-frame-options": "DENY",
};

/**
 * Headers added only in production HTTPS contexts. The caller passes
 * `inProduction=true` once the runtime has confirmed TLS at the edge
 * (Firebase Hosting / Cloud Functions always terminates TLS).
 */
export const PRODUCTION_HTTPS_HEADERS: Readonly<Record<string, string>> = {
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
};

export function applySecurityHeaders(
  res: ServerResponse,
  options: { production?: boolean } = {},
): void {
  for (const [name, value] of Object.entries(DEFAULT_SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
  if (options.production) {
    for (const [name, value] of Object.entries(PRODUCTION_HTTPS_HEADERS)) {
      res.setHeader(name, value);
    }
  }
}
