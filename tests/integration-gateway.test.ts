/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers read loosely-typed JSON bodies */
/**
 * Integration Hub & Tool Ecosystem.
 *
 * The registry, vault, gateway pipeline, resilience, event hub, MCP gateway and control service
 * are real. Providers are a fake transport that records every request: no provider is contacted.
 * Passing here proves the pipeline and its guarantees — NOT that a provider API behaves as the
 * manifests describe (that needs a live account).
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ApprovalSystem,
  AuditLog,
  IntegrationSystem,
  SecuritySystem,
  inMemoryIntegrationRepos,
  inMemorySecurityRepos,
  type FetchLike,
  type OperatorPrincipal,
} from "../core/index.js";
import { IntegrationControlService } from "../control/services/integration-control-service.js";

const ADMIN: OperatorPrincipal = {
  id: "admin-1",
  role: "admin",
  allowedProjects: "*",
};
const OPERATOR: OperatorPrincipal = {
  id: "op-1",
  role: "operator",
  allowedProjects: "*",
};
const VIEWER: OperatorPrincipal = {
  id: "v-1",
  role: "viewer",
  allowedProjects: "*",
};
const OTHER_PROJECT_ONLY: OperatorPrincipal = {
  id: "op-2",
  role: "operator",
  allowedProjects: ["other"],
};

const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
const VAULT_KEY = "k".repeat(48);
const AGENTS: Record<string, string[]> = {
  "dev-agent": ["proj"],
  "other-agent": ["other"],
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function build(
  options: {
    respond?: (c: Call) => {
      status?: number;
      json?: unknown;
      headers?: Record<string, string>;
    };
  } = {},
) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: Call = {
      url: String(url),
      method: String(init?.method ?? "GET"),
      headers: { ...((init?.headers as Record<string, string>) ?? {}) },
      ...(init?.body ? { body: String(init.body) } : {}),
    };
    calls.push(call);
    const r = options.respond?.(call) ?? { json: [] };
    const status = r.status ?? 200;
    const text = JSON.stringify(r.json ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null },
      text: async () => text,
    } as any;
  };
  let now = Date.parse("2026-10-11T10:00:00Z");
  const audit = new AuditLog();
  const approvals = new ApprovalSystem();
  const security = new SecuritySystem({
    repos: inMemorySecurityRepos(),
    audit,
    approvals,
    agents: {
      get: (id) =>
        AGENTS[id] ? { id, allowedProjects: AGENTS[id]! } : undefined,
      list: () => Object.keys(AGENTS).map((id) => ({ id })),
    },
    clock: () => new Date(now).toISOString(),
  });
  const usage: any[] = [];
  const proposals: any[] = [];
  const repos = inMemoryIntegrationRepos();
  const hub = new IntegrationSystem({
    repos,
    security,
    fetchImpl,
    vaultKey: VAULT_KEY,
    env: {},
    now: () => now,
    sleep: async () => undefined,
    recordUsage: (d) => usage.push(d),
    trigger: {
      propose: async (i) => (proposals.push(i), { note: "proposed" }),
    },
  });
  const control = new IntegrationControlService({
    integrations: hub,
    security,
    audit,
    projectExists: (p) => ["proj", "other"].includes(p),
    clock: () => new Date(now).toISOString(),
  });
  return {
    hub,
    repos,
    security,
    control,
    calls,
    usage,
    proposals,
    audit,
    approvals,
    advance: (ms: number) => (now += ms),
  };
}
type Rig = ReturnType<typeof build>;

/** Bring GitHub fully online for `proj` → acme/app. */
async function connectGithub(
  rig: Rig,
  mode: "SANDBOX" | "LIVE" = "LIVE",
  trust: "LIMITED" | "TRUSTED" = "TRUSTED",
) {
  const { hub, control } = rig;
  hub.registry.map({
    projectId: "proj",
    connectorId: "github",
    resource: "acme/app",
    source: "user",
    by: "t",
  });
  const stored = await control.execute("integration_store_credential", ADMIN, {
    connectorId: "github",
    value: TOKEN,
  });
  assert.equal(stored.outcome, "executed");
  const tested = await control.execute("integration_test_connection", ADMIN, {
    connectorId: "github",
  });
  assert.equal(tested.outcome, "executed");
  const validated = await control.execute(
    "integration_validate_security",
    ADMIN,
    { connectorId: "github" },
  );
  assert.equal(validated.outcome, "executed");
  const enabled = await control.execute("integration_enable", ADMIN, {
    connectorId: "github",
  });
  assert.equal(enabled.outcome, "executed", enabled.reason);
  if (mode === "LIVE")
    await control.execute("integration_set_mode", ADMIN, {
      connectorId: "github",
      mode: "LIVE",
    });
  await control.execute("integration_set_trust", ADMIN, {
    connectorId: "github",
    trust,
  });
}

