/**
 * PROJECT-2 — onboarding & provisioning: discovery, plan, lifecycle,
 * provisioning safety, authorization, secrets and the HTTP surface.
 */
import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  AuditLog,
  GitHubRepositoryReader,
  InMemoryOnboardingSessionStore,
  InMemoryProvisionedProjectStore,
  OnboardingService,
  ProjectProvisioningService,
  ProjectRegistry,
  analyzeRepositoryEvidence,
  analyzeSpecification,
  canTransitionOnboarding,
  parseEnvVarNames,
  type OperatorPrincipal,
  type RepositoryEvidence,
  type RepositoryReadResult,
  type RepositorySourceReader,
} from "../core/index.js";
import { ProvisionedProjectAdapter } from "../adapters/projects/provisioned/provisioned-project-adapter.js";
import { OnboardingControlService } from "../control/services/onboarding-control-service.js";
import { createControlPlaneApi } from "../api/index.js";
import type {
  WorkforceCommandService,
  WorkforceQueryService,
} from "../control/index.js";
import type { OnboardingSession } from "../contracts/onboarding.js";

const ADMIN: OperatorPrincipal = { id: "admin-1", role: "admin", allowedProjects: "*" };
const OPERATOR: OperatorPrincipal = { id: "op-1", role: "operator", allowedProjects: "*" };
const VIEWER: OperatorPrincipal = { id: "v-1", role: "viewer", allowedProjects: "*" };
const SCOPED: OperatorPrincipal = { id: "adm-2", role: "admin", allowedProjects: ["x"] };

const EVIDENCE: RepositoryEvidence = {
  provider: "github",
  url: "https://github.com/acme/webapp",
  visibility: "private",
  defaultBranch: "main",
  branch: "main",
  commit: "a".repeat(40),
  truncated: false,
  paths: [
    "package.json", "package-lock.json", "tsconfig.json", "firebase.json", "vite.config.ts",
    "src/App.tsx", "src/main.tsx", "src/util.ts", "src/a.test.ts", ".env.example", "README.md",
    "docs/adr/0001.md", ".github/workflows/ci.yml", "index.html",
  ],
  files: {
    "package.json": JSON.stringify({
      scripts: { build: "vite build", test: "vitest", lint: "eslint ." },
      dependencies: { react: "1", firebase: "1" },
      devDependencies: { vite: "1", vitest: "1", typescript: "5" },
    }),
    "firebase.json": '{"hosting":{},"firestore":{}}',
    ".env.example": "VITE_API_KEY=abc123realvalue\nDATABASE_URL=postgres://u:p@h/db\n# c\nSESSION_SECRET=zzz\n",
  },
};

function readerReturning(result: RepositoryReadResult): RepositorySourceReader {
  return { providers: ["github"], privateAccess: true, read: async () => result };
}

function setup(reader: RepositorySourceReader = readerReturning({ ok: true, evidence: EVIDENCE })) {
  const audit = new AuditLog();
  const registry = new ProjectRegistry();
  const sessions = new InMemoryOnboardingSessionStore();
  const projects = new InMemoryProvisionedProjectStore();
  const provisioning = new ProjectProvisioningService({
    sessions,
    projects,
    registry,
    audit,
    adapterFactory: (p) => new ProvisionedProjectAdapter(p),
  });
  const service = new OnboardingService({
    sessions,
    projects,
    registry,
    audit,
    reader,
    provisioning,
    platform: () => ({ descriptors: [], usableDescriptorIds: new Set(), agents: [] }),
  });
  return {
    audit,
    registry,
    sessions,
    projects,
    provisioning,
    service,
    control: new OnboardingControlService(service, audit),
  };
}
type Ctx = ReturnType<typeof setup>;

async function toReview(s: Ctx, code = "ACME", url = "https://github.com/acme/webapp") {
  let { session } = await s.service.create(ADMIN, { mode: "guided", kind: "import_existing" });
  session = (
    await s.service.update(ADMIN, {
      id: session.id,
      expectedRevision: session.revision,
      patch: { identity: { name: "Acme Web", code, description: "d" }, source: { repositoryUrl: url } },
    })
  ).session;
  session = (await s.service.analyze(ADMIN, { id: session.id, expectedRevision: session.revision })).session;
  session = (await s.service.plan(ADMIN, { id: session.id, expectedRevision: session.revision })).session;
  return session;
}
async function approve(s: Ctx, session: OnboardingSession) {
  return (
    await s.service.approvePlan(ADMIN, {
      id: session.id,
      expectedRevision: session.revision,
      planVersion: session.plan!.planVersion,
      planHash: session.plan!.planHash,
    })
  ).session;
}

