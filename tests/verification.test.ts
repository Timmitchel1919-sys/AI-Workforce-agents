/**
 * EO-4.4 — controlled build, test & verification runtime.
 *
 * Every build/test runs against a TEMPORARY git repository with a tiny Node
 * project (never the AI Workforce repository), through the real pipeline:
 * VerificationService → ExecutionManager → ToolExecutionEngine →
 * WorkspaceBuildRunner / WorkspaceRepositorySandbox.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  WorkspaceBuildRunner,
  WorkspaceRepositorySandbox,
  resolveTrustedExecutable,
} from "../adapters/index.js";
import {
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  type ExecutionPolicy,
  type SandboxHandle,
  type SandboxInvocationOutcome,
  type SandboxProvider,
  type StageProfile,
  type VerificationProfile,
  type VerificationResult,
} from "../contracts/index.js";
import {
  ArtifactManager,
  BASELINE_DENY_ALL_POLICY,
  BUILD_PROFILE_PRESETS,
  BoundedInvocationDispatcher,
  ExecutionManager,
  ExecutionOperationRegistry,
  ExecutionPolicyRegistry,
  ExecutionToolRegistry,
  InMemoryExecutionReceiptStore,
  InMemoryExecutionSessionStore,
  PermissionSystem,
  SandboxRegistry,
  ToolExecutionEngine,
  ToolRegistry,
  VerificationService,
  WORKSPACE_OPERATIONS,
  WORKSPACE_TOOL,
  defineBuildTool,
  registerExecutionTool,
} from "../core/index.js";
import {
  BETA_OPERATOR,
  FAKE_SECRET,
  OPERATOR,
  VIEWER,
} from "./fixtures/execution.js";
import {
  WEB_AGENT,
  WEB_HOST,
  WEB_INSTANCE,
  agent,
  planningFixture,
  webRequest,
} from "./fixtures/planning.js";

const GIT = resolveTrustedExecutable("git");

function git(cwd: string, ...args: string[]) {
  return execFileSync(
    GIT!,
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.autocrlf=false",
      ...args,
    ],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    },
  );
}

/** Tiny Node project. The leak script assembles the fake key at runtime. */
const PROJECT: Record<string, string> = {
  "package.json": '{ "type": "module" }\n',
  ".gitignore": "dist/\n",
  "src/app.js": "export const answer = () => 42;\n",
  "build.js":
    'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";\n' +
    'mkdirSync("dist", { recursive: true });\n' +
    'writeFileSync("dist/out.js", readFileSync("src/app.js", "utf8"));\n' +
    'console.log("built dist/out.js");\n',
  "test/app.test.js":
    'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
    'import { answer } from "../src/app.js";\n' +
    'test("answer", () => assert.equal(answer(), 42));\n',
  "test/fail.test.js":
    'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
    'test("broken", () => assert.equal(1, 2));\n',
  "scripts/fail-build.js":
    'console.error("error TS2322: type mismatch");\nprocess.exit(2);\n',
  "scripts/slow.js": "setInterval(() => {}, 1000);\n",
  "scripts/flood.js": 'process.stdout.write("x".repeat(3_000_000));\n',
  "scripts/leak.js":
    'console.log("token=" + "sk-live-" + "abcdefghijklmnop1234");\n',
  "scripts/mutate.js":
    'import { writeFileSync } from "node:fs";\nwriteFileSync("src/mutated.js", "export {};\\n");\n',
};

const NODE_TOOL = defineBuildTool({
  toolId: "node-build",
  executableId: "node",
  requiredToolchains: ["node"],
  commands: [
    {
      operationId: "node.build",
      stageKind: "build",
      description: "Build",
      argv: ["build.js"],
      workspaceAccess: "write",
    },
    {
      operationId: "node.typecheck",
      stageKind: "build",
      description: "Syntax check",
      argv: ["--check", "src/app.js"],
    },
    {
      operationId: "node.failbuild",
      stageKind: "build",
      description: "Failing build",
      argv: ["scripts/fail-build.js"],
    },
    {
      operationId: "node.test",
      stageKind: "test",
      description: "Unit tests",
      argv: ["--test", "test/app.test.js"],
    },
    {
      operationId: "node.test.fail",
      stageKind: "test",
      description: "Failing tests",
      argv: ["--test", "test/fail.test.js"],
    },
    {
      operationId: "node.slow",
      stageKind: "test",
      description: "Hangs",
      argv: ["scripts/slow.js"],
      timeoutMs: 1500,
    },
    {
      operationId: "node.slow.long",
      stageKind: "test",
      description: "Hangs long",
      argv: ["scripts/slow.js"],
      timeoutMs: 30_000,
    },
    {
      operationId: "node.flood",
      stageKind: "test",
      description: "Floods",
      argv: ["scripts/flood.js"],
    },
    {
      operationId: "node.leak",
      stageKind: "test",
      description: "Leaks",
      argv: ["scripts/leak.js"],
    },
    {
      operationId: "node.mutate",
      stageKind: "test",
      description: "Mutates source",
      argv: ["scripts/mutate.js"],
      workspaceAccess: "write",
    },
    {
      operationId: "node.deps",
      stageKind: "test",
      description: "Needs deps",
      argv: ["--test", "test/app.test.js"],
      requiredPaths: ["node_modules/left-pad/package.json"],
    },
  ],
});
const DOTNET_TOOL = defineBuildTool(BUILD_PROFILE_PRESETS.dotnet!);