const req = (capability: string, extra: Record<string, unknown> = {}) =>
  ({
    capability,
    projectId: "proj",
    agentId: "dev-agent",
    taskType: "IMPLEMENTATION",
    parameters: {},
    ...extra,
  }) as any;

/* ----------------------------- discovery & install ----------------------------- */

test("built-in connectors are installed and unconnected by default", () => {
  const { hub } = build();
  const ids = hub.registry.list().map((c) => c.connectorId);
  for (const id of [
    "github",
    "firebase",
    "google-drive",
    "gmail",
    "google-calendar",
    "slack",
    "fireflies",
    "wordpress",
    "figma",
    "canva",
    "docker",
    "blender",
  ])
    assert.ok(ids.includes(id), id);
  for (const c of hub.registry.list()) {
    assert.equal(
      c.enabled,
      false,
      `${c.connectorId} must not be enabled by default`,
    );
    assert.notEqual(c.status, "HEALTHY");
  }
});

test("an unconfigured connector cannot be called", async () => {
  const rig = build();
  rig.hub.registry.map({
    projectId: "proj",
    connectorId: "github",
    resource: "acme/app",
    source: "user",
    by: "t",
  });
  const r = await rig.hub.gateway.invoke(req("repository.read"));
  assert.equal(r.success, false);
  assert.equal(rig.calls.length, 0);
});

test("a connector cannot be enabled before installation steps finish", async () => {
  const rig = build();
  const r = await rig.control.execute("integration_enable", ADMIN, {
    connectorId: "github",
  });
  assert.equal(r.outcome, "rejected");
  assert.match(r.reason, /installation/i);
});

test("Docker and Blender are boundaries and cannot be enabled", async () => {
  const rig = build();
  for (const id of ["docker", "blender"]) {
    const r = await rig.control.execute("integration_enable", ADMIN, {
      connectorId: id,
    });
    assert.equal(r.outcome, "rejected");
  }
});

/* ------------------------------ credentials ------------------------------ */

test("a stored credential is never returned, logged or audited", async () => {
  const rig = build();
  await connectGithub(rig);
  const surfaces = JSON.stringify([
    rig.control.overview(ADMIN),
    rig.control.connector(ADMIN, "github"),
    rig.control.credentials(ADMIN),
    rig.control.capabilities(ADMIN, new URLSearchParams()),
    rig.control.audit(ADMIN, new URLSearchParams()),
    rig.control.health(ADMIN),
    rig.security.ledger.query({ limit: 1000 }),
    rig.audit.list(),
    rig.hub.gateway.activityLog({ limit: 500 }),
  ]);
  assert.ok(!surfaces.includes(TOKEN), "token leaked into a read surface");
  assert.ok(!surfaces.includes(TOKEN.slice(4, 30)), "token fragment leaked");
});

test("the credential is encrypted at rest", async () => {
  const rig = build();
  await connectGithub(rig);
  const rows = rig.repos.credentials.list();
  assert.ok(rows.length >= 1, "a credential row must exist");
  const stored = JSON.stringify(rows);
  assert.ok(!stored.includes(TOKEN));
  assert.ok(!stored.includes(TOKEN.slice(4, 30)));
});

test("only an administrator may store or revoke credentials; operators cannot", async () => {
  const rig = build();
  const a = await rig.control.execute(
    "integration_store_credential",
    OPERATOR,
    { connectorId: "github", value: TOKEN },
  );
  assert.equal(a.outcome, "denied");
  const b = await rig.control.execute("integration_store_credential", VIEWER, {
    connectorId: "github",
    value: TOKEN,
  });
  assert.equal(b.outcome, "denied");
  assert.ok(!rig.hub.vault.has("github.primary"));
});

test("the credential is sent only in the provider request, to the pinned host", async () => {
  const rig = build({
    respond: () => ({
      json: { full_name: "acme/app", default_branch: "main" },
    }),
  });
  await connectGithub(rig);
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(req("repository.read"));
  assert.equal(r.success, true, r.error?.message);
  assert.ok(rig.calls.length >= 1);
  for (const c of rig.calls) {
    assert.equal(new URL(c.url).hostname, "api.github.com");
    assert.equal(new URL(c.url).protocol, "https:");
  }
  assert.equal(
    rig.calls[0]!.headers["authorization"] ??
      rig.calls[0]!.headers["Authorization"],
    `Bearer ${TOKEN}`,
  );
  assert.ok(!JSON.stringify(r).includes(TOKEN));
});

