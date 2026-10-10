/**
 * EO-4.8 — security, failure-recovery & production release gate.
 *
 * Attack and failure-injection tests for the gaps not already covered by the
 * EO-4.1…4.7 suites (see docs/security/eo4-threat-model.md for the full
 * threat → control → test map). Deterministic; no real credentials, no
 * network, no paid calls. Real processes are only the local Node binary.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createControlPlaneApi } from "../api/index.js";
import { runBoundedProcess } from "../adapters/execution/bounded-process-runner.js";
import {
  ExecutionDeniedError,
  NotFoundError,
  ValidationError,
  canTransitionSession,
  classifyWorkspacePath,
  DEFAULT_WORKSPACE_FILE_POLICY,
  resolveWorkspacePath,
  validateNetworkDestination,
  type CommitReceipt,
  type DeploymentAdapter,
  type DeploymentContext,
  type ExecutionRecordStore,
  type PushReceipt,
  type ReleasePolicy,
  type TargetClassRequirements,
  type VerificationResult,
} from "../contracts/index.js";
import {
  AgentOperationalStore,
  WorkflowControlStore,
  WorkforceCommandService,
  WorkforceQueryService,
  type ControlPlaneContext,
} from "../control/index.js";
import {
  ApprovalSystem,
  ArtifactManager,
  AuditLog,
  DeploymentOrchestrator,
  ExecutionManager,
  InMemoryExecutionSessionStore,
  PermissionSystem,
  ProjectRegistry,
  TaskSystem,
  WorkflowSystem,
  beginAttempt,
  checkBoundApproval,
  defineBuildTool,
  requestBoundApproval,
  transitionSession,
} from "../core/index.js";
import { ADMIN, FAKE_SECRET, OPERATOR, harness } from "./fixtures/execution.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const denied = (code: string) => (e: unknown) =>
  e instanceof ExecutionDeniedError && e.code === code;

/* ================= command / shell injection (real process) ================= */