/* ---------------- discovery ---------------- */

test("discovery reports only evidenced facts and env var NAMES", () => {
  const a = analyzeRepositoryEvidence(EVIDENCE, "t");
  assert.ok(a.languages.some((f) => f.value === "TypeScript"));
  assert.ok(a.frameworks.some((f) => f.value === "React" && f.evidence.includes("package.json")));
  assert.ok(a.deployment.some((f) => f.value === "Firebase Hosting"));
  assert.ok(a.commands.some((c) => c.purpose === "build" && c.command === "npm run build"));
  assert.ok(!a.commands.some((c) => c.purpose === "typecheck"), "no invented typecheck command");
  assert.deepEqual(a.envVars.map((v) => v.name).sort(), ["DATABASE_URL", "SESSION_SECRET", "VITE_API_KEY"]);
  assert.equal(a.envVars.find((v) => v.name === "VITE_API_KEY")!.classification, "public_client");
  assert.equal(a.envVars.find((v) => v.name === "DATABASE_URL")!.classification, "server_secret");
  const json = JSON.stringify(a);
  assert.ok(!json.includes("abc123realvalue") && !json.includes("postgres://"));
});

test("discovery does not guess from an empty repository", () => {
  const a = analyzeRepositoryEvidence({ ...EVIDENCE, paths: ["notes.txt"], files: {} }, "t");
  assert.equal(a.languages.length, 0);
  assert.equal(a.commands.length, 0);
  assert.ok(a.unavailable.length > 0);
  assert.ok(a.findings.some((f) => f.code === "build-command-unresolved"));
});

test("discovery flags committed env files and open rules", () => {
  const a = analyzeRepositoryEvidence(
    {
      ...EVIDENCE,
      paths: [...EVIDENCE.paths, ".env", "firestore.rules"],
      files: { ...EVIDENCE.files, "firestore.rules": "allow read, write: if true;" },
    },
    "t",
  );
  assert.ok(a.security.some((f) => f.code === "committed-env-file"));
  assert.ok(a.security.some((f) => f.code === "open-firestore-rules"));
  assert.deepEqual(parseEnvVarNames("A=1\n#B=2\nexport C=3"), ["A", "C"]);
});

test("specification analysis is a proposal with evidence", () => {
  const a = analyzeSpecification("A web app dashboard built with React and Firebase for tracking budgets.", "t");
  assert.equal(a.basis, "specification");
  assert.ok(a.frameworks.some((f) => f.value === "React" && f.evidence.includes("specification")));
});

/* ---------------- lifecycle ---------------- */

test("state machine rejects invalid transitions", () => {
  assert.equal(canTransitionOnboarding("draft", "ready"), false);
  assert.equal(canTransitionOnboarding("approved", "provisioning"), true);
  assert.equal(canTransitionOnboarding("ready", "cancelled"), false);
  assert.equal(canTransitionOnboarding("provisioning", "cancelled"), false);
});

test("full import flow: create, analyze, plan, approve, provision, READY", async () => {
  const s = setup();
  const session = await approve(s, await toReview(s));
  assert.equal(session.status, "approved");
  assert.equal(s.registry.has(session.projectId), false, "not a project until provisioned");
  const done = (await s.service.provision(ADMIN, { id: session.id, planHash: session.plan!.planHash })).session;
  assert.equal(done.status, "ready");
  assert.ok(done.provisioning!.steps.every((st) => st.status === "complete"));
  assert.ok(s.registry.has(done.projectId), "registered in the existing Project Registry");
  const stored = await s.projects.get(done.projectId);
  assert.equal(stored!.readiness, "ready");
  assert.equal(stored!.baseline.testStatus.startsWith("Unavailable"), true);
});

test("provision is idempotent and replay-safe", async () => {
  const s = setup();
  const session = await approve(s, await toReview(s));
  const input = { id: session.id, planHash: session.plan!.planHash };
  const results = await Promise.allSettled([s.service.provision(ADMIN, input), s.service.provision(ADMIN, input)]);
  assert.ok(results.some((r) => r.status === "fulfilled"));
  const again = await s.service.provision(ADMIN, input);
  assert.equal(again.idempotent, true);
  assert.equal(s.registry.list().length, 1);
  assert.equal((await s.projects.list()).length, 1);
});

