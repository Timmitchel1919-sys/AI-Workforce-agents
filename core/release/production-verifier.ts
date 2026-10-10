/**
 * Production verification (EO-6.1): the explicit stage AFTER a deployment.
 *
 *   DEPLOYED != HEALTHY.  A successful deploy command only means the provider accepted the
 *   release. This module asks the running system whether it is actually healthy and is actually
 *   the build that was meant to ship.
 *
 * It is an injectable HTTP checker: it holds no credentials, does not follow redirects, sends no
 * authentication, and performs only GET requests. Every check ends `passed` or `failed` — a check
 * that could not be performed is `failed` (UNKNOWN != HEALTHY), never silently skipped. The verdict
 * is `healthy` only when EVERY check passed.
 */
export type ProductionCheckStatus = "passed" | "failed";

export interface ProductionCheck {
  id: string;
  /** What was checked (an origin + path, never a credential or a header value). */
  subject: string;
  status: ProductionCheckStatus;
  detail: string;
}

export interface ProductionVerificationReport {
  /** `healthy` only if every check passed; anything else is `unhealthy`. */
  verdict: "healthy" | "unhealthy";
  checkedAt: string;
  baseUrls: readonly string[];
  checks: readonly ProductionCheck[];
  /** UI build identity (main script asset) served by each origin, when it could be read. */
  bundles: Readonly<Record<string, string>>;
  /**
   * Build/version identity each origin's health endpoint REPORTS (`{"version": …}`). This is what
   * production says about itself — never what the caller believes it deployed.
   */
  servedVersions: Readonly<Record<string, string>>;
}

export interface ProductionVerificationInput {
  /** Origins to verify. Each must be an https origin on an allowed host. */
  baseUrls: readonly string[];
  /** Hosts a verification may contact (suffix match on a dot boundary). Default: Firebase Hosting. */
  allowedHostSuffixes?: readonly string[];
  /** Routes that must DENY an unauthenticated caller (401/403, JSON, not cacheable). At least one. */
  protectedPaths?: readonly string[];
  /** Health route. Default `/api/health`. */
  healthPath?: string;
  /** Every origin must serve exactly this UI script asset (e.g. `assets/index-abc.js`). */
  expectedBundle?: string;
  /** Every origin's health endpoint must report exactly this version (e.g. the commit SHA). */
  expectedVersion?: string;
  /** API responses that carry per-operator data must not be cacheable. Default true. */
  requireNoStore?: boolean;
  fetch?: typeof fetch;
  clock?: () => string;
  /** Timeout for a whole request INCLUDING reading its body. Default 15 000 ms. */
  timeoutMs?: number;
}

const DEFAULT_PROTECTED = ["/api/status", "/api/projects"] as const;
const DEFAULT_HOSTS = [".web.app", ".firebaseapp.com"] as const;
const MAX_BODY_BYTES = 1_000_000;
/** A path: starts with one `/`, URL-safe characters only, no `//` and no `.`/`..` segments. */
const PATH = /^\/(?!\/)(?!.*\/\/)[A-Za-z0-9._~\-/]*$/;
const VERSION = /^[A-Za-z0-9._-]{1,80}$/;

/** A strict https origin on an allowed host, with no credentials, port, path, query or fragment. */
export function parseOrigin(
  raw: string,
  allowedHostSuffixes: readonly string[] = DEFAULT_HOSTS,
): URL | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const clean =
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    url.search === "" &&
    url.hash === "" &&
    url.pathname === "/" &&
    // `new URL("https://x.web.app")` prints without a trailing slash only in `.origin`
    raw.replace(/\/$/, "") === url.origin;
  if (!clean) return undefined;
  const host = url.hostname.toLowerCase();
  const ip = /^[0-9.]+$/.test(host) || host.includes(":");
  if (
    ip ||
    !allowedHostSuffixes.some((s) => host.endsWith(s) && host.length > s.length)
  )
    return undefined;
  return url;
}

