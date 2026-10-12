import type { IncomingMessage, ServerResponse } from "node:http";
export interface CorsPolicy {
    /**
     * Exact-match allow-list of origins. The caller resolves this from
     * trusted configuration (`CORS_ALLOWED_ORIGINS` env, Hosting
     * config, …). Wildcard `*` is accepted ONLY when
     * `allowCredentials` is false. Reflecting arbitrary `Origin` is
     * never allowed.
     */
    allowedOrigins: readonly string[];
    allowedMethods: readonly string[];
    allowedHeaders: readonly string[];
    exposedHeaders?: readonly string[];
    allowCredentials?: boolean;
    maxAgeSeconds?: number;
}
export declare const DEFAULT_CORS: CorsPolicy;
export declare function originIsAllowed(policy: CorsPolicy, origin: string): boolean;
/**
 * Apply CORS to a request. Returns true when the request was a
 * preflight (OPTIONS) and the caller should short-circuit the
 * response; false otherwise.
 */
export declare function applyCors(req: IncomingMessage, res: ServerResponse, policy: CorsPolicy): "preflight_ok" | "preflight_denied" | "no_preflight";