test("changed plan cannot reuse approval; wrong hash refused", async () => {
  const s = setup();
  const session = await approve(s, await toReview(s));
  await assert.rejects(s.service.provision(ADMIN, { id: session.id, planHash: "0".repeat(64) }));
  const edited = (
    await s.service.update(ADMIN, {
      id: session.id,
      expectedRevision: session.revision,
      patch: { autonomyLevel: 2 },
    })
  ).session;
  assert.equal(edited.approval, undefined);
  assert.equal(edited.status, "analyzed");
  await assert.rejects(s.service.provision(ADMIN, { id: session.id, planHash: session.plan!.planHash }));
});

test("stale revision is a conflict", async () => {
  const s = setup();
  const { session } = await s.service.create(ADMIN, { mode: "auto", kind: "import_existing" });
  await s.service.update(ADMIN, { id: session.id, expectedRevision: 1, patch: { identity: { name: "A" } } });
  const r = await s.control.onboardingUpdate(ADMIN, {
    id: session.id,
    expectedRevision: 1,
    patch: { identity: { name: "B" } },
  });
  assert.equal(r.errorKind, "invalid_state");
  assert.equal(r.details["code"], "revision_conflict");
  assert.equal(r.details["currentRevision"], 2);
});

test("duplicate code and repository binding are refused", async () => {
  const s = setup();
  const first = await approve(s, await toReview(s));
  await s.service.provision(ADMIN, { id: first.id, planHash: first.plan!.planHash });
  await assert.rejects(toReview(s, "ACME", "https://github.com/acme/other"), /code ACME/);
  await assert.rejects(toReview(s, "OTHER"), /already bound/);
});

test("partial failure is recorded, then resumes without repeating steps", async () => {
  const s = setup();
  const session = await approve(s, await toReview(s));
  // Corrupt the approved plan so the git_workflow step fails once.
  const broken = structuredClone(session);
  broken.plan!.git.allowDirectDefaultBranchWrites = true;
  broken.revision = session.revision + 1;
  assert.ok(await s.sessions.replace(broken, session.revision));
  await s.provisioning.run(broken, ADMIN.id);
  const after = (await s.sessions.get(session.id))!;
  assert.equal(after.status, "provisioning_failed");
  const steps = after.provisioning!.steps;
  assert.equal(steps.find((x) => x.key === "registry_entry")!.status, "complete");
  assert.equal(steps.find((x) => x.key === "git_workflow")!.status, "failed");
  assert.equal(steps.find((x) => x.key === "deployment_configuration")!.status, "pending");
  assert.equal(s.registry.has(session.projectId), false, "not READY, not registered");
  const fixed = structuredClone(after);
  fixed.plan!.git.allowDirectDefaultBranchWrites = false;
  fixed.revision = after.revision + 1;
  assert.ok(await s.sessions.replace(fixed, after.revision));
  const resumed = await s.provisioning.run(fixed, ADMIN.id);
  assert.equal(resumed.status, "ready");
  assert.equal((await s.projects.list()).length, 1);
});

test("READY gate: missing analysed commit blocks readiness", async () => {
  const noCommit: RepositoryEvidence = { ...EVIDENCE };
  delete (noCommit as { commit?: string }).commit;
  const s = setup(readerReturning({ ok: true, evidence: noCommit }));
  const session = await approve(s, await toReview(s));
  const r = (await s.service.provision(ADMIN, { id: session.id, planHash: session.plan!.planHash })).session;
  assert.equal(r.status, "validation_failed");
  assert.ok(r.validation!.blocking.length > 0);
  assert.equal(s.registry.has(r.projectId), false);
  assert.equal((await s.projects.get(r.projectId))!.readiness, "blocked");
});

test("cancel is honest; ready projects cannot be cancelled", async () => {
  const s = setup();
  const session = await toReview(s);
  const c = await s.service.cancel(ADMIN, { id: session.id, expectedRevision: session.revision });
  assert.equal(c.session.status, "cancelled");
  assert.match(c.note!, /Nothing had been provisioned/);
  const s2 = setup();
  const ready = await approve(s2, await toReview(s2));
  const done = (await s2.service.provision(ADMIN, { id: ready.id, planHash: ready.plan!.planHash })).session;
  await assert.rejects(s2.service.cancel(ADMIN, { id: done.id, expectedRevision: done.revision }));
});

