function headerValue(req, name) {
    const raw = req.headers[name];
    return Array.isArray(raw) ? raw[0] : raw;
}
/**
 * Best-effort authentication: resolves `ctx.identity` / `ctx.principal` when
 * a bearer token is present and valid, otherwise leaves the request
 * unauthenticated. Deliberately never throws — some routes are reachable
 * without a token (signed provider webhooks, `/me/access`), and for every
 * other route `handle()` already issues its own route-aware 401 once it
 * sees `ctx.principal` / `ctx.identity` are unset. Throwing here for a
 * missing or invalid token would short-circuit those checks and incorrectly
 * 401 routes that are supposed to stay public.
 */
export async function authenticateRequest(req, ctx, identityVerifier, operatorDirectory) {
    const header = headerValue(req, "authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match)
        return;
    const token = match[1].trim();
    if (identityVerifier) {
        const identity = await identityVerifier.verify(token);
        if (identity) {
            ctx.identity = identity;
            ctx.authenticated = true;
        }
    }
    if (operatorDirectory) {
        const principal = await operatorDirectory.resolve(token);
        if (principal) {
            ctx.principal = principal;
            ctx.authorized = true;
            ctx.authenticated = true;
        }
    }
}
