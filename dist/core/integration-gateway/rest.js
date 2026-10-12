/**
 * Declarative REST/GraphQL connector runtime.
 *
 * A connector manifest lists capabilities as HTTP templates. This runtime validates
 * the parameters, builds the request, injects the credential INSIDE `vault.use`, calls
 * the provider (host-pinned, no redirects, size- and time-bounded), classifies failures
 * and normalizes the response. Nothing else in the system builds provider requests.
 */
import { HUB_LIMITS, } from "../../contracts/integration-gateway.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";
/* ------------------------------------------------------------------ */
/* Parameters                                                          */
/* ------------------------------------------------------------------ */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export function validateParams(specs, params) {
    const known = new Set(specs.map((s) => s.name));
    for (const key of Object.keys(params))
        if (!known.has(key))
            return `unknown parameter "${key}"`;
    for (const s of specs) {
        const v = params[s.name];
        if (v === undefined || v === null) {
            if (s.required)
                return `parameter "${s.name}" is required`;
            continue;
        }
        switch (s.type) {
            case "string":
                if (typeof v !== "string")
                    return `parameter "${s.name}" must be a string`;
                if (CONTROL.test(v))
                    return `parameter "${s.name}" contains control characters`;
                if (v.length > (s.max ?? 4000))
                    return `parameter "${s.name}" is too long`;
                break;
            case "number":
                if (typeof v !== "number" || !Number.isFinite(v))
                    return `parameter "${s.name}" must be a number`;
                break;
            case "boolean":
                if (typeof v !== "boolean")
                    return `parameter "${s.name}" must be true or false`;
                break;
            case "string[]":
                if (!Array.isArray(v) ||
                    v.length > (s.max ?? 50) ||
                    v.some((x) => typeof x !== "string" || x.length > 500))
                    return `parameter "${s.name}" must be a short list of strings`;
                break;
            case "object":
                if (typeof v !== "object" ||
                    Array.isArray(v) ||
                    JSON.stringify(v).length > HUB_LIMITS.maxParamBytes)
                    return `parameter "${s.name}" must be a small object`;
                break;
        }
    }
    return undefined;
}
/* ------------------------------------------------------------------ */
/* Responses                                                           */
/* ------------------------------------------------------------------ */
function getPath(obj, path) {
    let cur = obj;
    for (const p of path.split(".")) {
        if (cur === null || typeof cur !== "object")
            return undefined;
        cur = cur[p];
    }
    return cur;
}
export const pick = (fields) => (json) => Object.fromEntries(Object.entries(fields).map(([out, path]) => [out, getPath(json, path)]));
export const pickList = (listPath, fields) => (json) => {
    const list = listPath === "" ? json : getPath(json, listPath);
    return (Array.isArray(list) ? list : [])
        .slice(0, 100)
        .map((item) => pick(fields)(item));
};
/** Bound depth, array length and string size, and mask anything credential-shaped. */
export function sanitize(value, depth = 0) {
    if (value === null || value === undefined)
        return value ?? null;
    if (typeof value === "string")
        return maskSecrets(value.length > 4000 ? `${value.slice(0, 4000)}…` : value);
    if (typeof value === "number" || typeof value === "boolean")
        return value;
    if (depth >= 5)
        return "[truncated]";
    if (Array.isArray(value))
        return value.slice(0, 100).map((v) => sanitize(v, depth + 1));
    if (typeof value === "object") {
        const out = {};
        let n = 0;
        for (const [k, v] of Object.entries(value)) {
            if (n++ >= 60)
                break;
            if (/^(access_?token|refresh_?token|client_?secret|password|authorization|api_?key|secret)$/i.test(k)) {
                out[k] = "[masked]";
                continue;
            }
            out[k] = sanitize(v, depth + 1);
        }
        return out;
    }
    return String(value);
}
export function classifyStatus(status, headers) {
    const retryAfter = headers.get("retry-after");
    const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : undefined;
    if (status === 401)
        return { kind: "AUTHENTICATION" };
    if (status === 403) {
        // GitHub reports an exhausted limit as 403 + remaining 0.
        if (headers.get("x-ratelimit-remaining") === "0")
            return {
                kind: "RATE_LIMIT",
                ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
            };
        return { kind: "AUTHORIZATION" };
    }
    if (status === 429)
        return {
            kind: "RATE_LIMIT",
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        };
    if (status === 408 || status === 504)
        return { kind: "TRANSIENT" };
    if (status === 400 || status === 409 || status === 422)
        return { kind: "VALIDATION" };
    if (status === 404 || status === 410 || (status >= 300 && status < 400))
        return { kind: "PERMANENT" };
    if (status >= 500)
        return { kind: "PROVIDER_ERROR" };
    return { kind: "PERMANENT" };
}
function readRateLimit(h) {
    const num = (name) => {
        const v = h.get(name);
        return v !== null && /^\d+$/.test(v) ? Number(v) : undefined;
    };
    const remaining = num("x-ratelimit-remaining") ?? num("ratelimit-remaining");
    const limit = num("x-ratelimit-limit") ?? num("ratelimit-limit");
    const reset = num("x-ratelimit-reset");
    if (remaining === undefined && limit === undefined)
        return undefined;
    return {
        ...(remaining !== undefined ? { remaining } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(reset ? { resetAt: new Date(reset * 1000).toISOString() } : {}),
    };
}
function authHeaders(style, secret) {
    if (!secret || style === "none")
        return {};
    const value = secret.reveal();
    if (style === "basic")
        return { authorization: `Basic ${Buffer.from(value).toString("base64")}` };
    if (style === "x-figma-token")
        return { "x-figma-token": value };
    return { authorization: `Bearer ${value}` };
}
function fill(path, params) {
    return path.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name) => {
        const v = params[name];
        if (v === undefined || v === null || v === "")
            throw new Error(`missing path parameter "${name}"`);
        return encodeURIComponent(String(v));
    });
}
export function hostAllowed(url, allowed) {
    try {
        const u = new URL(url);
        if (u.protocol !== "https:" &&
            !(u.protocol === "http:" &&
                (u.hostname === "localhost" || u.hostname === "127.0.0.1")))
            return false;
        return allowed.some((h) => u.hostname === h ||
            (h.startsWith("*.") && u.hostname.endsWith(h.slice(1))));
    }
    catch {
        return false;
    }
}
export async function callRest(input) {
    const { manifest, cap, params, fetchImpl } = input;
    const http = cap.http;
    const started = input.now();
    const fail = (kind, message, status = 0, retryAfterMs) => ({
        ok: false,
        status,
        failure: {
            kind,
            message: maskSecrets(message).slice(0, 240),
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        },
        durationMs: input.now() - started,
    });
    let url;
    let body;
    try {
        const base = (http.baseUrl ?? input.baseUrl).replace(/\/+$/, "");
        url = `${base}${fill(http.path, params)}`;
        const q = new URLSearchParams();
        for (const name of http.query ?? []) {
            const v = params[name];
            if (v !== undefined && v !== null)
                q.set(name, Array.isArray(v) ? v.join(",") : String(v));
        }
        if ([...q].length > 0)
            url += `${url.includes("?") ? "&" : "?"}${q.toString()}`;
        if (http.graphql) {
            body = JSON.stringify({
                query: http.graphql.query,
                variables: Object.fromEntries(http.graphql.variables.map((n) => [n, params[n]])),
            });
        }
        else if (http.build || http.body || http.bodyStatic) {
            const payload = { ...(http.bodyStatic ?? {}) };
            if (http.build)
                Object.assign(payload, http.build(params));
            else if (http.body === "all")
                Object.assign(payload, params);
            else
                for (const n of http.body ?? [])
                    if (params[n] !== undefined)
                        payload[n] = params[n];
            body = JSON.stringify(payload);
        }
    }
    catch (error) {
        return fail("VALIDATION", error instanceof Error ? error.message : "invalid request");
    }
    // The host is pinned to the manifest: parameters can never redirect a credential elsewhere.
    if (!hostAllowed(url, manifest.allowedHosts))
        return fail("VALIDATION", "the request target is not an allowed host for this connector");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HUB_LIMITS.timeoutMs);
    try {
        const res = await fetchImpl(url, {
            method: http.graphql ? "POST" : http.method,
            redirect: "manual",
            signal: controller.signal,
            headers: {
                accept: "application/json",
                ...(body ? { "content-type": "application/json" } : {}),
                ...(manifest.defaultHeaders ?? {}),
                ...authHeaders(manifest.authStyle, input.secret),
            },
            ...(body ? { body } : {}),
        });
        const rateLimit = readRateLimit(res.headers);
        const text = await res.text();
        if (text.length > HUB_LIMITS.maxResponseBytes)
            return fail("PERMANENT", "the provider response was too large", res.status);
        if (!res.ok) {
            const c = classifyStatus(res.status, res.headers);
            let detail = "";
            try {
                const j = JSON.parse(text);
                detail = String(j["message"] ??
                    j["error"]?.["message"] ??
                    j["error"] ??
                    "");
            }
            catch {
                /* non-JSON error body */
            }
            const out = fail(c.kind, `provider returned ${res.status}${detail ? `: ${detail}` : ""}`, res.status, c.retryAfterMs);
            return rateLimit ? { ...out, rateLimit } : out;
        }
        let json = null;
        if (text.trim() !== "") {
            try {
                json = JSON.parse(text);
            }
            catch {
                json = { text: text.slice(0, 4000) };
            }
        }
        const bodyFailure = cap.bodyError?.(json);
        if (bodyFailure)
            return {
                ...fail(bodyFailure.kind, bodyFailure.message, res.status),
                ...(rateLimit ? { rateLimit } : {}),
            };
        const data = sanitize(cap.transform ? cap.transform(json, params) : json);
        return {
            ok: true,
            status: res.status,
            data,
            ...(rateLimit ? { rateLimit } : {}),
            durationMs: input.now() - started,
        };
    }
    catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        return fail(aborted ? "TRANSIENT" : "NETWORK", aborted
            ? "the provider did not answer in time"
            : "the provider could not be reached");
    }
    finally {
        clearTimeout(timer);
    }
}