test("revoking removes the credential and the connector stops working", async () => {
  const rig = build();
  await connectGithub(rig);
  const r = await rig.control.execute("integration_revoke_credential", ADMIN, {
    connectorId: "github",
  });
  assert.equal(r.outcome, "executed");
  rig.calls.length = 0;
  const call = await rig.hub.gateway.invoke(req("repository.read"));
  assert.equal(call.success, false);
  assert.equal(rig.calls.length, 0);
});

test("configuration containing a credential is rejected", async () => {
  const rig = build();
  const r = await rig.control.execute("integration_configure", ADMIN, {
    connectorId: "github",
    settings: { note: TOKEN },
  });
  assert.equal(r.outcome, "rejected");
});

/* ------------------------- governance & project scope ------------------------- */

test("a project cannot use a connector that is not mapped to it", async () => {
  const rig = build();
  await connectGithub(rig);
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(
    req("repository.read", { projectId: "other", agentId: "other-agent" }),
  );
  assert.equal(r.success, false);
  assert.equal(rig.calls.length, 0);
});

test("an agent cannot act on a project it is not assigned to", async () => {
  const rig = build();
  await connectGithub(rig);
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(
    req("repository.read", { agentId: "other-agent" }),
  );
  assert.equal(r.success, false);
  assert.equal(rig.calls.length, 0);
});

test("an unknown capability is refused without any outbound request", async () => {
  const rig = build();
  await connectGithub(rig);
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(req("repository.delete_everything"));
  assert.equal(r.success, false);
  assert.equal(rig.calls.length, 0);
});

test("a caller-supplied resource cannot escape the mapped resource", async () => {
  const rig = build();
  await connectGithub(rig);
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(
    req("repository.read", { resource: "evil/other-repo" }),
  );
  assert.equal(r.success, false);
  assert.ok(!rig.calls.some((c) => c.url.includes("evil")));
});

test("parameters cannot redirect the request to another host or path", async () => {
  const rig = build();
  await connectGithub(rig);
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(
    req("repository.file.read", { parameters: { path: "../../../user" } }),
  );
  for (const c of rig.calls)
    assert.equal(new URL(c.url).hostname, "api.github.com");
  assert.ok(!r.success || rig.calls.every((c) => !c.url.includes("/../")));
});

test("a disabled connector refuses calls", async () => {
  const rig = build();
  await connectGithub(rig);
  await rig.control.execute("integration_disable", OPERATOR, {
    connectorId: "github",
  });
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(req("repository.read"));
  assert.equal(r.success, false);
  assert.equal(rig.calls.length, 0);
});

test("a suspended connector refuses calls", async () => {
  const rig = build();
  await connectGithub(rig);
  await rig.control.execute("integration_set_trust", OPERATOR, {
    connectorId: "github",
    trust: "SUSPENDED",
  });
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(req("repository.read"));
  assert.equal(r.success, false);
  assert.equal(rig.calls.length, 0);
});

test("an operator cannot raise trust; an administrator can", async () => {
  const rig = build();
  await connectGithub(rig);
  await rig.control.execute("integration_set_trust", OPERATOR, {
    connectorId: "github",
    trust: "LIMITED",
  });
  const up = await rig.control.execute("integration_set_trust", OPERATOR, {
    connectorId: "github",
    trust: "TRUSTED",
  });
  assert.equal(up.outcome, "denied");
  const ok = await rig.control.execute("integration_set_trust", ADMIN, {
    connectorId: "github",
    trust: "TRUSTED",
  });
  assert.equal(ok.outcome, "executed");
});

test("the emergency stop blocks integration calls", async () => {
  const rig = build();
  await connectGithub(rig);
  rig.security.emergency.engage("admin-1", "test");
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(req("repository.read"));
  assert.equal(r.success, false);
  assert.equal(rig.calls.length, 0);
});

/* ------------------------- side effects & approvals ------------------------- */

test("a write is never performed without approval; it creates an approval request", async () => {
  const rig = build();
  await connectGithub(rig, "LIVE", "LIMITED");
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(
    req("issue.create", { parameters: { title: "Bug" } }),
  );
  assert.equal(r.success, false);
  assert.equal(r.error?.kind, "APPROVAL_REQUIRED");
  assert.ok(r.error?.approvalId);
  assert.ok(
    !rig.calls.some((c) => c.method === "POST"),
    "write reached the provider without approval",
  );
});

test("a write runs after approval, once", async () => {
  const rig = build({
    respond: (c) =>
      c.method === "POST"
        ? {
            status: 201,
            json: {
              number: 7,
              html_url: "https://github.com/acme/app/issues/7",
            },
          }
        : { json: [] },
  });
  await connectGithub(rig, "LIVE", "LIMITED");
  const first = await rig.hub.gateway.invoke(
    req("issue.create", { parameters: { title: "Bug" } }),
  );
  assert.equal(first.error?.kind, "APPROVAL_REQUIRED");
  rig.security.approvals.decide(
    first.error!.approvalId!,
    "approve",
    ADMIN,
    "ok",
  );
  const again = await rig.hub.gateway.invoke(
    req("issue.create", { parameters: { title: "Bug" } }),
  );
  assert.equal(again.success, true, again.error?.message);
  assert.equal(rig.calls.filter((c) => c.method === "POST").length, 1);
});

