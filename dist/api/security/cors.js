export const DEFAULT_CORS = {
    allowedOrigins: [],
    allowedMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
        "authorization",
        "content-type",
        "x-correlation-id",
        "x-firebase-appcheck",
        "idempotency-key",
    ],
    exposedHeaders: ["x-correlation-id", "retry-after"],
    allowCredentials: true,
    maxAgeSeconds: 600,
};
export function originIsAllowed(policy, origin) {
    if (!origin)
        return false;
    if (policy.allowedOrigins.includes("*")) {
        return !policy.allowCredentials;
    }
    return policy.allowedOrigins.includes(origin);
}
/**
 * Apply CORS to a request. Returns true when the request was a
 * preflight (OPTIONS) and the caller should short-circuit the
 * response; false otherwise.
 */
export function applyCors(req, res, policy) {
    const origin = (req.headers.origin ?? "").toString();
    const method = (req.method ?? "GET").toUpperCase();
    const allowed = origin ? originIsAllowed(policy, origin) : false;
    if (allowed) {
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "Origin");
        if (policy.allowCredentials) {
            res.setHeader("access-control-allow-credentials", "true");
        }
        if (policy.exposedHeaders && policy.exposedHeaders.length > 0) {
            res.setHeader("access-control-expose-headers", policy.exposedHeaders.join(", "));
        }
    }
    if (method !== "OPTIONS")
        return "no_preflight";
    if (!allowed) {
        res.statusCode = 403;
        res.end();
        return "preflight_denied";
    }
    res.setHeader("access-control-allow-methods", policy.allowedMethods.join(", "));
    res.setHeader("access-control-allow-headers", policy.allowedHeaders.join(", "));
    if (policy.maxAgeSeconds !== undefined) {
        res.setHeader("access-control-max-age", String(policy.maxAgeSeconds));
    }
    res.statusCode = 204;
    res.end();
    return "preflight_ok";
}