/** Reads a body with a hard size cap; the caller's abort signal covers the whole read. */
async function readCapped(r: Response): Promise<string | undefined> {
  const declared = Number(r.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return undefined;
  if (!r.body) return "";
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function verifyProduction(
  input: ProductionVerificationInput,
): Promise<ProductionVerificationReport> {
  const doFetch = input.fetch ?? fetch;
  const timeoutMs = input.timeoutMs ?? 15_000;
  const health = input.healthPath ?? "/api/health";
  const protectedPaths = input.protectedPaths ?? DEFAULT_PROTECTED;
  const checks: ProductionCheck[] = [];
  const bundles: Record<string, string> = {};
  const servedVersions: Record<string, string> = {};
  const record = (
    id: string,
    subject: string,
    ok: boolean,
    detail: string,
  ): void => {
    checks.push({ id, subject, status: ok ? "passed" : "failed", detail });
  };
  /** One request, its body read, all under ONE timeout. `redirect: manual`: a redirect is a finding. */
  const get = async (
    url: string,
  ): Promise<{
    status: number;
    headers: Headers;
    body: string | undefined;
  }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await doFetch(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
      return {
        status: r.status,
        headers: r.headers,
        body: await readCapped(r),
      };
    } finally {
      clearTimeout(timer);
    }
  };
  const guarded = async (
    id: string,
    subject: string,
    run: () => Promise<{ ok: boolean; detail: string }>,
  ): Promise<void> => {
    try {
      const r = await run();
      record(id, subject, r.ok, r.detail);
    } catch (error) {
      // Could not be performed => not verified => failed.
      record(
        id,
        subject,
        false,
        `could not be checked: ${error instanceof Error ? error.name : "error"}`,
      );
    }
  };
  const isJson = (h: Headers) =>
    (h.get("content-type") ?? "").includes("application/json");

  // Configuration is validated before ANY request, and every path is validated as a path.
  const paths = [health, ...protectedPaths];
  if (protectedPaths.length === 0)
    record(
      "configuration",
      "protectedPaths",
      false,
      "at least one protected route is required",
    );
  for (const p of paths)
    if (
      !PATH.test(p) ||
      p
        .split("/")
        .slice(1)
        .some((seg) => seg === "." || seg === "..")
    )
      record(
        "configuration",
        "path",
        false,
        "paths must start with / and contain only URL-safe characters",
      );
  if (input.baseUrls.length === 0)
    record("configuration", "baseUrls", false, "no origin to verify");
  const origins: string[] = [];
  for (const raw of input.baseUrls) {
    const u = parseOrigin(raw, input.allowedHostSuffixes);
    if (u) origins.push(u.origin);
    // The rejected value is NOT echoed (it could carry credentials).
    else
      record(
        "configuration",
        "origin",
        false,
        "origin must be an https origin on an allowed host, without credentials, port, path, query or fragment",
      );
  }
  const configured = checks.every((c) => c.status === "passed");

  if (configured) {
    for (const base of origins) {
      await guarded("hosting", base, async () => {
        const r = await get(`${base}/`);
        const ok =
          r.status === 200 &&
          (r.headers.get("content-type") ?? "").includes("text/html") &&
          r.body !== undefined;
        const asset = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(
          r.body ?? "",
        )?.[0];
        if (asset) bundles[base] = asset;
        return {
          ok,
          detail: `HTTP ${r.status}${ok && !asset ? " (no UI bundle found)" : ""}`,
        };
      });
      await guarded("health", `${base}${health}`, async () => {
        const r = await get(`${base}${health}`);
        let parsed: { status?: unknown; version?: unknown } | undefined;
        if (r.status === 200 && isJson(r.headers) && r.body !== undefined)
          parsed = JSON.parse(r.body) as typeof parsed;
        if (typeof parsed?.version === "string" && VERSION.test(parsed.version))
          servedVersions[base] = parsed.version;
        return {
          ok: r.status === 200 && parsed?.status === "ok",
          detail: `HTTP ${r.status}`,
        };
      });
      for (const path of protectedPaths) {
        await guarded("protected", `${base}${path}`, async () => {
          const r = await get(`${base}${path}`);
          // A denial must be the API's own JSON denial — a CDN/hosting error page is not the API.
          const denied =
            (r.status === 401 || r.status === 403) && isJson(r.headers);
          const noStore = (r.headers.get("cache-control") ?? "").includes(
            "no-store",
          );
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
        return {
          ok: r.status === 401 || r.status === 403 || r.status === 404,
          detail: `HTTP ${r.status}`,
        };
      });
    }
    // Identity is compared PER ORIGIN: a stale second origin must not be masked by a fresh first one.
    for (const base of origins) {
      if (input.expectedBundle !== undefined) {
        const served = bundles[base];
        record(
          "version",
          `${base} ui bundle`,
          served === input.expectedBundle,
          served === undefined
            ? "served bundle could not be identified"
            : served === input.expectedBundle
              ? "matches the release"
              : `serving ${served}`,
        );
      }
      if (input.expectedVersion !== undefined) {
        const served = servedVersions[base];
        record(
          "version",
          `${base} reported version`,
          served === input.expectedVersion,
          served === undefined
            ? "the health endpoint reports no version"
            : served === input.expectedVersion
              ? "matches the release"
              : `reporting ${served}`,
        );
      }
    }
  }
  return {
    verdict:
      checks.length > 0 && checks.every((c) => c.status === "passed")
        ? "healthy"
        : "unhealthy",
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
export function toPostDeployVerification(
  report: ProductionVerificationReport,
): { reachable: boolean; reportedVersion?: string; detail: string } {
  // Only the REPORTED-version check is delegated to the orchestrator (it compares against the commit);
  // a stale UI bundle is a version-id check too, but nothing else judges it, so it must fail here.
  const nonVersion = report.checks.filter(
    (c) => !(c.id === "version" && c.subject.endsWith("reported version")),
  );
  const failed = report.checks.filter((c) => c.status === "failed");
  const versions = new Set(Object.values(report.servedVersions));
  const oneVersion =
    versions.size === 1 &&
    Object.keys(report.servedVersions).length === report.baseUrls.length;
  return {
    reachable:
      nonVersion.length > 0 &&
      nonVersion.every((c) => c.status === "passed") &&
      report.baseUrls.length > 0,
    ...(oneVersion ? { reportedVersion: [...versions][0] } : {}),
    detail:
      failed.length === 0
        ? "all production checks passed"
        : `failed: ${failed
            .map((c) => `${c.id} ${c.subject}`)
            .join("; ")
            .slice(0, 300)}`,
  };
}