/* ---- TEST-ONLY flaky provider: first call crashes, then succeeds ---- */
class FlakyTestSandbox implements SandboxProvider {
  readonly providerId = "flaky-test-double";
  readonly kind = "local_restricted_process" as const;
  readonly capabilities = {
    enforcedLimits: [
      "sessionTimeoutMs",
      "operationTimeoutMs",
      "maxOutputBytes",
      "maxArtifactBytes",
      "maxToolCalls",
    ] as const,
    networkModes: ["deny_all" as const],
    networkIsolation: true,
    filesystemIsolation: true,
    supportsKill: true,
    maxConcurrentInvocations: 4,
    simulated: true,
    executables: ["flaky"],
  };
  calls = 0;
  constructor(private readonly failures: number) {}
  isAvailableFor(id: string) {
    return id === "web-1";
  }
  async prepareWorkspace(): Promise<never> {
    throw new Error("not used");
  }
  async start(spec: { sessionId: string }): Promise<SandboxHandle> {
    return {
      sandboxId: `sbx-${spec.sessionId}`,
      providerId: this.providerId,
      sessionId: spec.sessionId,
    };
  }
  async invoke(): Promise<SandboxInvocationOutcome> {
    this.calls += 1;
    if (this.calls <= this.failures) throw new Error("transient sandbox crash");
    return {
      exitClass: "success",
      exitCode: 0,
      stdout: { text: "ok", truncated: false, originalBytes: 2 },
      stderr: { text: "", truncated: false, originalBytes: 0 },
      durationMs: 1,
      redactions: 0,
    };
  }
  async terminate() {}
  async collectOutputs() {
    return [];
  }
  async cleanup() {}
}

const FLAKY = defineBuildTool({
  toolId: "flaky-tool",
  executableId: "flaky",
  requiredToolchains: [],
  commands: [
    {
      operationId: "flaky.check",
      stageKind: "test",
      description: "Flaky",
      argv: ["check"],
    },
  ],
});

function makeRepo(root: string, name: string, files: Record<string, string>) {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "initial");
  return dir;
}