test("analysis failure is surfaced and retryable", async () => {
  const s = setup(
    readerReturning({ ok: false, code: "not_found_or_private", message: "repository not found or private" }),
  );
  let { session } = await s.service.create(ADMIN, {
    mode: "auto",
    kind: "import_existing",
    identity: { name: "X", code: "XX" },
    source: { repositoryUrl: "https://github.com/acme/priv" },
  });
  session = (await s.service.analyze(ADMIN, { id: session.id, expectedRevision: session.revision })).session;
  assert.equal(session.status, "analysis_failed");
  assert.equal(session.failure!.code, "not_found_or_private");
  const retry = await s.service.analyze(ADMIN, { id: session.id, expectedRevision: session.revision });
  assert.equal(retry.session.status, "analysis_failed");
});

test("create-new flow proposes; repository creation stays a pending requirement", async () => {
  const s = setup();
  let { session } = await s.service.create(ADMIN, { mode: "guided", kind: "create_new" });
  session = (
    await s.service.update(ADMIN, {
      id: session.id,
      expectedRevision: session.revision,
      patch: {
        identity: { name: "Fresh", code: "FRESH" },
        source: { specification: "A web application dashboard using React and Firebase.", createRepository: true },
      },
    })
  ).session;
  session = (await s.service.analyze(ADMIN, { id: session.id, expectedRevision: session.revision })).session;
  session = (await s.service.plan(ADMIN, { id: session.id, expectedRevision: session.revision })).session;
  assert.equal(session.plan!.technology.origin, "proposed");
  assert.equal(session.plan!.steps.find((st) => st.key === "repository_creation")!.executable, false);
  session = await approve(s, session);
  const done = (await s.service.provision(ADMIN, { id: session.id, planHash: session.plan!.planHash })).session;
  assert.equal(done.status, "ready");
  assert.equal(
    done.provisioning!.steps.find((st) => st.key === "repository_creation")!.status,
    "requirement_pending",
  );
});

test("local import is unavailable", async () => {
  const s = setup();
  await assert.rejects(s.service.create(ADMIN, { mode: "guided", kind: "import_local" }), /unavailable/);
  assert.equal(s.service.capabilities(ADMIN).kinds.find((k) => k.kind === "import_local")!.available, false);
});

/* ---------------- security ---------------- */

test("repository URL hardening", async () => {
  const s = setup();
  const { session } = await s.service.create(ADMIN, { mode: "guided", kind: "import_existing" });
  for (const bad of [
    "https://user:tok@github.com/a/b",
    "http://github.com/a/b",
    "https://github.com/a/b?token=x",
    "https://github.com/a/b#x",
    "https://localhost/a/b",
    "https://127.0.0.1/a/b",
    "https://gitlab.com/a/b",
    "https://github.com/a",
    "file:///etc/passwd",
    "https://github.com/a/b/tree/main",
  ]) {
    await assert.rejects(
      s.service.update(ADMIN, { id: session.id, expectedRevision: 1, patch: { source: { repositoryUrl: bad } } }),
      /./,
      bad,
    );
  }
});

test("only administrators with global scope may onboard", async () => {
  const s = setup();
  for (const p of [OPERATOR, VIEWER, SCOPED]) {
    const r = await s.control.onboardingCreate(p, { mode: "guided", kind: "create_new" });
    assert.equal(r.outcome, "denied");
    assert.equal(r.errorKind, "forbidden");
    await assert.rejects(s.service.list(p));
    assert.equal(s.service.capabilities(p).canCreate, false);
  }
  assert.equal(s.service.capabilities(ADMIN).canCreate, true);
});

test("secret-looking input is rejected; overrides cannot weaken policy", async () => {
  const s = setup();
  const { session } = await s.service.create(ADMIN, { mode: "guided", kind: "create_new" });
  await assert.rejects(
    s.service.update(ADMIN, {
      id: session.id,
      expectedRevision: 1,
      patch: { source: { specification: "use ghp_abcdefghijklmnopqrstuvwxyz0123456789 to log in" } },
    }),
  );
  for (const gitPolicy of [
    { allowDirectDefaultBranchWrites: true },
    { reviewRequired: false },
    { securityCheckRequired: false },
    { autoPush: true },
  ]) {
    await assert.rejects(s.service.update(ADMIN, { id: session.id, expectedRevision: 1, patch: { gitPolicy } }));
  }
});

test("plan and audit never contain secret values", async () => {
  const s = setup();
  const session = await toReview(s);
  const done = await approve(s, session);
  await s.service.provision(ADMIN, { id: done.id, planHash: done.plan!.planHash });
  const text = JSON.stringify([session, s.audit.list()]);
  assert.ok(!text.includes("abc123realvalue") && !text.includes("postgres://u:p"));
  assert.ok(s.audit.list().some((e) => e.type === "onboarding_event"));
  assert.ok(session.plan!.secrets.every((x) => x.status === "reference_required"));
});