test("EO-4.8 7-10 INJECTION: shell metacharacters stay literal argv; no second command runs", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aiw-eo48-inj-"));
  try {
    const marker = path.join(dir, "pwned.txt");
    const script = path.join(dir, "echo-argv.js");
    writeFileSync(
      script,
      "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n",
    );
    const hostile = [
      `; node -e "require('fs').writeFileSync('${marker.replace(/\\/g, "/")}','x')"`,
      "&& whoami",
      "|| del C:\\x",
      "$(whoami)",
      "`id`",
      "| cat /etc/passwd",
      "> out.txt",
      "a\nnode -e 1",
      "\"quoted\" 'break'",
      "& powershell -c calc",
      "/c calc.exe",
    ];
    const run = await runBoundedProcess({
      executable: { executableId: "node", path: process.execPath },
      argv: [script, ...hostile],
      cwd: dir,
      env: {},
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
      signal: new AbortController().signal,
      knownSecrets: [],
    });
    assert.equal(run.exitCode, 0);
    assert.deepEqual(
      JSON.parse(run.stdout.text),
      hostile,
      "every argument arrived verbatim as data",
    );
    assert.equal(existsSync(marker), false, "no injected command executed");
    assert.equal(
      existsSync(path.join(dir, "out.txt")),
      false,
      "no redirection happened",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("EO-4.8 27 ENV: child processes receive only the constructed environment (no host secrets)", async () => {
  process.env.AIW_EO48_HOST_SECRET = FAKE_SECRET;
  const dir = mkdtempSync(path.join(os.tmpdir(), "aiw-eo48-env-"));
  try {
    const script = path.join(dir, "env.js");
    writeFileSync(
      script,
      "process.stdout.write(JSON.stringify(process.env));\n",
    );
    const run = await runBoundedProcess({
      executable: { executableId: "node", path: process.execPath },
      argv: [script],
      cwd: dir,
      env: { ALLOWED_FLAG: "1" },
      timeoutMs: 10_000,
      maxOutputBytes: 256 * 1024,
      signal: new AbortController().signal,
      knownSecrets: [],
    });
    const env = JSON.parse(run.stdout.text) as Record<string, string>;
    assert.equal(env.ALLOWED_FLAG, "1");
    assert.equal(
      env.AIW_EO48_HOST_SECRET,
      undefined,
      "host secret not inherited",
    );
    assert.ok(!run.stdout.text.includes(FAKE_SECRET));
    for (const key of [
      "OPENAI_API_KEY",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "GITHUB_TOKEN",
      "FIREBASE_TOKEN",
    ]) {
      assert.equal(env[key], undefined, key);
    }
  } finally {
    delete process.env.AIW_EO48_HOST_SECRET;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("EO-4.8 46/47 PROCESS TREE: cancellation kills grandchildren (no unmanaged survivors)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aiw-eo48-tree-"));
  try {
    const marker = path.join(dir, "grandchild-survived.txt");
    const grandchild = path.join(dir, "grandchild.js");
    const ready = path.join(dir, "grandchild-running.txt");
    // The grandchild announces itself; cancellation happens only once the
    // whole tree provably exists (Windows cannot snapshot a tree that is
    // still spawning; documented as a residual risk in the threat model).
    writeFileSync(
      grandchild,
      `require("fs").writeFileSync(${JSON.stringify(ready)}, "up");\nsetTimeout(() => require("fs").writeFileSync(${JSON.stringify(marker)}, "alive"), 2500);\nsetInterval(() => {}, 1000);\n`,
    );
    const parent = path.join(dir, "parent.js");
    writeFileSync(
      parent,
      `require("child_process").spawn(process.execPath, [${JSON.stringify(grandchild)}], { stdio: "ignore" });\nsetInterval(() => {}, 1000);\n`,
    );
    const controller = new AbortController();
    const pending = runBoundedProcess({
      executable: { executableId: "node", path: process.execPath },
      argv: [parent],
      cwd: dir,
      env:
        process.platform === "win32"
          ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" }
          : {},
      timeoutMs: 30_000,
      maxOutputBytes: 1024,
      signal: controller.signal,
      knownSecrets: [],
    });
    const deadline = Date.now() + 15_000;
    while (!existsSync(ready) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 50));
    assert.ok(existsSync(ready), "the grandchild started");
    controller.abort();
    const run = await pending;
    assert.equal(run.cancelled, true);
    await new Promise((r) => setTimeout(r, 3_500));
    assert.equal(
      existsSync(marker),
      false,
      "the grandchild was terminated with the tree",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ================= workspace paths, filenames, SSRF, package scripts ================= */

test("EO-4.8 18/21 PATHS: traversal variants denied; hostile-looking filenames are data", () => {
  for (const p of [
    "../secret",
    "..\\secret",
    "a/../../b",
    "a\\..\\..\\b",
    "/etc/passwd",
    "C:\\Windows\\win.ini",
    "c:/x",
    "\\\\server\\share\\x",
    "//server/share",
    "a/./../../b",
    "a/b/../../../c",
    "%2e%2e/secret",
    "..%2fsecret",
    "\u0000.txt",
    "a\u0000b",
    "",
  ]) {
    assert.throws(() => resolveWorkspacePath(p), JSON.stringify(p));
  }
  for (const [input, expected] of [
    ["$(whoami).txt", "$(whoami).txt"],
    ["`id`;rm.txt", "`id`;rm.txt"],
    ["ünïcödé 文件.md", "ünïcödé 文件.md"],
    [".env.example", ".env.example"],
    ["dir/.hidden", "dir/.hidden"],
  ] as const) {
    assert.equal(resolveWorkspacePath(input), expected);
  }
  assert.throws(
    () => resolveWorkspacePath("x".repeat(5000)),
    "very long names are bounded",
  );
  // Repository internals are syntactically valid paths but classified
  // `internal` by the workspace policy, which every file operation enforces.
  assert.equal(
    classifyWorkspacePath(
      resolveWorkspacePath(".git/config"),
      DEFAULT_WORKSPACE_FILE_POLICY,
    ),
    "internal",
  );
});

test("EO-4.8 34/35 SSRF: internal, metadata, IP-encoded and wildcard-IP DNS destinations are refused", () => {
  const bad = [
    "localhost",
    "127.0.0.1",
    "10.0.0.5",
    "192.168.1.1",
    "169.254.169.254",
    "metadata.google.internal",
    "metadata",
    "0x7f.1",
    "127.1",
    "2130706433",
    "printer.local",
    "db.internal",
    "127.0.0.1.nip.io",
    "10.0.0.1.sslip.io",
    "app.localtest.me",
    "[::1]",
    "::1",
    "host.docker.internal",
    "a.b.123",
  ];
  for (const host of bad) {
    assert.throws(
      () => validateNetworkDestination({ host, scheme: "https" }),
      ValidationError,
      host,
    );
  }
  assert.throws(
    () =>
      validateNetworkDestination({ host: "api.example.com", scheme: "http" }),
    ValidationError,
  );
  assert.deepEqual(
    validateNetworkDestination({ host: "registry.npmjs.org", scheme: "https" }),
    {
      host: "registry.npmjs.org",
      port: 443,
      scheme: "https",
    },
  );
});

test("EO-4.8 11 PACKAGE SCRIPTS: package managers (npm/pnpm/yarn/bun) can never become build tools", () => {
  for (const executableId of ["npm", "pnpm", "yarn", "bun", "npx", "bunx"]) {
    assert.throws(
      () =>
        defineBuildTool({
          toolId: `t-${executableId}`,
          executableId,
          requiredToolchains: [],
          commands: [
            {
              operationId: `${executableId}.build`,
              stageKind: "build",
              description: "x",
              argv: ["run", "build"],
            },
          ],
        }),
      ValidationError,
      executableId,
    );
  }
});

/* ================= approvals: staleness & replay ================= */

test("EO-4.8 53/54 APPROVAL: bound approvals cannot be replayed on another subject, source, commit or target", () => {
  const approvals = new ApprovalSystem();
  const binding = {
    action: "release.deploy" as const,
    projectId: "alpha",
    subjectId: "dcn_1",
    commitSha: "a".repeat(40),
    targetId: "alpha-prod",
  };
  const approval = requestBoundApproval(
    approvals,
    binding,
    "admin-1",
    "release",
  );
  const now = new Date().toISOString();
  assert.equal(
    checkBoundApproval(approvals, approval.id, binding, now)?.code,
    "APPROVAL_REQUIRED",
    "pending ≠ approved",
  );
  approvals.decide(approval.id, "approved", "admin-2");
  assert.equal(
    checkBoundApproval(approvals, approval.id, binding, now),
    undefined,
  );
  for (const other of [
    { ...binding, subjectId: "dcn_2" },
    { ...binding, commitSha: "b".repeat(40) },
    { ...binding, targetId: "alpha-preview" },
    { ...binding, projectId: "beta" },
    { ...binding, action: "release.rollback" as const },
  ]) {
    assert.equal(
      checkBoundApproval(approvals, approval.id, other, now)?.code,
      "APPROVAL_REQUIRED",
      JSON.stringify(other),
    );
  }
});

/* ================= deployment failure injection ================= */

class InjectableAdapter implements DeploymentAdapter {
  readonly adapterId = "test-injectable";
  readonly version = "0.0.0-test";
  readonly simulated = true;
  failedResources: string[] = [];
  rollbackFails = false;
  reachable = true;
  calls = 0;
  live?: string;
  async deploy(ctx: DeploymentContext) {
    this.calls += 1;
    this.live = ctx.candidate.commitSha;
    return {
      providerReleaseId: `prov-${this.calls}`,
      ...(this.failedResources.length
        ? { failedResources: this.failedResources }
        : {}),
    };
  }
  async verify() {
    return {
      reachable: this.reachable,
      ...(this.live ? { reportedVersion: this.live } : {}),
      detail: "injected",
    };
  }
  async rollback() {
    if (this.rollbackFails) throw new Error("provider rollback failed");
  }
}

const GATES = (
  over: Partial<TargetClassRequirements> = {},
): TargetClassRequirements => ({
  requireReview: false,
  requireApproval: false,
  requirePostDeployVerification: true,
  requireRollbackPlan: false,
  automaticRollback: false,
  requireRollbackApproval: false,
  ...over,
});

async function deployHarness(store?: ExecutionRecordStore) {
  const files = new Map([["dist/app.js", "bundle-v1"]]);
  const artifacts = new ArtifactManager({
    source: {
      digestFile: async (_p, file) => {
        const content = files.get(file);
        if (content === undefined) throw new Error("missing");
        return { sha256: sha(content), size: Buffer.byteLength(content) };
      },
    },
    maxArtifactBytes: 10_000,
  });
  const artifact = await artifacts.record({
    projectId: "alpha",
    verificationId: "vrf_1",
    stageId: "build:web",
    sourceFingerprint: "fp-1",
    kind: "bundle",
    path: "dist/app.js",
  });
  const commit = {
    receiptId: "cmr_1",
    projectId: "alpha",
    verificationId: "vrf_1",
    sourceFingerprint: "fp-1",
    changeSetId: "chg_1",
    reviewId: "rev_1",
    commitSha: "a".repeat(40),
  } as CommitReceipt;
  const push = {
    receiptId: "psr_1",
    projectId: "alpha",
    commitSha: commit.commitSha,
    commitReceiptId: "cmr_1",
  } as PushReceipt;
  const adapter = new InjectableAdapter();
  const audit = new AuditLog();
  const deploy = new DeploymentOrchestrator({
    sourceControl: {
      getPushReceipt: async (_p, projectId, id) => {
        if (projectId !== "alpha" || id !== "psr_1")
          throw new NotFoundError("resource not found");
        return push;
      },
      getCommitReceipt: async () => commit,
    },
    verification: {
      load: async () =>
        ({
          verificationId: "vrf_1",
          projectId: "alpha",
          status: "passed",
          sourceFingerprint: "fp-1",
          plan: { planId: "plan-1", version: 1 },
        }) as unknown as VerificationResult,
    },
    artifacts,
    approvals: new ApprovalSystem(),
    projects: { has: (id) => id === "alpha" || id === "beta" },
    audit,
    ...(store ? { store } : {}),
  });
  deploy.registerAdapter(adapter);
  deploy.registerTarget({
    targetId: "alpha-preview",
    projectId: "alpha",
    targetClass: "preview",
    adapterId: adapter.adapterId,
    resources: ["hosting", "functions"],
    providerRef: "alpha-site",
    timeoutMs: 2_000,
  });
  const policy: ReleasePolicy = {
    projectId: "alpha",
    version: 1,
    targets: {
      development: GATES(),
      preview: GATES(),
      staging: GATES(),
      production: GATES({ requireApproval: true }),
    },
  };
  deploy.setReleasePolicy(policy);
  const candidate = () =>
    deploy.createCandidate(ADMIN, {
      projectId: "alpha",
      pushReceiptId: "psr_1",
      targetId: "alpha-preview",
      artifactIds: [artifact.artifactId],
    });
  return { files, artifacts, artifact, deploy, adapter, audit, candidate };
}

test("EO-4.8 61/62 ARTIFACT TAMPERING: a modified artifact is refused before the provider sees it", async () => {
  const h = await deployHarness();
  const c = await h.candidate();
  h.files.set("dist/app.js", "bundle-v1-with-backdoor");
  await assert.rejects(
    h.deploy.deploy(
      ADMIN,
      { projectId: "alpha", candidateId: c.candidateId },
      "t1",
    ),
    denied("INTEGRITY_FAILED"),
  );
  assert.equal(h.adapter.calls, 0, "nothing was deployed");
  assert.ok(
    h.audit
      .query({ type: "execution_event" })
      .some((e) => e.data.action === "deployment_integrity_failed"),
  );
  // Swap: an artifact of another project is not visible to this one.
  await assert.rejects(
    h.deploy.createCandidate(ADMIN, {
      projectId: "alpha",
      pushReceiptId: "psr_1",
      targetId: "alpha-preview",
      artifactIds: ["art_other_project"],
    }),
    denied("STALE_CANDIDATE"),
  );
});

test("EO-4.8 81 PARTIAL DEPLOYMENT: mixed target state is FAILED with per-resource outcome", async () => {
  const h = await deployHarness();
  h.adapter.failedResources = ["functions"];
  const c = await h.candidate();
  const release = await h.deploy.deploy(
    ADMIN,
    { projectId: "alpha", candidateId: c.candidateId },
    "p1",
  );
  assert.equal(release.status, "failed");
  assert.deepEqual(release.resources, {
    completed: ["hosting"],
    failed: ["functions"],
  });
  assert.match(release.reasons[0]!.detail, /partial deployment/);
  assert.equal(release.postDeploy, undefined, "never verified as healthy");
});

test("EO-4.8 79/80 ROLLBACK FAILURE: represented accurately, audited, never claimed as recovered", async () => {
  const h = await deployHarness();
  const good = await h.deploy.deploy(
    ADMIN,
    { projectId: "alpha", candidateId: (await h.candidate()).candidateId },
    "r1",
  );
  assert.equal(good.status, "healthy");
  h.adapter.reachable = false;
  const bad = await h.deploy.deploy(
    ADMIN,
    { projectId: "alpha", candidateId: (await h.candidate()).candidateId },
    "r2",
  );
  assert.equal(bad.status, "degraded");
  h.adapter.rollbackFails = true;
  await assert.rejects(
    h.deploy.rollback(ADMIN, { projectId: "alpha", releaseId: bad.releaseId }),
    denied("ROLLBACK_FAILED"),
  );
  const after = (await h.deploy.listReleases(ADMIN, "alpha")).find(
    (r) => r.releaseId === bad.releaseId,
  )!;
  assert.equal(after.status, "degraded", "still degraded — not rolled back");
  assert.ok(after.reasons.some((r) => r.code === "ROLLBACK_FAILED"));
  assert.ok(
    h.audit
      .query({ type: "execution_event" })
      .some((e) => e.data.action === "rollback_failed"),
  );
  // A successful retry then records the recovery.
  h.adapter.rollbackFails = false;
  const rolled = await h.deploy.rollback(ADMIN, {
    projectId: "alpha",
    releaseId: bad.releaseId,
  });
  assert.equal(rolled.status, "rolled_back");
  assert.equal(rolled.rollback!.toReleaseId, good.releaseId);
});

test("EO-4.8 108 PERSISTENCE FAILURE: protected actions fail closed — no provider call with uncertain state", async () => {
  const broken: ExecutionRecordStore = {
    create: async () => {
      throw new Error("firestore unavailable");
    },
    put: async () => {
      throw new Error("firestore unavailable");
    },
    get: async () => {
      throw new Error("firestore unavailable");
    },
    listBy: async () => {
      throw new Error("firestore unavailable");
    },
  };
  const h = await deployHarness(broken);
  await assert.rejects(h.candidate(), /firestore unavailable/);
  await assert.rejects(
    h.deploy.deploy(ADMIN, { projectId: "alpha", candidateId: "dcn_x" }, "k1"),
    /firestore unavailable/,
  );
  assert.equal(h.adapter.calls, 0);
});

/* ================= orphans, state machine, receipts ================= */

async function withRunningSession() {
  const h = await harness();
  const { session } = await h.manager.createSession(
    OPERATOR,
    h.request(),
    "orphan-key",
  );
  const T0 = "2026-09-24T12:00:00.000Z";
  let running = transitionSession(session, "running", T0);
  running = beginAttempt(running, "att_orphan", T0);
  assert.equal(await h.sessions.commit(running, session.revision), "committed");
  const managerAt = (iso: string) =>
    new ExecutionManager({ ...h.managerOptions, clock: () => iso });
  return { h, session, managerAt };
}

test("EO-4.8 40/104 ORPHANED SESSION: a lost invocation never stays RUNNING; reconciled with a reason and audit", async () => {
  const { h, session, managerAt } = await withRunningSession();
  // Within the operation timeout + grace: untouched.
  assert.equal(
    (
      await managerAt("2026-09-24T12:02:30.000Z").getSession(
        OPERATOR,
        session.sessionId,
      )
    ).status,
    "running",
  );
  // Past it (runner/instance gone): FAILED, not success.
  const reconciled = await managerAt("2026-09-24T12:03:30.000Z").getSession(
    OPERATOR,
    session.sessionId,
  );
  assert.equal(reconciled.status, "failed");
  assert.equal(reconciled.reasons.at(-1)!.code, "SANDBOX_FAILURE");
  assert.match(reconciled.reasons.at(-1)!.detail, /orphaned/);
  assert.equal(reconciled.attempts[0]!.status, "failed");
  assert.equal(
    (await h.sessions.get(session.sessionId))!.status,
    "failed",
    "persisted",
  );
  assert.ok(
    h.fixture.audit
      .query({ type: "execution_event" })
      .some((e) => e.data.action === "session_reconciled"),
  );
});

test("EO-4.8 45/106 SESSION BUDGET + ORPHANED CANCEL: exhausted budget → timed_out; stuck cancelling → cancelled", async () => {
  const a = await withRunningSession();
  const listed = await a
    .managerAt("2026-09-24T12:11:00.000Z")
    .listSessions(OPERATOR, "alpha");
  assert.equal(
    listed.find((s) => s.sessionId === a.session.sessionId)!.status,
    "timed_out",
  );
  const b = await withRunningSession();
  const stored = (await b.h.sessions.get(b.session.sessionId))!;
  const cancelling = transitionSession(
    stored,
    "cancelling",
    "2026-09-24T12:00:10.000Z",
  );
  assert.equal(
    await b.h.sessions.commit(cancelling, stored.revision),
    "committed",
  );
  const again = await b
    .managerAt("2026-09-24T12:04:00.000Z")
    .cancel(OPERATOR, b.session.sessionId, "retry stop", "cancel");
  assert.equal(again.session.status, "cancelled");
});

test("EO-4.8 107/109 STATE MACHINE + EVENT ORDERING: terminal states are final; stale writes never win", async () => {
  for (const [from, to] of [
    ["succeeded", "running"],
    ["failed", "running"],
    ["cancelled", "running"],
    ["denied", "ready"],
    ["timed_out", "succeeded"],
    ["ready", "succeeded"],
  ] as const) {
    assert.equal(canTransitionSession(from, to), false, `${from} → ${to}`);
  }
  const store = new InMemoryExecutionSessionStore();
  const h = await harness({ sessions: store });
  const { session } = await h.manager.createSession(
    OPERATOR,
    h.request(),
    "order-key",
  );
  const cancelled = await h.manager.cancel(
    OPERATOR,
    session.sessionId,
    "stop",
    "cancel",
  );
  assert.equal(cancelled.session.status, "cancelled");
  // A delayed event built from the OLD revision tries to report success.
  const late = {
    ...transitionSession(session, "running", "2026-09-24T12:00:05.000Z"),
  };
  assert.equal(
    await store.commit(late, session.revision),
    "conflict",
    "older event cannot overwrite the terminal state",
  );
  assert.equal((await store.get(session.sessionId))!.status, "cancelled");
});

test("EO-4.8 97/99 RECEIPT PERSISTENCE FAILURE: the execution result is kept and the evidence gap is audited", async () => {
  const failingStore: ExecutionRecordStore = {
    create: async () => {
      throw new Error("write failed");
    },
    put: async () => undefined,
    get: async () => undefined,
    listBy: async () => [],
  };
  const h = await harness({ receiptStore: failingStore });
  const { session } = await h.manager.createSession(
    OPERATOR,
    h.request(),
    "rcp-key",
  );
  const result = await h.manager.invoke(OPERATOR, {
    sessionId: session.sessionId,
    invocationId: "i1",
    toolId: "wf.web-build",
    operationId: "web.build",
    input: { profile: "production", outDir: "dist" },
  });
  assert.equal(result.exitClass, "denied");
  assert.ok(
    h.fixture.audit
      .query({ type: "execution_event" })
      .some(
        (e) =>
          e.data.action === "receipt_persistence_failed" &&
          e.data.receiptId === result.receiptId,
      ),
  );
});

/* ================= API hardening ================= */

test("EO-4.8 91 API INPUT: malformed JSON, oversized bodies and unknown fields fail safely (never 500)", async () => {
  const h = await harness();
  const projects = new ProjectRegistry();
  projects.register({
    projectId: "alpha",
    async describe() {
      return { name: "alpha", capabilities: [] };
    },
    async execute() {
      return {};
    },
  });
  const ctx: ControlPlaneContext = {
    agents: h.fixture.agents,
    tasks: new TaskSystem(),
    workflows: new WorkflowSystem(),
    approvals: h.fixture.approvals,
    permissions: new PermissionSystem([]),
    tools: h.tools,
    projects,
    audit: h.fixture.audit,
    agentOps: new AgentOperationalStore(),
    workflowControl: new WorkflowControlStore(),
    environments: h.fixture.registry,
    planning: h.fixture.planning,
    execution: h.manager,
  };
  const server = http.createServer(
    createControlPlaneApi({
      query: new WorkforceQueryService(ctx),
      command: new WorkforceCommandService(ctx),
      operatorDirectory: {
        resolve: async (t) => (t === "admin" ? ADMIN : null),
      },
      maxBodyBytes: 4096,
    }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const post = async (path: string, body: string) =>
    (
      await fetch(`http://127.0.0.1:${port}/api${path}`, {
        method: "POST",
        headers: {
          authorization: "Bearer admin",
          "content-type": "application/json",
        },
        body,
      })
    ).status;
  try {
    assert.equal(await post("/execution/preflight", "{not json"), 400);
    assert.equal(
      await post(
        "/execution/preflight",
        JSON.stringify({ padding: "x".repeat(10_000) }),
      ),
      400,
    );
    assert.equal(
      await post(
        "/execution/preflight",
        JSON.stringify({ ...h.request(), shell: "bash -c id" }),
      ),
      400,
    );
    assert.equal(await post("/commands/cancel-execution", "[]"), 400);
    const unknown = await fetch(`http://127.0.0.1:${port}/api/does-not-exist`, {
      headers: { authorization: "Bearer admin" },
    });
    assert.equal(unknown.status, 404);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

/* ================= static release checks ================= */

test("EO-4.8 126/127/49 PRODUCTION WIRING: no test doubles, no simulated providers, no model calls in execution", () => {
  const root = process.cwd();
  const production = readFileSync(
    path.join(root, "api", "production-control-plane.ts"),
    "utf8",
  );
  for (const forbidden of [
    "Fake",
    "Mock",
    "Scripted",
    "Flaky",
    "NonExecuting",
    "TestSandbox",
    "test-double",
    "simulated: true",
    "InMemoryExecutionSessionStore",
  ]) {
    assert.ok(
      !production.includes(forbidden),
      `production composition references ${forbidden}`,
    );
  }
  assert.ok(
    production.includes("FirestoreExecutionSessionStore") &&
      production.includes("FirestoreExecutionRecordStore"),
  );
  for (const file of [
    "core/execution/execution-manager.ts",
    "core/execution/verification-service.ts",
    "core/release/source-control-orchestrator.ts",
    "core/release/deployment-orchestrator.ts",
    "core/execution/environment-adapters.ts",
  ]) {
    const source = readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(
      source,
      /model-provider|openai|anthropic|ModelRouter/i,
      `${file} must not call models`,
    );
    assert.doesNotMatch(
      source,
      /child_process|shell:\s*true/,
      `${file} must not spawn processes`,
    );
  }
});
