import { UnauthorizedError } from "./errors.js";
function headerValue(req, name) {
    const raw = req.headers[name];
    return Array.isArray(raw) ? raw[0] : raw;
}
export async function authenticateRequest(req, ctx, identityVerifier, operatorDirectory) {
    const header = headerValue(req, "authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    // If authorization header is completely missing on a route that requires auth,
    // we could throw, but we should let the authorization step throw if missing.
    // Actually, wait, some routes might not require auth (like health).
    // The middleware already skipped health. So here we expect a token.
    if (!match) {
        throw new UnauthorizedError("missing or malformed authorization header");
    }
    const token = match[1].trim();
    // 1. Verify token
    if (identityVerifier) {
        const identity = await identityVerifier.verify(token);
        if (!identity) {
            throw new UnauthorizedError("invalid or expired token");
        }
        ctx.identity = identity;
        ctx.authenticated = true;
    }
    // 2. Resolve principal
    if (operatorDirectory) {
        const principal = await operatorDirectory.resolve(token);
        if (principal) {
            ctx.principal = principal;
            ctx.authorized = true;
            ctx.authenticated = true;
        }
    }
    if (!ctx.authenticated) {
        // If we had no verifier and no directory, or directory returned null without verifier
        throw new UnauthorizedError("invalid or expired token");
    }
}
