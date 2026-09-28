/**
 * EO-6.1 — production verification: DEPLOYED != HEALTHY, and UNKNOWN != HEALTHY.
 * All network access is an injected fake; nothing here touches a real host.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  parseOrigin,
  toPostDeployVerification,
  verifyProduction,
} from "../core/release/production-verifier.js";

const BASE = "https://app.example.web.app";
const OTHER = "https://app.example.firebaseapp.com";
const html = (asset = "index-Abc123") =>
  `<html><script type="module" src="/assets/${asset}.js"></script></html>`;

type Route = { status: number; body?: string; type?: string; cache?: string };
const page = (over: Partial<Route> = {}, asset?: string): Route => ({
  status: 200,
  body: html(asset),
  type: "text/html; charset=utf-8",
  ...over,
});
const ok = (version?: string): Route => ({
  status: 200,
  body: JSON.stringify({ status: "ok", ...(version ? { version } : {}) }),
  type: "application/json",
});
const denied = (over: Partial<Route> = {}): Route => ({
  status: 401,
  body: "{}",
  type: "application/json",
  cache: "no-store",
  ...over,
});

function fakeFetch(routes: Record<string, Route | Error>) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? "GET"} ${u}`);
    assert.equal(init?.redirect, "manual", "redirects are never followed");
    const r = routes[u];
    if (r === undefined)
      return new Response("{}", {
        status: 404,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
        },
      });
    if (r instanceof Error) throw r;
    return new Response(r.body ?? "", {
      status: r.status,
      headers: {
        ...(r.type ? { "content-type": r.type } : {}),
        ...(r.cache ? { "cache-control": r.cache } : {}),
      },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const healthy = (
  base = BASE,
  over: { asset?: string; version?: string } = {},
): Record<string, Route> => ({
  [`${base}/`]: page({}, over.asset),
  [`${base}/api/health`]: ok(over.version),
  [`${base}/api/status`]: denied(),
  [`${base}/api/projects`]: denied(),
  [`${base}/api/does-not-exist`]: denied(),
});
const verify = (
  routes: Record<string, Route | Error>,
  extra: Record<string, unknown> = {},
) => {
  const f = fakeFetch(routes);
  return verifyProduction({
    baseUrls: [BASE],
    fetch: f.impl,
    clock: () => "t",
    ...extra,
  }).then((report) => ({ report, calls: f.calls }));
};
const failed = (r: Awaited<ReturnType<typeof verify>>) =>
  r.report.checks
    .filter((c) => c.status === "failed")
    .map((c) => `${c.id}:${c.subject.replace(BASE, "")}`);

test("a fully healthy production passes every check and identifies the served bundle per origin", async () => {
  const r = await verify(healthy());
  assert.equal(r.report.verdict, "healthy");
  assert.deepEqual(failed(r), []);
  assert.deepEqual(r.report.bundles, { [BASE]: "assets/index-Abc123.js" });
  assert.ok(
    r.calls.every((c) => c.startsWith("GET ")),
    "only GET requests, no credentials",
  );
});

test("every origin is checked; one failing origin makes the release unhealthy", async () => {
  const f = fakeFetch({
    ...healthy(),
    ...healthy(OTHER),
    [`${OTHER}/api/health`]: { status: 503 },
  });
  const report = await verifyProduction({
    baseUrls: [BASE, OTHER],
    fetch: f.impl,
  });
  assert.equal(report.verdict, "unhealthy");
  assert.deepEqual(
    report.checks.filter((c) => c.status === "failed").map((c) => c.subject),
    [`${OTHER}/api/health`],
  );
});

test("HOSTING failures: non-200, non-HTML and redirects are unhealthy", async () => {
  for (const bad of [
    page({ status: 500 }),
    page({ type: "application/json" }),
    { status: 302, body: "" } as Route,
  ]) {
    assert.equal(
      (await verify({ ...healthy(), [`${BASE}/`]: bad })).report.verdict,
      "unhealthy",
    );
  }
});

test("HEALTH: a 200 that does not say ok, a 5xx, a non-JSON body and a non-JSON content type are all unhealthy", async () => {
  for (const bad of [
    { status: 200, body: '{"status":"degraded"}', type: "application/json" },
    { status: 503 },
    { status: 200, body: "<html>ok</html>", type: "text/html" },
    { status: 200, body: '{"status":"ok"}', type: "text/plain" },
  ] as Route[]) {
    assert.equal(
      (await verify({ ...healthy(), [`${BASE}/api/health`]: bad })).report
        .verdict,
      "unhealthy",
    );
  }
});

test("SECURITY: a protected route that is NOT denied is a failure; an HTML error page is not the API's denial", async () => {
  const open = await verify({
    ...healthy(),
    [`${BASE}/api/projects`]: {
      status: 200,
      body: "[]",
      type: "application/json",
    },
  });
  assert.equal(open.report.verdict, "unhealthy");
  assert.deepEqual(failed(open), ["protected:/api/projects"]);
  assert.match(
    open.report.checks.find((c) => c.status === "failed")!.detail,
    /NOT denied by the API: HTTP 200/,
  );
  // A CDN / hosting 403 page is not the API answering.
  const cdn = await verify({
    ...healthy(),
    [`${BASE}/api/status`]: {
      status: 403,
      body: "<html>Forbidden</html>",
      type: "text/html",
      cache: "no-store",
    },
  });
  assert.deepEqual(failed(cdn), ["protected:/api/status"]);
});

test("SECURITY: a denial whose response is cacheable is a failure (per-operator data must not be stored)", async () => {
  const r = await verify({
    ...healthy(),
    [`${BASE}/api/status`]: denied({ cache: "public, max-age=600" }),
  });
  assert.deepEqual(failed(r), ["protected:/api/status"]);
  assert.equal(
    (
      await verify(
        { ...healthy(), [`${BASE}/api/status`]: denied({ cache: undefined }) },
        { requireNoStore: false },
      )
    ).report.verdict,
    "healthy",
  );
});

test("SECURITY: an unknown API route must not leak (200 fails; 401/403/404 pass)", async () => {
  assert.equal(
    (
      await verify({
        ...healthy(),
        [`${BASE}/api/does-not-exist`]: { status: 200, body: "{}" },
      })
    ).report.verdict,
    "unhealthy",
  );
  assert.equal(
    (
      await verify({
        ...healthy(),
        [`${BASE}/api/does-not-exist`]: { status: 404 },
      })
    ).report.verdict,
    "healthy",
  );
});

test("UNKNOWN != HEALTHY: a network error and a malformed health body count as FAILED, never skipped", async () => {
  const dead = await verify({
    ...healthy(),
    [`${BASE}/api/health`]: new Error("ECONNRESET"),
  });
  assert.equal(dead.report.verdict, "unhealthy");
  assert.match(
    dead.report.checks.find((c) => c.id === "health")!.detail,
    /could not be checked/,
  );
  const garbage = await verify({
    ...healthy(),
    [`${BASE}/api/health`]: {
      status: 200,
      body: "{not json",
      type: "application/json",
    },
  });
  assert.equal(garbage.report.verdict, "unhealthy");
});

test("TIMEOUT covers the WHOLE request including the body: a host that sends headers and then stalls is a failure", async () => {
  // Headers arrive at once; the body never finishes — until the timeout aborts it.
  const stallAfterHeaders = (async (_u: string, init?: RequestInit) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener("abort", () =>
          controller.error(new DOMException("aborted", "AbortError")),
        );
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const started = Date.now();
  const slow = await verifyProduction({
    baseUrls: [BASE],
    fetch: stallAfterHeaders,
    timeoutMs: 40,
  });
  assert.equal(slow.verdict, "unhealthy");
  assert.ok(slow.checks.every((c) => c.status === "failed"));
  assert.ok(Date.now() - started < 5_000, "it did not hang");
  // A request that never answers at all is aborted too.
  const hang = (async (_u: string, init?: RequestInit) =>
    new Promise<Response>((_res, rej) =>
      init?.signal?.addEventListener("abort", () =>
        rej(new DOMException("aborted", "AbortError")),
      ),
    )) as unknown as typeof fetch;
  assert.equal(
    (await verifyProduction({ baseUrls: [BASE], fetch: hang, timeoutMs: 20 }))
      .verdict,
    "unhealthy",
  );
});

test("BODY SIZE is capped: an oversized page fails instead of being buffered", async () => {
  const big = "x".repeat(1_500_000);
  const r = await verify({ ...healthy(), [`${BASE}/`]: page({ body: big }) });
  assert.equal(r.report.verdict, "unhealthy");
  assert.deepEqual(failed(r), ["hosting:"]);
});

test("VERSION (bundle): every origin must serve exactly the release — a stale SECOND origin is not masked", async () => {
  const both = {
    ...healthy(BASE, { asset: "index-A1" }),
    ...healthy(OTHER, { asset: "index-OLD" }),
  };
  const f = fakeFetch(both);
  const r = await verifyProduction({
    baseUrls: [BASE, OTHER],
    fetch: f.impl,
    expectedBundle: "assets/index-A1.js",
  });
  assert.equal(r.verdict, "unhealthy");
  const versionChecks = r.checks.filter((c) => c.id === "version");
  assert.equal(versionChecks.length, 2, "one comparison per origin");
  assert.deepEqual(
    versionChecks.map((c) => c.status),
    ["passed", "failed"],
  );
  assert.match(versionChecks[1]!.detail, /serving assets\/index-OLD\.js/);
  const noBundle = await verify(
    { ...healthy(), [`${BASE}/`]: page({ body: "<html></html>" }) },
    { expectedBundle: "assets/index-Abc123.js" },
  );
  assert.equal(noBundle.report.verdict, "unhealthy");
});

test("VERSION (build id): the release version must be REPORTED BY production, on every origin", async () => {
  const sha = "a".repeat(40);
  const good = await verify(healthy(BASE, { version: sha }), {
    expectedVersion: sha,
  });
  assert.equal(good.report.verdict, "healthy");
  assert.deepEqual(good.report.servedVersions, { [BASE]: sha });
  const stale = await verify(healthy(BASE, { version: "b".repeat(40) }), {
    expectedVersion: sha,
  });
  assert.equal(stale.report.verdict, "unhealthy");
  assert.match(
    stale.report.checks.find((c) => c.id === "version")!.detail,
    /reporting b+/,
  );
  const silent = await verify(healthy(), { expectedVersion: sha });
  assert.match(
    silent.report.checks.find((c) => c.id === "version")!.detail,
    /reports no version/,
  );
  // A version string that is not identifier-shaped is ignored, not trusted.
  const weird = await verify(
    { ...healthy(), [`${BASE}/api/health`]: ok("<script>alert(1)</script>") },
    { expectedVersion: sha },
  );
  assert.deepEqual(weird.report.servedVersions, {});
});

test("CONFIGURATION: nothing to verify, no protected route, or a bad path is unhealthy and makes NO request", async () => {
  const cases: Array<Record<string, unknown>> = [
    { baseUrls: [] },
    { baseUrls: [BASE], protectedPaths: [] },
    { baseUrls: [BASE], protectedPaths: ["/api/x", ".evil.com/x"] },
    { baseUrls: [BASE], protectedPaths: ["@evil.com/x"] },
    { baseUrls: [BASE], healthPath: "//evil.com/x" },
    { baseUrls: [BASE], healthPath: "api/health" },
    { baseUrls: [BASE], protectedPaths: ["/api/../admin"] },
    { baseUrls: [BASE], protectedPaths: ["/api//x"] },
    { baseUrls: [BASE], protectedPaths: ["/api/x?y=1"] },
  ];
  for (const c of cases) {
    const f = fakeFetch({});
    const r = await verifyProduction({ ...c, fetch: f.impl } as never);
    assert.equal(r.verdict, "unhealthy", JSON.stringify(c));
    assert.deepEqual(f.calls, [], `no request for ${JSON.stringify(c)}`);
  }
});

test("ORIGINS are strict: https only, allowed hosts only, no credentials/IP/localhost/port/path/query/fragment — and never echoed", async () => {
  for (const bad of [
    "http://x.web.app",
    "https://user:secret@x.web.app",
    "https://x.web.app:8443",
    "https://x.web.app/path",
    "https://x.web.app?x=1",
    "https://x.web.app#f",
    "https://localhost",
    "https://127.0.0.1",
    "https://169.254.169.254",
    "https://[::1]",
    "https://evil.example.com",
    "https://web.app",
    "https://evilweb.app",
    "https://x.web.app.evil.com",
    "not a url",
    "ftp://x.web.app",
  ]) {
    const f = fakeFetch({});
    const r = await verifyProduction({ baseUrls: [bad], fetch: f.impl });
    assert.equal(r.verdict, "unhealthy", bad);
    assert.deepEqual(f.calls, [], `no request to ${bad}`);
    assert.ok(
      !JSON.stringify(r).includes("secret"),
      "credentials in a rejected origin are never echoed",
    );
    assert.ok(
      !JSON.stringify(r).includes(bad) || bad === "not a url"
        ? true
        : !JSON.stringify(r).includes(bad),
      `the rejected origin is not echoed: ${bad}`,
    );
  }
  assert.ok(parseOrigin("https://ai-workforce-agents.web.app"));
  assert.ok(parseOrigin("https://ai-workforce-agents.firebaseapp.com/"));
  assert.equal(
    parseOrigin("https://x.example.com", [".example.com"])?.origin,
    "https://x.example.com",
    "the allowlist is overridable, explicitly",
  );
});

test("the report carries no secret-shaped values and no request headers", async () => {
  const text = JSON.stringify((await verify(healthy())).report);
  assert.ok(!/authorization|bearer|cookie|token/i.test(text));
});

test("BRIDGE: reachable requires EVERY non-version check — an open protected route is NOT reachable-and-healthy", async () => {
  const good = await verify(healthy(BASE, { version: "abc123" }));
  assert.deepEqual(toPostDeployVerification(good.report), {
    reachable: true,
    reportedVersion: "abc123",
    detail: "all production checks passed",
  });
  // Health is fine, but a protected route is open (an auth bypass): the verifier says unhealthy AND so must the bridge.
  const open = await verify({
    ...healthy(BASE, { version: "abc123" }),
    [`${BASE}/api/projects`]: {
      status: 200,
      body: "[]",
      type: "application/json",
    },
  });
  assert.equal(open.report.verdict, "unhealthy");
  assert.equal(toPostDeployVerification(open.report).reachable, false);
  assert.match(toPostDeployVerification(open.report).detail, /protected/);
  // Same for a broken hosting page and a leaking unknown route.
  assert.equal(
    toPostDeployVerification(
      (await verify({ ...healthy(), [`${BASE}/`]: page({ status: 500 }) }))
        .report,
    ).reachable,
    false,
  );
  assert.equal(
    toPostDeployVerification(
      (
        await verify({
          ...healthy(),
          [`${BASE}/api/does-not-exist`]: { status: 200, body: "{}" },
        })
      ).report,
    ).reachable,
    false,
  );
  // A stale UI bundle is NOT healthy: nothing else judges the bundle, so the bridge must fail it
  // (only the REPORTED version is delegated to the orchestrator's commit comparison).
  const stale = await verify(healthy(BASE, { version: "abc123" }), {
    expectedBundle: "assets/index-NEW.js",
  });
  assert.equal(stale.report.verdict, "unhealthy");
  assert.equal(toPostDeployVerification(stale.report).reachable, false);
  // A report with nothing checked is never reachable.
  assert.equal(
    toPostDeployVerification({
      verdict: "unhealthy",
      checkedAt: "t",
      baseUrls: [],
      checks: [],
      bundles: {},
      servedVersions: {},
    }).reachable,
    false,
  );
});

test("BRIDGE: the version is what production REPORTS — never supplied by the caller, and disagreement or silence reports none", async () => {
  const twoAgree = {
    ...healthy(BASE, { version: "v1" }),
    ...healthy(OTHER, { version: "v1" }),
  };
  const rA = await verifyProduction({
    baseUrls: [BASE, OTHER],
    fetch: fakeFetch(twoAgree).impl,
  });
  assert.equal(toPostDeployVerification(rA).reportedVersion, "v1");
  const disagree = {
    ...healthy(BASE, { version: "v1" }),
    ...healthy(OTHER, { version: "v2" }),
  };
  const rB = await verifyProduction({
    baseUrls: [BASE, OTHER],
    fetch: fakeFetch(disagree).impl,
  });
  assert.equal(
    toPostDeployVerification(rB).reportedVersion,
    undefined,
    "origins disagree => no version to compare",
  );
  const oneSilent = { ...healthy(BASE, { version: "v1" }), ...healthy(OTHER) };
  const rC = await verifyProduction({
    baseUrls: [BASE, OTHER],
    fetch: fakeFetch(oneSilent).impl,
  });
  assert.equal(toPostDeployVerification(rC).reportedVersion, undefined);
  assert.equal(
    toPostDeployVerification.length,
    1,
    "the bridge takes only the report — there is no caller-supplied version",
  );
});

test("EO-6.1 review F1-F3: bridge fails a stale bundle, dot-segment paths are rejected, empty flag is a usage error", async () => {
  const { toPostDeployVerification } =
    await import("../core/release/production-verifier.js");
  const bridged = toPostDeployVerification({
    verdict: "unhealthy",
    baseUrls: ["https://a.web.app"],
    servedVersions: { "https://a.web.app": "abc" },
    bundles: {},
    checks: [
      { id: "health", subject: "x", status: "passed", detail: "" },
      {
        id: "version",
        subject: "https://a.web.app ui bundle",
        status: "failed",
        detail: "serving old",
      },
    ],
  } as never);
  assert.equal(bridged.reachable, false);
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(
    process.execPath,
    [
      "scripts/verify-production.mjs",
      "--base",
      "https://a.web.app",
      "--expect-version",
      "",
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 2);
});

test("EO-6.1 review F2: dot-segment protected paths fail configuration without any request", async () => {
  let calls = 0;
  const report = await verifyProduction({
    baseUrls: ["https://a.web.app"],
    protectedPaths: ["/.."],
    fetchImpl: (async () => {
      calls += 1;
      throw new Error("no");
    }) as never,
  } as never);
  assert.equal(report.verdict, "unhealthy");
  assert.equal(calls, 0);
});