async function harness(
  options: {
    flakyFailures?: number;
    maxArtifactBytes?: number;
    trustedHostBuild?: boolean;
  } = {},
) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "aiw-eo44-"));
  const repoA = makeRepo(tmp, "repo-a", PROJECT);
  const repoB = makeRepo(tmp, "repo-b", { "b.txt": "beta\n" });
  const stateRoot = path.join(tmp, "state");
  mkdirSync(stateRoot);

  const fixture = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [WEB_AGENT, agent("sec-agent", ["security_review"])],
  });
  const tools = new ToolRegistry(fixture.audit);
  const executionTools = new ExecutionToolRegistry();
  const dispatcher = new BoundedInvocationDispatcher();
  const scope = {
    allowedAgents: ["web-agent", "sec-agent"],
    allowedProjects: ["alpha", "beta"],
    allowedEnvironments: ["local" as const],
  };
  const operations = new ExecutionOperationRegistry();
  for (const t of [
    WORKSPACE_TOOL,
    NODE_TOOL.tool,
    DOTNET_TOOL.tool,
    FLAKY.tool,
  ]) {
    registerExecutionTool(tools, executionTools, dispatcher, t, scope);
  }
  [
    ...WORKSPACE_OPERATIONS,
    ...NODE_TOOL.operations,
    ...DOTNET_TOOL.operations,
    ...FLAKY.operations,
  ].forEach((o) => operations.register(o));

  const policy: ExecutionPolicy = {
    policyId: "verify",
    version: 1,
    description: "EO-4.4 test policy.",
    rules: [
      {
        id: "build",
        operationIds: [
          ...NODE_TOOL.operations,
          ...DOTNET_TOOL.operations,
          ...FLAKY.operations,
        ].map((o) => o.id),
        capabilities: [
          "filesystem.read",
          "filesystem.write.workspace",
          "build.invoke",
          "test.invoke",
        ],
        filesystem: [{ access: "write", path: "." }],
        requiredEnvironmentCapabilities: [],
        trustedHostBuild: options.trustedHostBuild ?? true,
      },
      {
        id: "scan",
        operationIds: ["workspace.security.secretScan"],
        capabilities: ["filesystem.read", "security.scan.invoke"],
        filesystem: [{ access: "read", path: "." }],
        requiredEnvironmentCapabilities: [],
      },
      {
        id: "dev",
        operationIds: ["workspace.file.create", "workspace.file.read"],
        capabilities: ["filesystem.read", "filesystem.write.workspace"],
        filesystem: [{ access: "write", path: "." }],
        requiredEnvironmentCapabilities: [],
      },
    ],
    forbiddenCapabilities: [
      "repository.push",
      "repository.commit",
      "deploy.invoke",
    ],
    maxRisk: "high",
    approvalRequiredAtOrAbove: "high",
    defaultLimits: {
      sessionTimeoutMs: 600_000,
      operationTimeoutMs: 60_000,
      maxOutputBytes: 64 * 1024,
      maxArtifactBytes: 1_000_000,
      maxToolCalls: 50,
    },
    network: { mode: "deny_all" },
    grantTtlMs: 600_000,
  };
  const policies = new ExecutionPolicyRegistry({
    policyId: "baseline-deny-all",
    version: 1,
  });
  policies.register(BASELINE_DENY_ALL_POLICY);
  policies.register(policy);
  policies.bindProject("alpha", "verify", 1);
  policies.bindProject("beta", "verify", 1);

  const workspace = new WorkspaceRepositorySandbox({
    repositories: [
      { repositoryId: "repo-alpha", projectId: "alpha", localPath: repoA },
      { repositoryId: "repo-beta", projectId: "beta", localPath: repoB },
    ],
    environmentInstanceIds: ["web-1"],
    gitPath: GIT,
    stateRoot,
    onEvent: (e) =>
      fixture.audit.record("execution_event", {
        projectId: e.projectId,
        data: { ...e.data, action: e.action },
      }),
  });
  const runner = new WorkspaceBuildRunner({
    workspace,
    executables: { node: process.execPath },
    environmentInstanceIds: ["web-1"],
    maxConcurrentInvocations: 4,
  });
  const flaky = new FlakyTestSandbox(options.flakyFailures ?? 0);
  const sandboxes = new SandboxRegistry();
  sandboxes.register(workspace);
  sandboxes.register(runner);
  sandboxes.register(flaky);
  const engine = new ToolExecutionEngine({
    registry: tools,
    permissions: new PermissionSystem([{ effect: "allow", action: "execute" }]),
    audit: fixture.audit,
  });
  const sessions = new InMemoryExecutionSessionStore();
  const receipts = new InMemoryExecutionReceiptStore();
  let seq = 0;
  const projects = { has: (id: string) => id === "alpha" || id === "beta" };
  const manager = new ExecutionManager({
    planning: fixture.planning,
    approvals: fixture.approvals,
    agents: fixture.agents,
    isAgentEnabled: (id) => !fixture.disabled.has(id),
    environments: fixture.registry,
    tools,
    projects,
    operations,
    policies,
    sandboxes,
    sessions,
    audit: fixture.audit,
    clock: () => new Date().toISOString(),
    idFactory: (prefix) => `${prefix}_${++seq}`,
    executionTools,
    toolEngine: engine,
    dispatcher,
    receipts,
    workspaceControl: workspace,
    maxConcurrentPerEnvironment: 8,
  });
  const artifacts = new ArtifactManager({
    source: workspace,
    maxArtifactBytes: options.maxArtifactBytes ?? 1_000_000,
    idFactory: (prefix) => `${prefix}_${++seq}`,
  });
  const verification = new VerificationService({
    manager,
    planning: fixture.planning,
    operations,
    environments: fixture.registry,
    sandboxes,
    projects,
    audit: fixture.audit,
    artifacts,
    workspaceControl: workspace,
    idFactory: (prefix) => `${prefix}_${++seq}`,
  });
  const plans = {
    alpha: await fixture.planning.createPlan(webRequest("alpha"), {
      id: "op-1",
    }),
    beta: await fixture.planning.createPlan(webRequest("beta"), { id: "op-2" }),
  };
  const profile = (
    stages: Record<string, StageProfile>,
    extra: Partial<VerificationProfile> = {},
    projectId: "alpha" | "beta" = "alpha",
  ) =>
    verification.registerProfile({
      projectId,
      stages,
      failFast: false,
      maxParallel: 2,
      requireAllPlannedStages: false,
      ...extra,
    });
  let keys = 0;
  const run = async (
    principal = OPERATOR,
    extra: Record<string, unknown> = {},
  ) => {
    const project = principal === BETA_OPERATOR ? "beta" : "alpha";
    const plan = plans[project];
    const started = await verification.start(
      principal,
      {
        projectId: project,
        planId: plan.planId,
        planVersion: plan.version,
        ...extra,
      },
      `vk-${++keys}`,
    );
    return verification.wait(principal, started.verificationId);
  };
  return {
    tmp,
    repoA,
    fixture,
    manager,
    workspace,
    receipts,
    verification,
    artifacts,
    flaky,
    plans,
    profile,
    run,
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

const req = (
  operationId: string,
  extra: Partial<StageProfile> = {},
): StageProfile => ({
  operationId,
  required: true,
  ...extra,
});
const stage = (r: VerificationResult, id: string) =>
  r.stages.find((s) => s.stageId === id)!;
const why = (r: VerificationResult) =>
  JSON.stringify({
    status: r.status,
    reasons: r.reasons,
    stages: r.stages.map((s) => [s.stageId, s.status, s.failure]),
  });

test("77 BUILD SUCCESS: a registered build + tests + secret scan pass with evidence", async () => {
  const h = await harness();
  try {
    h.profile({
      "build:web": req("node.build", {
        artifacts: [
          { kind: "bundle", path: "dist/out.js", mediaType: "text/javascript" },
        ],
      }),
      "test:web:unit": req("node.test"),
      "security:secret_scan": req("workspace.security.secretScan"),
    });
    const r = await h.run();
    assert.equal(r.status, "passed", why(r));
    assert.equal(stage(r, "build:web").status, "passed");
    assert.equal(stage(r, "test:web:unit").status, "passed");
    assert.equal(stage(r, "security:secret_scan").status, "passed");
    assert.equal(stage(r, "test:web:unit").category, "unit");
    assert.ok(stage(r, "build:web").receiptIds.length === 1);
    assert.match(stage(r, "build:web").log!.text, /built dist\/out\.js/);
    assert.match(r.sourceFingerprint, /^[0-9a-f]{64}$/);
    assert.equal(r.finalFingerprint, r.sourceFingerprint);
    assert.match(r.baseRevision!, /^[0-9a-f]{40}/);
    assert.deepEqual(
      r.toolchains.map((t) => [t.kind, t.version, t.source]),
      [["node", "20.11.1", "environment_registry"]],
    );
    // Honest isolation: host build runner does not isolate.
    assert.deepEqual(r.isolation, { filesystem: false, network: false });
    // Unmapped planned stages are listed, never faked.
    assert.ok(r.unverifiedStageIds.includes("security:sast"));
    assert.equal(stage(r, "security:sast").status, "not_run");
    assert.equal(stage(r, "security:sast").failure!.kind, "NO_PROFILE");
  } finally {
    h.cleanup();
  }
});

test("78 BUILD FAILURE: a failing compile is BUILD_FAILED; dependents are BLOCKED_BY_DEPENDENCY", async () => {
  const h = await harness();
  try {
    h.profile({
      "build:web": req("node.failbuild"),
      "test:web:unit": req("node.test"),
    });
    const r = await h.run();
    assert.equal(r.status, "failed", why(r));
    const b = stage(r, "build:web");
    assert.equal(b.status, "failed");
    assert.equal(b.failure!.kind, "BUILD_FAILED");
    assert.equal(b.exitClass, "tool_failure");
    assert.match(b.log!.text, /TS2322/);
    const t = stage(r, "test:web:unit");
    assert.equal(t.status, "not_run");
    assert.equal(t.failure!.kind, "BLOCKED_BY_DEPENDENCY");
    assert.equal(
      t.sessionIds.length,
      0,
      "a blocked stage never starts a session",
    );
  } finally {
    h.cleanup();
  }
});

test("79 TYPECHECK: a syntax/type check is a registered build operation", async () => {
  const h = await harness();
  try {
    h.profile({ "build:web": req("node.typecheck") });
    const ok = await h.run();
    assert.equal(stage(ok, "build:web").status, "passed", why(ok));
    writeFileSync(path.join(h.repoA, "src/app.js"), "export const = ;\n");
    const bad = await h.run();
    assert.equal(stage(bad, "build:web").failure!.kind, "BUILD_FAILED");
  } finally {
    h.cleanup();
  }
});

test("80 TEST FAILURE: failing tests are TEST_FAILED (not an execution error) and are not retried", async () => {
  const h = await harness();
  try {
    h.profile({
      "build:web": req("node.build"),
      "test:web:unit": req("node.test.fail", { maxAttempts: 3 }),
    });
    const r = await h.run();
    assert.equal(r.status, "failed");
    const t = stage(r, "test:web:unit");
    assert.equal(t.failure!.kind, "TEST_FAILED");
    assert.equal(
      t.attempts,
      1,
      "a failing test is a result, not a transient error",
    );
  } finally {
    h.cleanup();
  }
});

test("81 TIMEOUT: a hanging stage is killed at its timeout and reported timed_out", async () => {
  const h = await harness();
  try {
    h.profile({
      "build:web": req("node.build"),
      "test:web:unit": req("node.slow"),
    });
    const started = Date.now();
    const r = await h.run();
    assert.ok(Date.now() - started < 20_000);
    assert.equal(r.status, "timed_out", why(r));
    assert.equal(stage(r, "test:web:unit").status, "timed_out");
    assert.equal(stage(r, "test:web:unit").failure!.kind, "TIMEOUT");
  } finally {
    h.cleanup();
  }
});

test("82 CANCELLATION: cancelling stops the running process and never starts more stages", async () => {
  const h = await harness();
  try {
    h.profile(
      {
        "build:web": req("node.build"),
        "test:web:unit": req("node.slow.long"),
        "security:secret_scan": req("workspace.security.secretScan", {
          dependsOn: ["test:web:unit"],
        }),
      },
      { maxParallel: 1 },
    );
    const plan = h.plans.alpha;
    const started = await h.verification.start(
      OPERATOR,
      { projectId: "alpha", planId: plan.planId, planVersion: plan.version },
      "cancel-1",
    );
    await new Promise((r) => setTimeout(r, 800));
    const t0 = Date.now();
    await h.verification.cancel(
      OPERATOR,
      started.verificationId,
      "operator stop",
    );
    const r = await h.verification.wait(OPERATOR, started.verificationId);
    assert.ok(Date.now() - t0 < 10_000, "process tree killed promptly");
    assert.equal(r.status, "cancelled", why(r));
    assert.equal(stage(r, "test:web:unit").status, "cancelled");
    assert.notEqual(stage(r, "security:secret_scan").status, "passed");
    assert.equal(stage(r, "security:secret_scan").sessionIds.length, 0);
    await assert.rejects(
      h.verification.cancel(VIEWER, started.verificationId, "x"),
      PermissionDeniedError,
    );
  } finally {
    h.cleanup();
  }
});

test("83 LOG LIMITS: flooding output is bounded and truncation is explicit", async () => {
  const h = await harness();
  try {
    h.profile({
      "build:web": req("node.build"),
      "test:web:unit": req("node.flood"),
    });
    const r = await h.run();
    const t = stage(r, "test:web:unit");
    assert.ok(Buffer.byteLength(t.log!.text) <= 64 * 1024);
    assert.equal(t.log!.truncated, true);
  } finally {
    h.cleanup();
  }
});

test("84 LOG REDACTION: a secret printed by project code never reaches logs, receipts or audit", async () => {
  const h = await harness();
  try {
    h.profile({
      "build:web": req("node.build"),
      "test:web:unit": req("node.leak"),
    });
    const r = await h.run();
    const t = stage(r, "test:web:unit");
    assert.equal(t.status, "passed", why(r));
    assert.ok(!t.log!.text.includes(FAKE_SECRET));
    assert.ok(!JSON.stringify(r).includes(FAKE_SECRET));
    assert.ok(
      !JSON.stringify(h.receipts.get(t.receiptIds[0]!)).includes(FAKE_SECRET),
    );
    assert.ok(!JSON.stringify(h.fixture.audit.query({})).includes(FAKE_SECRET));
  } finally {
    h.cleanup();
  }
});

test("85 SECRET SCAN: findings fail the security stage with path/line/rule only — never the value", async () => {
  const h = await harness();
  try {
    writeFileSync(
      path.join(h.repoA, "src/config.js"),
      `export const key = "${FAKE_SECRET}";\n`,
    );
    h.profile({ "security:secret_scan": req("workspace.security.secretScan") });
    const r = await h.run();
    assert.equal(r.status, "failed", why(r));
    const s = stage(r, "security:secret_scan");
    assert.equal(s.failure!.kind, "FINDINGS");
    assert.deepEqual(s.findings, [
      { rule: "known-secret-shape", severity: "high", count: 1 },
    ]);
    assert.match(s.log!.text, /src\/config\.js/);
    assert.ok(!JSON.stringify(r).includes(FAKE_SECRET));
  } finally {
    h.cleanup();
  }
});

test("86 MISSING TOOLCHAIN: a dotnet stage on a node-only environment is blocked TOOLCHAIN_UNAVAILABLE", async () => {
  const h = await harness();
  try {
    h.profile({ "build:web": req("dotnet.build") });
    const r = await h.run();
    assert.equal(r.status, "blocked", why(r));
    assert.equal(stage(r, "build:web").status, "blocked");
    assert.equal(stage(r, "build:web").failure!.kind, "TOOLCHAIN_UNAVAILABLE");
  } finally {
    h.cleanup();
  }
});

test("87 MISSING DEPENDENCY: declared dependencies are required, never installed", async () => {
  const h = await harness();
  try {
    h.profile({
      "build:web": req("node.build"),
      "test:web:unit": req("node.deps"),
    });
    const r = await h.run();
    assert.equal(
      stage(r, "test:web:unit").failure!.kind,
      "DEPENDENCY_MISSING",
      why(r),
    );
    assert.equal(r.status, "blocked");
    mkdirSync(path.join(h.repoA, "node_modules/left-pad"), { recursive: true });
    writeFileSync(
      path.join(h.repoA, "node_modules/left-pad/package.json"),
      "{}\n",
    );
    const ok = await h.run();
    assert.equal(ok.status, "passed", why(ok));
  } finally {
    h.cleanup();
  }
});

test("88 HOST BUILD OPT-IN: without trustedHostBuild project code never runs on the host", async () => {
  const h = await harness({ trustedHostBuild: false });
  try {
    h.profile({ "build:web": req("node.build") });
    const r = await h.run();
    assert.equal(r.status, "blocked", why(r));
    assert.equal(stage(r, "build:web").failure!.kind, "SANDBOX_UNAVAILABLE");
  } finally {
    h.cleanup();
  }
});

test("89 RETRIES: transient execution errors are retried within maxAttempts only", async () => {
  const h = await harness({ flakyFailures: 1 });
  try {
    h.profile({
      "build:web": req("node.build"),
      "test:web:unit": req("flaky.check", { maxAttempts: 2 }),
    });
    const r = await h.run();
    assert.equal(r.status, "passed", why(r));
    assert.equal(stage(r, "test:web:unit").attempts, 2);
    assert.equal(stage(r, "test:web:unit").sessionIds.length, 2);
    // The build ran on the host runner: a verification is only as isolated
    // as its least isolated stage — never reported better than it was.
    assert.deepEqual(r.isolation, { filesystem: false, network: false });
  } finally {
    h.cleanup();
  }
  const h2 = await harness({ flakyFailures: 5 });
  try {
    h2.profile({
      "build:web": req("node.build"),
      "test:web:unit": req("flaky.check", { maxAttempts: 3 }),
    });
    const r = await h2.run();
    assert.equal(stage(r, "test:web:unit").status, "error");
    assert.equal(stage(r, "test:web:unit").attempts, 3);
    assert.equal(h2.flaky.calls, 3, "bounded: never more than maxAttempts");
    assert.equal(r.status, "failed");
  } finally {
    h2.cleanup();
  }
});

test("90 FAIL-FAST vs CONTINUE: fail-fast stops new stages; continue runs independent ones", async () => {
  const stages = {
    "build:web": req("node.failbuild"),
    "security:secret_scan": req("workspace.security.secretScan"),
  };
  const h = await harness();
  try {
    h.profile(stages, { failFast: true, maxParallel: 1 });
    const r = await h.run();
    assert.equal(
      stage(r, "security:secret_scan").failure!.kind,
      "FAIL_FAST",
      why(r),
    );
    assert.equal(stage(r, "security:secret_scan").sessionIds.length, 0);
  } finally {
    h.cleanup();
  }
  const h2 = await harness();
  try {
    h2.profile(stages, { failFast: false, maxParallel: 1 });
    const r = await h2.run();
    assert.equal(stage(r, "security:secret_scan").status, "passed", why(r));
    assert.equal(r.status, "failed");
  } finally {
    h2.cleanup();
  }
});

test("91 DAG: cycles and unknown stages are refused before anything executes", async () => {
  const h = await harness();
  try {
    h.profile({
      "build:web": req("node.build", { dependsOn: ["test:web:unit"] }),
      "test:web:unit": req("node.test"),
    });
    const plan = h.plans.alpha;
    await assert.rejects(
      h.verification.start(
        OPERATOR,
        { projectId: "alpha", planId: plan.planId, planVersion: plan.version },
        "c1",
      ),
      (e: unknown) => e instanceof ValidationError && /cycle/.test(e.message),
    );
    // Profile stages must exist in the plan revision (deployment never runs).
    h.profile({ "deploy:web": req("node.build") });
    await assert.rejects(
      h.verification.start(
        OPERATOR,
        { projectId: "alpha", planId: plan.planId, planVersion: plan.version },
        "c2",
      ),
      ValidationError,
    );
    assert.throws(
      () => h.profile({ "build:web": req("npm.run.anything") }),
      ValidationError,
    );
  } finally {
    h.cleanup();
  }
});

test("92 PARALLELISM: read-only stages run concurrently within maxParallel; write stages run alone", async () => {
  const h = await harness();
  try {
    h.profile(
      {
        "build:web": req("node.build"),
        "test:web:unit": req("node.test"),
        "test:web:ui": req("node.test"),
        "test:web:e2e": req("node.test"),
        "security:secret_scan": req("workspace.security.secretScan"),
      },
      { maxParallel: 2 },
    );
    const r = await h.run();
    assert.equal(r.status, "passed", why(r));
    const b = stage(r, "build:web");
    for (const id of ["test:web:unit", "test:web:ui", "test:web:e2e"]) {
      assert.ok(
        stage(r, id).startedAt! >= b.endedAt!,
        `${id} starts after the build`,
      );
    }
    // Never more than maxParallel at once.
    const spans = r.stages
      .filter((s) => s.startedAt)
      .map((s) => [Date.parse(s.startedAt!), Date.parse(s.endedAt!)] as const);
    for (const [start] of spans) {
      const overlapping = spans.filter(
        ([s, e]) => s <= start && start < e,
      ).length;
      assert.ok(overlapping <= 2);
    }
    assert.throws(() => h.profile({}, { maxParallel: 9 }), ValidationError);
  } finally {
    h.cleanup();
  }
});

test("93 ARTIFACTS: digests, integrity re-check, size limit and secret files", async () => {
  const h = await harness({ maxArtifactBytes: 1024 });
  try {
    h.profile({
      "build:web": req("node.build", {
        artifacts: [{ kind: "bundle", path: "dist/out.js" }],
      }),
    });
    const r = await h.run();
    assert.equal(r.status, "passed", why(r));
    const [id] = r.artifactIds;
    const a = h.artifacts.get("alpha", id!)!;
    assert.equal(a.digest.algorithm, "sha256");
    assert.equal(a.sourceFingerprint, r.sourceFingerprint);
    assert.equal(a.path, "dist/out.js");
    assert.ok(Object.isFrozen(a));
    assert.equal((await h.artifacts.verify("alpha", id!)).intact, true);
    writeFileSync(path.join(h.repoA, "dist/out.js"), "tampered\n");
    assert.equal((await h.artifacts.verify("alpha", id!)).intact, false);
    assert.equal(h.artifacts.get("beta", id!), undefined, "project isolation");
    await assert.rejects(
      h.artifacts.record({
        projectId: "alpha",
        verificationId: "v",
        stageId: "s",
        sourceFingerprint: "f",
        kind: "env",
        path: ".env",
      }),
    );
    writeFileSync(path.join(h.repoA, "dist/big.bin"), "x".repeat(4096));
    await assert.rejects(
      h.artifacts.record({
        projectId: "alpha",
        verificationId: "v",
        stageId: "s",
        sourceFingerprint: "f",
        kind: "bin",
        path: "dist/big.bin",
      }),
      /exceeds/,
    );
    await assert.rejects(
      h.artifacts.record({
        projectId: "alpha",
        verificationId: "v",
        stageId: "s",
        sourceFingerprint: "f",
        kind: "x",
        path: "../outside",
      }),
    );
  } finally {
    h.cleanup();
  }
});

test("94 SOURCE FINGERPRINT: a source change during verification invalidates it", async () => {
  const h = await harness();
  try {
    h.profile({
      "build:web": req("node.build"),
      "test:web:unit": req("node.mutate"),
    });
    const r = await h.run();
    assert.equal(stage(r, "test:web:unit").status, "passed", why(r));
    assert.equal(r.status, "failed");
    assert.ok(r.reasons.some((x) => x.code === "SOURCE_CHANGED"));
    assert.notEqual(r.finalFingerprint, r.sourceFingerprint);
  } finally {
    h.cleanup();
  }
});

test("95 CHANGESET: a verified ChangeSet is VERIFIED — not committed, not pushed", async () => {
  const h = await harness();
  try {
    const plan = h.plans.alpha;
    const { session } = await h.manager.createSession(
      OPERATOR,
      {
        projectId: "alpha",
        planId: plan.planId,
        planVersion: plan.version,
        stageId: "build:web",
        operationId: "workspace.file.create",
        operationIds: ["workspace.file.read"],
      },
      "dev-1",
    );
    const created = await h.manager.invoke(OPERATOR, {
      sessionId: session.sessionId,
      invocationId: "dev-inv-1",
      toolId: "workspace",
      operationId: "workspace.file.create",
      input: { path: "src/extra.js", content: "export const extra = 1;\n" },
    });
    assert.equal(created.exitClass, "success", JSON.stringify(created.reasons));
    h.profile({
      "build:web": req("node.build"),
      "test:web:unit": req("node.test"),
    });
    // The author's session must end first: verification never races it.
    await assert.rejects(
      h.run(OPERATOR, { sourceSessionId: session.sessionId }),
      StateTransitionError,
    );
    await h.manager.completeSession(OPERATOR, session.sessionId);
    const r = await h.run(OPERATOR, { sourceSessionId: session.sessionId });
    assert.equal(r.status, "passed", why(r));
    assert.equal(r.changeSetId, created.changeSetId);
    const cs = await h.manager.getChangeSet(OPERATOR, session.sessionId);
    assert.equal(cs!.status, "verified");
    const log = git(h.repoA, "log", "--oneline");
    assert.equal(log.trim().split("\n").length, 1, "no commit was created");
    assert.match(git(h.repoA, "status", "--porcelain"), /src\/extra\.js/);
  } finally {
    h.cleanup();
  }
});

test("96 STALE PLAN + NO PROFILE: a superseded revision or missing profile blocks — nothing runs", async () => {
  const h = await harness();
  try {
    const r = await h.run();
    assert.equal(r.status, "blocked");
    assert.equal(r.reasons[0]!.code, "NO_PROFILE");
    h.profile({ "build:web": req("node.build") });
    const old = h.plans.alpha;
    h.fixture.agents.register(agent("web-agent-2", ["web_development"]));
    await h.fixture.planning.replan(old.planId, { id: "op-1" });
    const stale = await h.verification.start(
      OPERATOR,
      { projectId: "alpha", planId: old.planId, planVersion: old.version },
      "stale-1",
    );
    const done = await h.verification.wait(OPERATOR, stale.verificationId);
    assert.equal(done.status, "blocked", why(done));
    assert.equal(done.reasons[0]!.code, "STALE_PLAN");
    assert.ok(done.stages.every((s) => s.sessionIds.length === 0));
  } finally {
    h.cleanup();
  }
});

test("97 AUTHZ + ISOLATION: viewers cannot start, other projects are 404, history is scoped", async () => {
  const h = await harness();
  try {
    h.profile({ "build:web": req("node.build") });
    h.profile({ "build:web": req("node.build") }, {}, "beta");
    const plan = h.plans.alpha;
    await assert.rejects(
      h.verification.start(
        VIEWER,
        { projectId: "alpha", planId: plan.planId, planVersion: plan.version },
        "v1",
      ),
      PermissionDeniedError,
    );
    await assert.rejects(
      h.verification.start(
        BETA_OPERATOR,
        { projectId: "alpha", planId: plan.planId, planVersion: plan.version },
        "v2",
      ),
      NotFoundError,
    );
    await assert.rejects(
      h.verification.start(
        OPERATOR,
        {
          projectId: "alpha",
          planId: plan.planId,
          planVersion: plan.version,
          command: "npm run x",
        },
        "v3",
      ),
      ValidationError,
    );
    const r = await h.run();
    assert.throws(
      () => h.verification.get(BETA_OPERATOR, r.verificationId),
      NotFoundError,
    );
    assert.equal(h.verification.get(VIEWER, r.verificationId).status, "passed");
    assert.equal(h.verification.history(BETA_OPERATOR, "beta").length, 0);
    assert.equal(h.verification.history(OPERATOR, "alpha").length, 1);
  } finally {
    h.cleanup();
  }
});

test("98 IMMUTABILITY + IDEMPOTENCY + CONCURRENCY: results are frozen; keys replay; one run per project", async () => {
  const h = await harness();
  try {
    h.profile({
      "build:web": req("node.build"),
      "test:web:unit": req("node.slow.long"),
    });
    const plan = h.plans.alpha;
    const body = {
      projectId: "alpha",
      planId: plan.planId,
      planVersion: plan.version,
    };
    const a = await h.verification.start(OPERATOR, body, "same");
    const again = await h.verification.start(OPERATOR, body, "same");
    assert.equal(again.verificationId, a.verificationId);
    await assert.rejects(
      h.verification.start(OPERATOR, body, "other"),
      StateTransitionError,
    );
    await h.verification.cancel(OPERATOR, a.verificationId, "done");
    const r = await h.verification.wait(OPERATOR, a.verificationId);
    assert.ok(
      Object.isFrozen(r) &&
        Object.isFrozen(r.stages) &&
        Object.isFrozen(r.stages[0]),
    );
    assert.throws(() => {
      (r as { status: string }).status = "passed";
    }, TypeError);
  } finally {
    h.cleanup();
  }
});

test("99 NO TERMINAL: build tools refuse shells, eval and install/publish/deploy arguments", () => {
  for (const executableId of [
    "bash",
    "sh",
    "powershell",
    "pwsh",
    "cmd",
    "npx",
  ]) {
    assert.throws(
      () =>
        defineBuildTool({
          toolId: "t",
          executableId,
          requiredToolchains: [],
          commands: [
            {
              operationId: "x",
              stageKind: "build",
              description: "x",
              argv: ["a"],
            },
          ],
        }),
      ValidationError,
      executableId,
    );
  }
  for (const argv of [
    ["install"],
    ["ci"],
    ["-e", "1"],
    ["publish"],
    ["deploy"],
    ["push"],
    ["exec", "x"],
  ]) {
    assert.throws(
      () =>
        defineBuildTool({
          toolId: "t",
          executableId: "npm",
          requiredToolchains: [],
          commands: [
            { operationId: "x", stageKind: "build", description: "x", argv },
          ],
        }),
      ValidationError,
      argv.join(" "),
    );
  }
  // No operation accepts input that could reach argv.
  for (const op of NODE_TOOL.operations) assert.deepEqual(op.input, {});
  // The verification surface exposes no command-like entry points.
  const surface = Object.getOwnPropertyNames(
    VerificationService.prototype,
  ).join(" ");
  assert.doesNotMatch(
    surface,
    /shell|runCommand|terminal|bash|powershell|exec|script/i,
  );
  for (const preset of Object.values(BUILD_PROFILE_PRESETS)) {
    const { operations } = defineBuildTool(preset);
    for (const op of operations)
      assert.equal(op.executionClass, "project_code");
  }
});