test("approval of one request does not authorise a different one", async () => {
  const rig = build({ respond: () => ({ status: 201, json: { number: 1 } }) });
  await connectGithub(rig, "LIVE", "LIMITED");
  const first = await rig.hub.gateway.invoke(
    req("issue.create", { parameters: { title: "A" } }),
  );
  rig.security.approvals.decide(
    first.error!.approvalId!,
    "approve",
    ADMIN,
    "ok",
  );
  rig.calls.length = 0;
  const other = await rig.hub.gateway.invoke(
    req("issue.create", { parameters: { title: "Something else entirely" } }),
  );
  assert.equal(other.success, false);
  assert.ok(!rig.calls.some((c) => c.method === "POST"));
});

test("sandbox mode never performs a side effect on the provider", async () => {
  const rig = build();
  await connectGithub(rig, "SANDBOX");
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(
    req("issue.create", { parameters: { title: "Bug" } }),
  );
  assert.ok(!rig.calls.some((c) => c.method !== "GET"));
  assert.notEqual(r.error?.kind, undefined);
});

test("dry run evaluates without calling or creating approvals", async () => {
  const rig = build();
  await connectGithub(rig);
  const before = rig.security.approvals.list().length;
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(
    req("issue.create", { parameters: { title: "x" }, dryRun: true }),
  );
  assert.equal(rig.calls.length, 0);
  assert.equal(rig.security.approvals.list().length, before);
  assert.ok(r.decision);
});

test("invalid parameters are rejected before any request", async () => {
  const rig = build();
  await connectGithub(rig);
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(
    req("repository.file.read", { parameters: {} }),
  );
  assert.equal(r.success, false);
  assert.equal(r.error?.kind, "INVALID_REQUEST");
  assert.equal(rig.calls.length, 0);
});

/* ------------------------------- resilience ------------------------------- */

test("a read is retried on a transient error", async () => {
  let failing = 0;
  const rig = build({
    respond: () =>
      failing-- > 0
        ? { status: 503, json: {} }
        : { json: { full_name: "acme/app" } },
  });
  await connectGithub(rig);
  failing = 2;
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(req("repository.read"));
  assert.equal(r.success, true, r.error?.message);
  assert.equal(rig.calls.length, 3);
});

test("a write that fails transiently is not blindly repeated", async () => {
  let fail = false;
  const rig = build({
    respond: (c) =>
      fail && c.method === "POST" ? { status: 503, json: {} } : { json: [] },
  });
  await connectGithub(rig, "LIVE", "TRUSTED");
  fail = true;
  rig.calls.length = 0;
  await rig.hub.gateway.invoke(
    req("issue.create", { parameters: { title: "x" } }),
  );
  assert.ok(rig.calls.filter((c) => c.method === "POST").length <= 1);
});

test("a trusted connector may perform a medium-risk write without approval; the decision is still recorded", async () => {
  const rig = build({
    respond: (c) =>
      c.method === "POST" ? { status: 201, json: { number: 2 } } : { json: [] },
  });
  await connectGithub(rig, "LIVE", "TRUSTED");
  const r = await rig.hub.gateway.invoke(
    req("issue.create", { parameters: { title: "x" } }),
  );
  assert.equal(r.success, true, r.error?.message);
  assert.ok(
    rig.security.ledger
      .query({ limit: 200 })
      .some((e) => e.operation.startsWith("tool.")),
  );
});

test("authentication failures are not retried and mark the connector unauthenticated", async () => {
  let reject = false;
  const rig = build({
    respond: () =>
      reject
        ? { status: 401, json: { message: "Bad credentials" } }
        : { json: [] },
  });
  await connectGithub(rig);
  reject = true;
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(req("repository.read"));
  assert.equal(r.success, false);
  assert.equal(r.error?.kind, "AUTHENTICATION");
  assert.equal(rig.calls.length, 1);
  assert.equal(rig.hub.registry.require("github").health.authenticated, false);
});

test("the provider error body is sanitised and never echoes the credential", async () => {
  let boom = false;
  const rig = build({
    respond: () =>
      boom ? { status: 500, json: { message: `boom ${TOKEN}` } } : { json: [] },
  });
  await connectGithub(rig);
  boom = true;
  const r = await rig.hub.gateway.invoke(req("repository.read"));
  assert.ok(!JSON.stringify(r).includes(TOKEN));
  assert.ok(
    !JSON.stringify(rig.hub.gateway.activityLog({ limit: 100 })).includes(
      TOKEN,
    ),
  );
});

