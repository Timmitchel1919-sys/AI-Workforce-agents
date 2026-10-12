import type { ServerResponse } from "node:http";
/**
 * Baseline response-header set applied to every API response. The
 * values are intentionally conservative for a JSON API served under
 * `/api/**`; a stricter CSP for the Hosting-served UI is defined
 * separately in the Hosting config.
 */
export declare const DEFAULT_SECURITY_HEADERS: Readonly<Record<string, string>>;
/**
 * Headers added only in production HTTPS contexts. The caller passes
 * `inProduction=true` once the runtime has confirmed TLS at the edge
 * (Firebase Hosting / Cloud Functions always terminates TLS).
 */
export declare const PRODUCTION_HTTPS_HEADERS: Readonly<Record<string, string>>;
export declare function applySecurityHeaders(res: ServerResponse, options?: {
    production?: boolean;
}): void;