test("autonomy level is not a bypass; cost is not claimed enforced", async () => {
  const s = setup();
  const { session } = await s.service.create(ADMIN, { mode: "guided", kind: "import_existing" });
  const upd = (
    await s.service.update(ADMIN, {
      id: session.id,
      expectedRevision: 1,
      patch: {
        identity: { name: "A", code: "AA" },
        source: { repositoryUrl: "https://github.com/acme/webapp" },
        autonomyLevel: 5,
        costPolicy: { dailyLimit: 5 },
      },
    })
  ).session;
  const an = (await s.service.analyze(ADMIN, { id: upd.id, expectedRevision: upd.revision })).session;
  const plan = (await s.service.plan(ADMIN, { id: an.id, expectedRevision: an.revision })).session.plan!;
  assert.deepEqual(plan.autonomy.granted, ["repository.read"]);
  assert.ok(plan.autonomy.requested.includes("deployment.production"));
  assert.ok(plan.autonomy.approvalRequired.includes("production deployment"));
  assert.equal(plan.cost.enforcement, "not_enforced");
  assert.equal(plan.git.allowDirectDefaultBranchWrites, false);
  assert.equal(plan.git.mergePolicy, "manual");
});

/* ---------------- GitHub reader ---------------- */

test("GitHub reader is read-only, host-pinned and never leaks its token", async () => {
  const calls: Array<{ url: string }> = [];
  const sha = "b".repeat(40);
  const ok = (body: unknown) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => "{}",
  });
  const reader = new GitHubRepositoryReader({
    credentials: { token: () => "SECRETTOKEN" },
    fetch: async (url) => {
      calls.push({ url });
      if (url.endsWith("/repos/acme/webapp")) return ok({ private: true, default_branch: "main" });
      if (url.includes("/branches/")) return ok({ commit: { sha, commit: { tree: { sha } } } });
      if (url.includes("/git/trees/")) {
        return ok({
          tree: [
            { path: "package.json", type: "blob", size: 5 },
            { path: "../evil", type: "blob" },
          ],
          truncated: false,
        });
      }
      return ok({});
    },
  });
  const r = await reader.read({ provider: "github", url: "https://github.com/acme/webapp" });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.evidence.visibility, "private");
    assert.deepEqual(r.evidence.paths, ["package.json"], "traversal path dropped");
  }
  assert.ok(calls.every((c) => c.url.startsWith("https://api.github.com/repos/acme/webapp")));
  assert.ok(calls.every((c) => !c.url.includes("SECRETTOKEN")));
  assert.equal((await reader.read({ provider: "github", url: "https://evil.example/acme/webapp" })).ok, false);
  const notFound = await new GitHubRepositoryReader({
    credentials: { token: () => undefined },
    fetch: async () => ({
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => "",
    }),
  }).read({ provider: "github", url: "https://github.com/acme/private" });
  assert.ok(!notFound.ok && notFound.code === "not_found_or_private" && /not configured/.test(notFound.message));
});

/* ---------------- HTTP ---------------- */

test("HTTP: onboarding routes are authenticated and admin-only", async () => {
  const s = setup();
  const handler = createControlPlaneApi({
    query: {} as WorkforceQueryService,
    command: {} as WorkforceCommandService,
    onboarding: s.control,
    operatorDirectory: {
      resolve: async (t) => (t === "admin" ? ADMIN : t === "viewer" ? VIEWER : null),
    },
  });
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (path: string, token?: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  try {
    assert.equal((await call("/onboarding")).status, 401);
    assert.equal((await call("/onboarding", "viewer")).status, 403);
    assert.equal(
      (await call("/commands/onboarding_create", "viewer", { mode: "guided", kind: "create_new" })).status,
      403,
    );
    const created = await call("/commands/onboarding_create", "admin", { mode: "guided", kind: "create_new" });
    assert.equal(created.status, 200);
    const id = (created.json["details"] as { session: { id: string } }).session.id;
    assert.equal((await call(`/onboarding/${id}`, "admin")).status, 200);
    assert.equal((await call("/onboarding/capabilities", "admin")).status, 200);
    assert.equal((await call("/onboarding/nope", "admin")).status, 404);
    const stale = await call("/commands/onboarding_update", "admin", { id, expectedRevision: 99, patch: {} });
    assert.equal(stale.status, 409);
    assert.equal((await call("/commands/onboarding_bogus", "admin", {})).status, 404);
  } finally {
    server.close();
  }
});
