const DEFAULT_PROTECTED = ["/api/status", "/api/projects"];
const DEFAULT_HOSTS = [".web.app", ".firebaseapp.com"];
const MAX_BODY_BYTES = 1_000_000;
/** A path: starts with one `/`, URL-safe characters only, no `//` and no `.`/`..` segments. */
const PATH = /^\/(?!\/)(?!.*\/\/)[A-Za-z0-9._~\-/]*$/;
const VERSION = /^[A-Za-z0-9._-]{1,80}$/;
/** A strict https origin on an allowed host, with no credentials, port, path, query or fragment. */
export function parseOrigin(raw, allowedHostSuffixes = DEFAULT_HOSTS) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        return undefined;
    }
    const clean = url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        url.port === "" &&
        url.search === "" &&
        url.hash === "" &&
        url.pathname === "/" &&
        // `new URL("https://x.web.app")` prints without a trailing slash only in `.origin`
        raw.replace(/\/$/, "") === url.origin;
    if (!clean)
        return undefined;
    const host = url.hostname.toLowerCase();
    const ip = /^[0-9.]+$/.test(host) || host.includes(":");
    if (ip || !allowedHostSuffixes.some((s) => host.endsWith(s) && host.length > s.length))
        return undefined;
    return url;
}
/** Reads a body with a hard size cap; the caller's abort signal covers the whole read. */
async function readCapped(r) {
    const declared = Number(r.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES)
        return undefined;
    if (!r.body)
        return "";
    const reader = r.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
            await reader.cancel();
            return undefined;
        }
        chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
}
export async function verifyProduction(input) {
    const doFetch = input.fetch ?? fetch;
    const timeoutMs = input.timeoutMs ?? 15_000;
    const health = input.healthPath ?? "/api/health";
    const protectedPaths = input.protectedPaths ?? DEFAULT_PROTECTED;
    const checks = [];
    const bundles = {};
    const servedVersions = {};
    const record = (id, subject, ok, detail) => {
        checks.push({ id, subject, status: ok ? "passed" : "failed", detail });
    };
    /** One request, its body read, all under ONE timeout. `redirect: manual`: a redirect is a finding. */
    const get = async (url) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const r = await doFetch(url, { method: "GET", redirect: "manual", signal: controller.signal });
            return { status: r.status, headers: r.headers, body: await readCapped(r) };
        }
        finally {
            clearTimeout(timer);
        }
    };
    const guarded = async (id, subject, run) => {
        try {
            const r = await run();
            record(id, subject, r.ok, r.detail);
        }
        catch (error) {
            // Could not be performed => not verified => failed.
            record(id, subject, false, `could not be checked: ${error instanceof Error ? error.name : "error"}`);
        }
    };
    const isJson = (h) => (h.get("content-type") ?? "").includes("application/json");
    // Configuration is validated before ANY request, and every path is validated as a path.
    const paths = [health, ...protectedPaths];
    if (protectedPaths.length === 0)
        record("configuration", "protectedPaths", false, "at least one protected route is required");
    for (const p of paths)
        if (!PATH.test(p) || p.split("/").slice(1).some((seg) => seg === "." || seg === ".."))
            record("configuration", "path", false, "paths must start with / and contain only URL-safe characters");
    if (input.baseUrls.length === 0)
        record("configuration", "baseUrls", false, "no origin to verify");
    const origins = [];
    for (const raw of input.baseUrls) {
        const u = parseOrigin(raw, input.allowedHostSuffixes);
        if (u)
            origins.push(u.origin);
        // The rejected value is NOT echoed (it could carry credentials).
        else
            record("configuration", "origin", false, "origin must be an https origin on an allowed host, without credentials, port, path, query or fragment");
    }
    const configured = checks.every((c) => c.status === "passed");
    if (configured) {
        for (const base of origins) {
            await guarded("hosting", base, async () => {
                const r = await get(`${base}/`);
                const ok = r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/html") && r.body !== undefined;
                const asset = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(r.body ?? "")?.[0];
                if (asset)
                    bundles[base] = asset;
                return { ok, detail: `HTTP ${r.status}${ok && !asset ? " (no UI bundle found)" : ""}` };
            });
            await guarded("health", `${base}${health}`, async () => {
                const r = await get(`${base}${health}`);
                let parsed;
                if (r.status === 200 && isJson(r.headers) && r.body !== undefined)
                    parsed = JSON.parse(r.body);
                if (typeof parsed?.version === "string" && VERSION.test(parsed.version))
                    servedVersions[base] = parsed.version;
                return { ok: r.status === 200 && parsed?.status === "ok", detail: `HTTP ${r.status}` };
            });
            for (const path of protectedPaths) {
                await guarded("protected", `${base}${path}`, async () => {
                    const r = await get(`${base}${path}`);
                    // A denial must be the API's own JSON denial — a CDN/hosting error page is not the API.
                    const denied = (r.status === 401 || r.status === 403) && isJson(r.headers);
                    const noStore = (r.headers.get("cache-control") ?? "").includes("no-store");
                    const cacheOk = input.requireNoStore === false || !denied || noStore;
                    return {
                        ok: denied && cacheOk,
                        detail: denied
                            ? cacheOk
                                ? `denied (HTTP ${r.status})`
                                : `denied (HTTP ${r.status}) but the response is cacheable`
                            : `NOT denied by the API: HTTP ${r.status}`,
                    };
                });
            }
            await guarded("unknown-route", `${base}/api/does-not-exist`, async () => {
                const r = await get(`${base}/api/does-not-exist`);
                return { ok: r.status === 401 || r.status === 403 || r.status === 404, detail: `HTTP ${r.status}` };
            });
        }
        // Identity is compared PER ORIGIN: a stale second origin must not be masked by a fresh first one.
        for (const base of origins) {
            if (input.expectedBundle !== undefined) {
                const served = bundles[base];
                record("version", `${base} ui bundle`, served === input.expectedBundle, served === undefined ? "served bundle could not be identified" : served === input.expectedBundle ? "matches the release" : `serving ${served}`);
            }
            if (input.expectedVersion !== undefined) {
                const served = servedVersions[base];
                record("version", `${base} reported version`, served === input.expectedVersion, served === undefined ? "the health endpoint reports no version" : served === input.expectedVersion ? "matches the release" : `reporting ${served}`);
            }
        }
    }
    return {
        verdict: checks.length > 0 && checks.every((c) => c.status === "passed") ? "healthy" : "unhealthy",
        checkedAt: (input.clock ?? (() => new Date().toISOString()))(),
        baseUrls: origins,
        checks,
        bundles,
        servedVersions,
    };
}
/**
 * Adapts a report to the deployment orchestrator's post-deploy contract, so a real deployment
 * adapter can use this verifier for its `verify()` step.
 *
 *  - `reachable` is true only if EVERY check except the version comparison passed (hosting, health,
 *    protected routes, unknown-route): a production that is up but exposes an open route, or serves
 *    a broken page, is not reachable-and-healthy. Version is compared separately by the
 *    orchestrator against the candidate, from what production REPORTS.
 *  - `reportedVersion` comes only from the report (what the health endpoints say). It is never a
 *    value the caller supplies, so the orchestrator can never compare a commit to itself. If the
 *    origins disagree, or none reports a version, no version is reported and the release cannot
 *    be marked healthy.
 */
export function toPostDeployVerification(report) {
    // Only the REPORTED-version check is delegated to the orchestrator (it compares against the commit);
    // a stale UI bundle is a version-id check too, but nothing else judges it, so it must fail here.
    const nonVersion = report.checks.filter((c) => !(c.id === "version" && c.subject.endsWith("reported version")));
    const failed = report.checks.filter((c) => c.status === "failed");
    const versions = new Set(Object.values(report.servedVersions));
    const oneVersion = versions.size === 1 && Object.keys(report.servedVersions).length === report.baseUrls.length;
    return {
        reachable: nonVersion.length > 0 && nonVersion.every((c) => c.status === "passed") && report.baseUrls.length > 0,
        ...(oneVersion ? { reportedVersion: [...versions][0] } : {}),
        detail: failed.length === 0 ? "all production checks passed" : `failed: ${failed.map((c) => `${c.id} ${c.subject}`).join("; ").slice(0, 300)}`,
    };
}
