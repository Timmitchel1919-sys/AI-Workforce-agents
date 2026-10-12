import { authenticateRequest } from "./authentication.js";
import { setSecurityHeaders, setCorsHeaders } from "./security-headers.js";
import { ApiSecurityError } from "./errors.js";
function createCorrelationId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
export async function processSecurityLayer(req, res, options) {
    setSecurityHeaders(res);
    const origin = req.headers.origin;
    if (origin) {
        const allowed = process.env.ALLOWED_ORIGIN || origin;
        setCorsHeaders(res, allowed);
    }
    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        throw "PREFLIGHT_HANDLED";
    }
    const requestId = createCorrelationId();
    const correlationId = options.correlationId || requestId;
    req._correlationId = correlationId;
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/$/, "") || "/";
    const method = (req.method ?? "GET").toUpperCase();
    const ctx = {
        requestId,
        correlationId,
        method,
        path,
        client: {
            ipHash: req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",")[0].trim() : req.socket.remoteAddress,
            userAgentHash: req.headers["user-agent"]
        },
        authenticated: false,
        authorized: false,
        receivedAt: new Date().toISOString()
    };
    let rateLimitProfile = "GENERAL_READ";
    if (method !== "GET" && method !== "OPTIONS") {
        rateLimitProfile = "PRIVILEGED_MUTATIONS";
    }
    options.rateLimiter.check(ctx, rateLimitProfile);
    if (method === "GET" && path.endsWith("/health")) {
        return ctx;
    }
    const appCheckMode = options.appCheckMode ||
        process.env.APP_CHECK_ENFORCEMENT_MODE ||
        "disabled";
    const appCheckTokenHeader = req.headers["x-firebase-appcheck"] ?? req.headers["X-Firebase-AppCheck"];
    const appCheckToken = Array.isArray(appCheckTokenHeader) ? appCheckTokenHeader[0] : appCheckTokenHeader;
    if (options.appAttestationVerifier && appCheckMode !== "disabled") {
        const attestationResult = await options.appAttestationVerifier.verify(appCheckToken);
        ctx.appCheckAttestation = { ...attestationResult, mode: appCheckMode };
        if (!attestationResult.valid) {
            if (appCheckMode === "enforced") {
                throw new ApiSecurityError(401, attestationResult.error || "app_check_denied", `App Check verification failed: ${attestationResult.error || "denied"}`);
            }
        }
    }
    await authenticateRequest(req, ctx, options.identityVerifier, options.operatorDirectory);
    return ctx;
}