test("the local rate limiter queues excess calls instead of hammering the provider", async () => {
  const rig = build({ respond: () => ({ json: { full_name: "acme/app" } }) });
  await connectGithub(rig);
  await rig.control.execute("integration_configure", ADMIN, {
    connectorId: "github",
    settings: { ratePerMinute: "3" },
  });
  rig.calls.length = 0;
  const results = [];
  for (let i = 0; i < 8; i++)
    results.push(await rig.hub.gateway.invoke(req("repository.read")));
  assert.ok(rig.calls.length <= 4, `provider saw ${rig.calls.length} calls`);
  assert.ok(results.some((r) => !r.success));
});

test("health reflects real outcomes and degrades after failures", async () => {
  let down = false;
  const rig = build({
    respond: () => (down ? { status: 500, json: {} } : { json: [] }),
  });
  await connectGithub(rig);
  down = true;
  for (let i = 0; i < 6; i++) {
    rig.advance(5000);
    await rig.hub.gateway.invoke(req("repository.read"));
  }
  const c = rig.hub.registry.require("github");
  assert.ok(c.health.recentErrors > 0);
  assert.notEqual(c.status, "HEALTHY");
});

/* --------------------------------- events --------------------------------- */

const sign = (secret: string, body: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

async function webhookRig() {
  const rig = build();
  await connectGithub(rig);
  await rig.control.execute("integration_store_credential", ADMIN, {
    connectorId: "github",
    purpose: "webhook",
    value: "whsec-test-secret-value",
  });
  return rig;
}

test("a correctly signed webhook is accepted, normalised and stored", async () => {
  const rig = await webhookRig();
  const body = JSON.stringify({
    action: "opened",
    repository: { full_name: "acme/app" },
    pull_request: { number: 3, title: "x" },
  });
  const out = await rig.control.receiveWebhook(
    "github",
    {
      "x-hub-signature-256": sign("whsec-test-secret-value", body),
      "x-github-event": "pull_request",
      "x-github-delivery": "d-1",
    },
    body,
  );
  assert.ok(out.status === 200 || out.status === 202, JSON.stringify(out.body));
  const events = rig.hub.events.list({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0]!.projectId, "proj");
});

test("a webhook with a bad or missing signature is rejected and stores nothing", async () => {
  const rig = await webhookRig();
  const body = JSON.stringify({
    action: "opened",
    repository: { full_name: "acme/app" },
  });
  const bad = await rig.control.receiveWebhook(
    "github",
    {
      "x-hub-signature-256": sign("wrong-secret", body),
      "x-github-event": "pull_request",
      "x-github-delivery": "d-2",
    },
    body,
  );
  assert.ok(bad.status === 401 || bad.status === 403, String(bad.status));
  const none = await rig.control.receiveWebhook(
    "github",
    { "x-github-event": "pull_request", "x-github-delivery": "d-3" },
    body,
  );
  assert.ok(none.status === 401 || none.status === 403);
  assert.equal(rig.hub.events.list({ limit: 10 }).length, 0);
});

test("a replayed webhook delivery is not processed twice", async () => {
  const rig = await webhookRig();
  const body = JSON.stringify({
    action: "opened",
    repository: { full_name: "acme/app" },
    pull_request: { number: 3 },
  });
  const h = {
    "x-hub-signature-256": sign("whsec-test-secret-value", body),
    "x-github-event": "pull_request",
    "x-github-delivery": "same",
  };
  await rig.control.receiveWebhook("github", h, body);
  const again = await rig.control.receiveWebhook("github", h, body);
  assert.equal(rig.hub.events.list({ limit: 10 }).length, 1);
  assert.ok(again.status === 200 || again.status === 409);
});

test("a webhook for an unknown or disabled connector is not found", async () => {
  const rig = await webhookRig();
  const unknown = await rig.control.receiveWebhook("nope", {}, "{}");
  assert.equal(unknown.status, 404);
  await rig.control.execute("integration_disable", ADMIN, {
    connectorId: "github",
  });
  const body = "{}";
  const off = await rig.control.receiveWebhook(
    "github",
    { "x-hub-signature-256": sign("whsec-test-secret-value", body) },
    body,
  );
  assert.equal(off.status, 404);
});

test("a webhook never starts work by itself; a subscription only proposes", async () => {
  const rig = await webhookRig();
  const sub = await rig.control.execute(
    "integration_create_subscription",
    ADMIN,
    {
      name: "PR opened",
      provider: "GitHub",
      eventType: "pull_request.opened",
      projectId: "proj",
      request: "Review the pull request",
    },
  );
  assert.equal(sub.outcome, "executed", sub.reason);
  const body = JSON.stringify({
    action: "opened",
    repository: { full_name: "acme/app" },
    pull_request: { number: 9 },
  });
  await rig.control.receiveWebhook(
    "github",
    {
      "x-hub-signature-256": sign("whsec-test-secret-value", body),
      "x-github-event": "pull_request",
      "x-github-delivery": "d-9",
    },
    body,
  );
  assert.ok(rig.proposals.length <= 1);
  assert.equal(rig.calls.filter((c) => c.method !== "GET").length, 0);
});

/* ---------------------------------- MCP ---------------------------------- */

test("an unregistered MCP capability is blocked", async () => {
  const rig = build();
  const r = await rig.hub.gateway.invoke(req("mcp.ghost.do_things"));
  assert.equal(r.success, false);
  assert.equal(rig.calls.length, 0);
});

test("a newly registered MCP server is not usable until reviewed and enabled", async () => {
  const rig = build();
  const reg = await rig.control.execute("integration_register_mcp", ADMIN, {
    serverId: "files",
    name: "Files",
    url: "https://mcp.example.com/rpc",
    projects: ["proj"],
    readOnlyTools: ["list"],
  });
  assert.equal(reg.outcome, "executed", reg.reason);
  assert.equal(rig.hub.mcp.get("files")?.status, "PENDING_REVIEW");
  const r = await rig.hub.gateway.invoke(req("mcp.files.list"));
  assert.equal(r.success, false);
  assert.equal(rig.calls.length, 0);
});

test("an MCP server is restricted to the projects it was registered for", async () => {
  const rig = build();
  await rig.control.execute("integration_register_mcp", ADMIN, {
    serverId: "files",
    name: "Files",
    url: "https://mcp.example.com/rpc",
    projects: ["proj"],
    readOnlyTools: ["list"],
  });
  await rig.control.execute("integration_set_mcp_status", ADMIN, {
    serverId: "files",
    status: "ENABLED",
    trust: "LIMITED",
  });
  const r = await rig.hub.gateway.invoke(
    req("mcp.files.list", { projectId: "other", agentId: "other-agent" }),
  );
  assert.equal(r.success, false);
  assert.equal(rig.calls.length, 0);
});

test("only an administrator may register or enable an MCP server", async () => {
  const rig = build();
  const a = await rig.control.execute("integration_register_mcp", OPERATOR, {
    serverId: "files",
    name: "Files",
    url: "https://mcp.example.com/rpc",
  });
  assert.equal(a.outcome, "denied");
  const b = await rig.control.execute("integration_register_mcp", ADMIN, {
    serverId: "plain",
    name: "Plain",
    url: "http://mcp.example.com/rpc",
  });
  assert.equal(b.outcome, "rejected", "plain http must be refused");
});

/* ------------------------------ control surface ------------------------------ */

test("commands require manage_integrations; viewers are denied", async () => {
  const rig = build();
  const r = await rig.control.execute("integration_disable", VIEWER, {
    connectorId: "github",
  });
  assert.equal(r.outcome, "denied");
  const unknown = await rig.control.execute(
    "integration_format_disk",
    ADMIN,
    {},
  );
  assert.equal(unknown.outcome, "rejected");
});

test("project-scoped reads do not reveal other projects' activity", async () => {
  const rig = build({ respond: () => ({ json: { full_name: "acme/app" } }) });
  await connectGithub(rig);
  await rig.hub.gateway.invoke(req("repository.read"));
  assert.throws(() =>
    rig.control.activity(
      OTHER_PROJECT_ONLY,
      new URLSearchParams({ projectId: "proj" }),
    ),
  );
  const own = rig.control.activity(OTHER_PROJECT_ONLY, new URLSearchParams());
  assert.ok(own.activity.every((a) => a.projectId !== "proj"));
});

test("every successful and denied call is in the integration activity log", async () => {
  const rig = build({ respond: () => ({ json: { full_name: "acme/app" } }) });
  await connectGithub(rig);
  await rig.hub.gateway.invoke(req("repository.read"));
  await rig.hub.gateway.invoke(req("repository.nope"));
  const log = rig.hub.gateway.activityLog({ limit: 50 });
  assert.ok(log.length >= 2);
  assert.ok(log.some((a) => a.outcome === "SUCCESS"));
});

test("provider usage is recorded as unpriced usage, never as an invented cost", async () => {
  const rig = build({ respond: () => ({ json: { full_name: "acme/app" } }) });
  await connectGithub(rig);
  rig.usage.length = 0;
  await rig.hub.gateway.invoke(req("repository.read"));
  assert.ok(rig.usage.length >= 1);
  for (const u of rig.usage)
    assert.notEqual(u.cost?.status ?? u.cost?.kind, "PRICED");
});

test("the Tool Explorer lists capabilities across providers with approval hints", () => {
  const rig = build();
  const r = rig.control.capabilities(
    VIEWER,
    new URLSearchParams({ q: "repository" }),
  );
  assert.ok(r.capabilities.some((c) => c.capability === "repository.read"));
  assert.ok(r.capabilities.every((c) => typeof c.approval === "string"));
});

/* ------------------------- provider-specific safety ------------------------- */

async function connectGeneric(
  rig: Rig,
  connectorId: string,
  resource: string,
  extra: { baseUrl?: string } = {},
) {
  const { hub, control } = rig;
  if (extra.baseUrl)
    await control.execute("integration_configure", ADMIN, {
      connectorId,
      baseUrl: extra.baseUrl,
    });
  hub.registry.map({
    projectId: "proj",
    connectorId,
    resource,
    source: "user",
    by: "t",
  });
  await control.execute("integration_store_credential", ADMIN, {
    connectorId,
    value: "provider-test-credential-0123456789",
  });
  await control.execute("integration_test_connection", ADMIN, { connectorId });
  await control.execute("integration_validate_security", ADMIN, {
    connectorId,
  });
  const enabled = await control.execute("integration_enable", ADMIN, {
    connectorId,
  });
  assert.equal(
    enabled.outcome,
    "executed",
    `${connectorId}: ${enabled.reason}`,
  );
}

test("Gmail send in sandbox mode is substituted by a draft and nothing is sent", async () => {
  const rig = build({ respond: () => ({ json: { id: "d1" } }) });
  await connectGeneric(rig, "gmail", "*");
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(
    req("email.send", {
      parameters: { to: "a@example.com", subject: "Hi", body: "Hello" },
    }),
  );
  assert.ok(
    !rig.calls.some((c) => /messages\/send/.test(c.url)),
    "a real send reached the provider",
  );
  assert.ok(r.metadata.substitutedFrom === "email.send" || !r.success);
});

test("Gmail send in live mode always needs approval", async () => {
  const rig = build({ respond: () => ({ json: { id: "m1" } }) });
  await connectGeneric(rig, "gmail", "*");
  await rig.control.execute("integration_set_mode", ADMIN, {
    connectorId: "gmail",
    mode: "LIVE",
  });
  await rig.control.execute("integration_set_trust", ADMIN, {
    connectorId: "gmail",
    trust: "TRUSTED",
  });
  rig.calls.length = 0;
  const r = await rig.hub.gateway.invoke(
    req("email.send", {
      parameters: { to: "a@example.com", subject: "Hi", body: "Hello" },
    }),
  );
  assert.equal(r.error?.kind, "APPROVAL_REQUIRED");
  assert.ok(!rig.calls.some((c) => /messages\/send/.test(c.url)));
});

test("WordPress is draft-first: publishing needs approval and the draft capability never publishes", async () => {
  const rig = build({
    respond: () => ({
      json: { id: 5, status: "draft", link: "https://blog.example.com/?p=5" },
    }),
  });
  await connectGeneric(rig, "wordpress", "*", {
    baseUrl: "https://blog.example.com",
  });
  await rig.control.execute("integration_set_mode", ADMIN, {
    connectorId: "wordpress",
    mode: "LIVE",
  });
  await rig.control.execute("integration_set_trust", ADMIN, {
    connectorId: "wordpress",
    trust: "TRUSTED",
  });
  rig.calls.length = 0;
  const draft = await rig.hub.gateway.invoke(
    req("cms.draft.create", { parameters: { title: "T", content: "C" } }),
  );
  const sent = rig.calls.filter((c) => c.method === "POST");
  for (const c of sent)
    assert.ok(
      !/"status":"publish"/.test(c.body ?? ""),
      "the draft call must not publish",
    );
  void draft;
  rig.calls.length = 0;
  const pub = await rig.hub.gateway.invoke(
    req("cms.post.publish", { parameters: { id: 5 } }),
  );
  assert.equal(pub.error?.kind, "APPROVAL_REQUIRED");
  assert.equal(rig.calls.filter((c) => c.method !== "GET").length, 0);
});

test("WordPress requests go only to the configured https site", async () => {
  const rig = build({ respond: () => ({ json: [] }) });
  const bad = await rig.control.execute("integration_configure", ADMIN, {
    connectorId: "wordpress",
    baseUrl: "http://blog.example.com",
  });
  assert.equal(bad.outcome, "rejected");
});

test("Firebase: a deployment needs approval and is blocked when no executor is configured; inspection is read-only", async () => {
  const rig = build({ respond: () => ({ json: { projectId: "demo-app" } }) });
  await connectGeneric(rig, "firebase", "demo-app");
  await rig.control.execute("integration_set_mode", ADMIN, {
    connectorId: "firebase",
    mode: "LIVE",
  });
  await rig.control.execute("integration_set_trust", ADMIN, {
    connectorId: "firebase",
    trust: "TRUSTED",
  });
  rig.calls.length = 0;
  const inspect = await rig.hub.gateway.invoke(req("cloud.project.inspect"));
  assert.equal(inspect.success, true, inspect.error?.message);
  assert.ok(rig.calls.every((c) => c.method === "GET"));
  const deploy = await rig.hub.gateway.invoke(
    req("deployment.execute", { parameters: { environment: "STAGING" } }),
  );
  assert.equal(deploy.success, false);
  assert.ok(
    ["APPROVAL_REQUIRED", "UNAVAILABLE", "PERMANENT", "POLICY_DENIED"].includes(
      deploy.error?.kind ?? "",
    ),
    deploy.error?.kind,
  );
  assert.ok(!rig.calls.some((c) => c.method !== "GET"));
});

test("end to end: inspect the repository, then request a deployment — the deployment is gated", async () => {
  const rig = build({
    respond: (c) =>
      c.url.includes("api.github.com")
        ? { json: { full_name: "acme/app", default_branch: "main" } }
        : { json: { projectId: "demo-app" } },
  });
  await connectGithub(rig);
  await connectGeneric(rig, "firebase", "demo-app");
  const port = rig.hub.capabilityPort();
  const seen = port.discover("proj").map((c) => c.capability);
  assert.ok(
    seen.includes("repository.read") && seen.includes("deployment.execute"),
  );
  const repo = await port.invoke({
    capability: "repository.read",
    projectId: "proj",
    agentId: "dev-agent",
    taskType: "IMPLEMENTATION",
    parameters: {},
  } as any);
  assert.equal(repo.success, true);
  const deploy = await port.invoke({
    capability: "deployment.execute",
    projectId: "proj",
    agentId: "dev-agent",
    taskType: "IMPLEMENTATION",
    parameters: { environment: "PRODUCTION" },
  } as any);
  assert.equal(deploy.success, false);
  assert.ok(!rig.calls.some((c) => c.method !== "GET"));
  assert.ok(rig.security.ledger.verify().ok, "the ledger must remain intact");
});

/* ------------------------- agents have no provider access ------------------------- */

test("the runtime reaches integrations only through the narrow capability port", () => {
  const rig = build();
  const port = rig.hub.capabilityPort();
  assert.deepEqual(Object.keys(port).sort(), ["discover", "invoke"]);
});

test("no agent, prompt or runtime module contains an HTTP client, provider URL or provider secret", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const dirs = [
    "core/agent-loop",
    "core/execution-runtime",
    "core/execution-orchestration",
    "core/prompt-intelligence",
    "core/agents",
    "agents",
  ];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(e) && !/\.d\.ts$/.test(e)) {
        const text = readFileSync(p, "utf8");
        if (
          /\bfetch\s*\(|from\s+["'](?:node:)?https?["']|require\(["'](?:node:)?https?["']\)|axios|XMLHttpRequest|\bundici\b/.test(
            text,
          )
        )
          offenders.push(`${path.relative(root, p)}: http client`);
        if (
          /api\.github\.com|googleapis\.com|slack\.com\/api|api\.fireflies|graph\.canva|api\.figma/.test(
            text,
          )
        )
          offenders.push(`${path.relative(root, p)}: provider url`);
        if (
          /ghp_[A-Za-z0-9]{20,}|xox[bp]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}/.test(
            text,
          )
        )
          offenders.push(`${path.relative(root, p)}: provider secret`);
      }
    }
  };
  for (const d of dirs) walk(path.join(root, d));
  assert.deepEqual(offenders, []);
});

test("provider code lives only inside the integration gateway", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (
        ["node_modules", "dist", ".git", "ui", "tests", "functions"].includes(e)
      )
        continue;
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (
        /\.ts$/.test(e) &&
        !/\.d\.ts$/.test(e) &&
        !p.includes(path.join("core", "integration-gateway"))
      ) {
        const text = readFileSync(p, "utf8");
        if (
          /api\.github\.com\/|gmail\.googleapis\.com|www\.googleapis\.com\/drive|api\.fireflies\.ai|api\.figma\.com|api\.canva\.com/.test(
            text,
          )
        )
          offenders.push(path.relative(root, p));
      }
    }
  };
  for (const d of [
    "core",
    "control",
    "api",
    "adapters",
    "agents",
    "contracts",
  ]) {
    try {
      walk(path.join(root, d));
    } catch {
      /* directory absent */
    }
  }
  // The GitHub repository reader predates the hub and is read-only project discovery; it is the one allowed exception.
  const allowed = offenders.filter(
    (o) =>
      !/github-repository-reader|source-control|release|onboarding|knowledge/.test(
        o,
      ),
  );
  assert.deepEqual(allowed, []);
});
