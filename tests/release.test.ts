/**
 * EO-4.6 — governed source control & deployment orchestration.
 *
 * ISOLATED ONLY: every repository is a temporary git repository with a
 * temporary BARE "remote" on disk; the deployment adapter is a TEST-ONLY
 * double (`simulated: true`). Nothing touches the AI Workforce repository,
 * GitHub or Firebase. Credentials are fixtures.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GovernedGitAdapter,
  WorkspaceBuildRunner,
  WorkspaceRepositorySandbox,
  resolveTrustedExecutable,
} from "../adapters/index.js";
import {
  ExecutionDeniedError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
  type DeploymentAdapter,
  type DeploymentContext,
  type ExecutionRecordStore,
  type ExecutionPolicy,
  type ReleasePolicy,
  type RepositoryPolicy,
  type TargetClassRequirements,
} from "../contracts/index.js";
import {
  ArtifactManager,
  BASELINE_DENY_ALL_POLICY,
  BoundedInvocationDispatcher,
  DeploymentOrchestrator,
  ExecutionManager,
  ExecutionOperationRegistry,
  ExecutionPolicyRegistry,
  ExecutionToolRegistry,
  InMemoryExecutionReceiptStore,
  InMemoryExecutionRecordStore,
  InMemoryExecutionSessionStore,
  PermissionSystem,
  SandboxRegistry,
  SourceControlOrchestrator,
  ToolExecutionEngine,
  ToolRegistry,
  VerificationService,
  toPostDeployVerification,
  verifyProduction,
  WORKSPACE_OPERATIONS,
  WORKSPACE_TOOL,
  defineBuildTool,
  registerExecutionTool,
} from "../core/index.js";
import { ADMIN, BETA_OPERATOR, OPERATOR, VIEWER } from "./fixtures/execution.js";
import {
  AgentOperationalStore,
  GraphQueryService,
  WorkflowControlStore,
  WorkforceCommandService,
  type ControlPlaneContext,
} from "../control/index.js";
import { ProjectRegistry, TaskSystem, WorkflowSystem } from "../core/index.js";
import {
  WEB_AGENT,
  WEB_HOST,
  WEB_INSTANCE,
  planningFixture,
  webRequest,
} from "./fixtures/planning.js";

const GIT = resolveTrustedExecutable("git")!;
const TOKEN = "ghp_FixtureToken0123456789abcdefABCDEF01";
const DEPLOY_SECRET = "fixture-deploy-credential-7f3e9a";

function git(cwd: string, ...args: string[]) {
  return execFileSync(
    GIT,
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=t@example.test",
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

const PROJECT: Record<string, string> = {
  "package.json": '{ "type": "module" }\n',
  ".gitignore": "dist/\n",
  "README.md": "# Alpha\n",
  "notes.txt": "notes\n",
  "src/app.js": "export const answer = () => 42;\n",
  "build.js":
    'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";\nmkdirSync("dist", { recursive: true });\nwriteFileSync("dist/out.js", readFileSync("src/app.js", "utf8"));\n',
  "test/app.test.js":
    'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { answer } from "../src/app.js";\ntest("answer", () => assert.equal(answer(), 42));\n',
};

const NODE = defineBuildTool({
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
      operationId: "node.test",
      stageKind: "test",
      description: "Tests",
      argv: ["--test", "test/app.test.js"],
    },
  ],
});

/** TEST-ONLY deployment adapter: deterministic, in memory, simulated. */
class FakeDeploymentAdapter implements DeploymentAdapter {
  readonly adapterId = "test-static-hosting";
  readonly version = "0.0.0-test";
  readonly simulated = true;
  fail = false;
  reachable = true;
  reportVersion?: string;
  hangMs = 0;
  live?: string;
  releases = 0;
  readonly rollbacks: string[] = [];
  readonly credentials: (string | undefined)[] = [];
  async deploy(ctx: DeploymentContext) {
    this.credentials.push(ctx.credential);
    if (this.hangMs) await new Promise((r) => setTimeout(r, this.hangMs));
    if (this.fail) throw new Error("provider failure");
    this.live = ctx.candidate.commitSha;
    return { providerReleaseId: `prov-${++this.releases}` };
  }
  async verify() {
    return {
      reachable: this.reachable,
      ...(this.live || this.reportVersion
        ? { reportedVersion: this.reportVersion ?? this.live }
        : {}),
      detail: "fake health",
    };
  }
  async rollback(_ctx: DeploymentContext, to: string) {
    this.rollbacks.push(to);
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

async function harness(
  options: {
    protectedMain?: boolean;
    requireReview?: boolean;
    /** EO-4.8 durable release records (restart simulation). */
    store?: ExecutionRecordStore;
  } = {},
) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "aiw-eo46-"));
  const remote = path.join(tmp, "remote.git");
  mkdirSync(remote);
  git(remote, "init", "-q", "--bare", "-b", "main");
  const repo = path.join(tmp, "repo-a");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  for (const [rel, content] of Object.entries(PROJECT)) {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), content);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "initial");
  git(repo, "push", "-q", remote, "main:refs/heads/main");
  const state = path.join(tmp, "state");
  mkdirSync(state);
  const gitHome = path.join(tmp, "git-home");
  mkdirSync(gitHome);

  const fixture = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [WEB_AGENT],
  });
  const tools = new ToolRegistry(fixture.audit);
  const executionTools = new ExecutionToolRegistry();
  const dispatcher = new BoundedInvocationDispatcher();
  const scope = {
    allowedAgents: ["web-agent"],
    allowedProjects: ["alpha", "beta"],
    allowedEnvironments: ["local" as const],
  };
  const operations = new ExecutionOperationRegistry();
  for (const t of [WORKSPACE_TOOL, NODE.tool])
    registerExecutionTool(tools, executionTools, dispatcher, t, scope);
  [...WORKSPACE_OPERATIONS, ...NODE.operations].forEach((o) =>
    operations.register(o),
  );
  const policy: ExecutionPolicy = {
    policyId: "release",
    version: 1,
    description: "EO-4.6 test policy.",
    rules: [
      {
        id: "build",
        operationIds: NODE.operations.map((o) => o.id),
        capabilities: [
          "filesystem.read",
          "filesystem.write.workspace",
          "build.invoke",
          "test.invoke",
        ],
        filesystem: [{ access: "write", path: "." }],
        requiredEnvironmentCapabilities: [],
        trustedHostBuild: true,
      },
      {
        id: "dev",
        operationIds: [
          "workspace.file.create",
          "workspace.file.update",
          "workspace.file.read",
        ],
        capabilities: ["filesystem.read", "filesystem.write.workspace"],
        filesystem: [{ access: "write", path: "." }],
        requiredEnvironmentCapabilities: [],
      },
    ],
    forbiddenCapabilities: ["repository.push", "deploy.invoke"],
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
  policies.bindProject("alpha", "release", 1);
  const workspace = new WorkspaceRepositorySandbox({
    repositories: [
      { repositoryId: "repo-alpha", projectId: "alpha", localPath: repo },
    ],
    environmentInstanceIds: ["web-1"],
    gitPath: GIT,
    stateRoot: state,
  });
  const runner = new WorkspaceBuildRunner({
    workspace,
    executables: { node: process.execPath },
    environmentInstanceIds: ["web-1"],
  });
  const sandboxes = new SandboxRegistry();
  sandboxes.register(workspace);
  sandboxes.register(runner);
  let seq = 0;
  const idFactory = (p: string) => `${p}_${++seq}`;
  const projects = { has: (id: string) => id === "alpha" || id === "beta" };
  const manager = new ExecutionManager({
    planning: fixture.planning,
    approvals: fixture.approvals,
    agents: fixture.agents,
    environments: fixture.registry,
    tools,
    projects,
    operations,
    policies,
    sandboxes,
    sessions: new InMemoryExecutionSessionStore(),
    audit: fixture.audit,
    clock: () => new Date().toISOString(),
    idFactory,
    executionTools,
    toolEngine: new ToolExecutionEngine({
      registry: tools,
      permissions: new PermissionSystem([
        { effect: "allow", action: "execute" },
      ]),
      audit: fixture.audit,
    }),
    dispatcher,
    receipts: new InMemoryExecutionReceiptStore(),
    workspaceControl: workspace,
  });
  const artifacts = new ArtifactManager({
    source: workspace,
    maxArtifactBytes: 1_000_000,
    idFactory,
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
    idFactory,
  });
  verification.registerProfile({
    projectId: "alpha",
    stages: {
      "build:web": {
        operationId: "node.build",
        required: true,
        artifacts: [{ kind: "bundle", path: "dist/out.js" }],
      },
      "test:web:unit": { operationId: "node.test", required: true },
    },
    failFast: true,
    maxParallel: 1,
    requireAllPlannedStages: false,
  });
  const gitAdapter = new GovernedGitAdapter({
    gitPath: GIT,
    stateRoot: gitHome,
    repositories: [
      {
        projectId: "alpha",
        repositoryId: "repo-alpha",
        localPath: repo,
        remote: { remoteId: "origin-alpha", url: remote },
      },
    ],
  });
  const prs: { sourceBranch: string; targetBranch: string }[] = [];
  const credentialLookups: string[] = [];
  const deployAdapter = new FakeDeploymentAdapter();
  /** Builds the release services; called again to simulate a restart. */
  const buildReleaseServices = () => {
    const sc = new SourceControlOrchestrator({
      git: gitAdapter,
      verification,
      manager,
      workspaceControl: workspace,
      approvals: fixture.approvals,
      projects,
      audit: fixture.audit,
      credentials: {
        resolve: async (ref) => {
          credentialLookups.push(ref);
          return ref === "secret://deploy-alpha" ? DEPLOY_SECRET : TOKEN;
        },
      },
      pullRequests: {
        provider: "test-provider",
        create: async (input) => {
          prs.push(input);
          return { number: prs.length };
        },
      },
      idFactory,
      ...(options.store ? { store: options.store } : {}),
    });
    const repoPolicy: RepositoryPolicy = {
      projectId: "alpha",
      repositoryId: "repo-alpha",
      version: 1,
      branch: options.protectedMain
        ? {
            defaultBranch: "main",
            protectedBranches: ["main"],
            directPushBranches: [],
            workingBranchPrefix: "aiw/",
            pullRequestRequired: true,
          }
        : {
            defaultBranch: "main",
            protectedBranches: [],
            directPushBranches: ["main"],
            workingBranchPrefix: "aiw/",
            pullRequestRequired: false,
          },
      requireReview: options.requireReview ?? true,
      requireIndependentReview: true,
      requireCommitApproval: true,
      requirePushApproval: true,
      commitIdentity: {
        name: "AI Workforce Automation",
        email: "automation@aiworkforce.test",
      },
      credentialRef: "secret://github-alpha",
    };
    sc.setRepositoryPolicy(repoPolicy);

    const deploy = new DeploymentOrchestrator({
      sourceControl: sc,
      verification,
      artifacts,
      approvals: fixture.approvals,
      projects,
      audit: fixture.audit,
      credentials: { resolve: async () => DEPLOY_SECRET },
      idFactory,
      ...(options.store ? { store: options.store } : {}),
    });
    deploy.registerAdapter(deployAdapter);
    deploy.registerTarget({
      targetId: "alpha-preview",
      projectId: "alpha",
      targetClass: "preview",
      adapterId: deployAdapter.adapterId,
      resources: ["hosting"],
      providerRef: "alpha-preview-site",
      timeoutMs: 2_000,
    });
    deploy.registerTarget({
      targetId: "alpha-prod",
      projectId: "alpha",
      targetClass: "production",
      adapterId: deployAdapter.adapterId,
      resources: ["hosting"],
      providerRef: "alpha-prod-site",
      credentialRef: "secret://deploy-alpha",
      timeoutMs: 2_000,
    });
    deploy.registerTarget({
      targetId: "beta-prod",
      projectId: "beta",
      targetClass: "production",
      adapterId: deployAdapter.adapterId,
      resources: ["hosting"],
      providerRef: "beta-site",
      timeoutMs: 2_000,
    });
    const releasePolicy: ReleasePolicy = {
      projectId: "alpha",
      version: 1,
      targets: {
        development: GATES(),
        preview: GATES(),
        staging: GATES({ requireReview: true }),
        production: GATES({
          requireReview: true,
          requireApproval: true,
          requireRollbackPlan: true,
          requireRollbackApproval: true,
        }),
      },
    };
    deploy.setReleasePolicy(releasePolicy);
    return { sc, deploy, repoPolicy, releasePolicy };
  };
  const { sc, deploy, repoPolicy, releasePolicy } = buildReleaseServices();

  const plan = await fixture.planning.createPlan(webRequest("alpha"), {
    id: "op-1",
  });
  let keys = 0;
  const approve = (approvalId: string) =>
    fixture.approvals.decide(approvalId, "approved", "admin-2");

  /** Developer session writes two files; ChangeSet → verification. */
  const developAndVerify = async (extraBeforeVerify?: () => void) => {
    const { session } = await manager.createSession(
      OPERATOR,
      {
        projectId: "alpha",
        planId: plan.planId,
        planVersion: plan.version,
        stageId: "build:web",
        operationId: "workspace.file.create",
        operationIds: ["workspace.file.update", "workspace.file.read"],
      },
      `dev-${++keys}`,
    );
    const inv = (operationId: string, input: Record<string, string>) =>
      manager.invoke(OPERATOR, {
        sessionId: session.sessionId,
        invocationId: `inv-${++keys}`,
        toolId: "workspace",
        operationId,
        input,
      });
    const a = await inv("workspace.file.create", {
      path: "src/feature.js",
      content: "export const feature = true;\n",
    });
    assert.equal(a.exitClass, "success", JSON.stringify(a.reasons));
    const { createHash } = await import("node:crypto");
    const b = await inv("workspace.file.update", {
      path: "README.md",
      content: "# Alpha\n\nWith feature.\n",
      expectedHash: createHash("sha256").update("# Alpha\n").digest("hex"),
    });
    assert.equal(b.exitClass, "success", JSON.stringify(b.reasons));
    await manager.completeSession(OPERATOR, session.sessionId);
    extraBeforeVerify?.();
    const started = await verification.start(
      OPERATOR,
      {
        projectId: "alpha",
        planId: plan.planId,
        planVersion: plan.version,
        sourceSessionId: session.sessionId,
      },
      `ver-${++keys}`,
    );
    const result = await verification.wait(OPERATOR, started.verificationId);
    assert.equal(result.status, "passed", JSON.stringify(result.reasons));
    return { session, verification: result };
  };

  /** Full happy path to a pushed commit. */
  const toPushed = async () => {
    const { verification: v } = await developAndVerify();
    const review = await sc.recordAgentReview(ADMIN, {
      projectId: "alpha",
      verificationId: v.verificationId,
      reviewerAgentId: "review-agent",
      status: "approved",
      summary: "Looks correct",
    });
    const stage = await sc.prepareStageSet(ADMIN, {
      projectId: "alpha",
      verificationId: v.verificationId,
      reviewId: review.reviewId,
    });
    const ca = await sc.requestApproval(ADMIN, {
      projectId: "alpha",
      operation: "commit",
      subjectId: stage.stageSetId,
      reason: "ship feature",
    });
    approve(ca.id);
    const commit = await sc.commit(
      ADMIN,
      {
        projectId: "alpha",
        stageSetId: stage.stageSetId,
        summary: "add feature flag",
        approvalId: ca.id,
      },
      `c-${++keys}`,
    );
    const pa = await sc.requestApproval(ADMIN, {
      projectId: "alpha",
      operation: "push",
      subjectId: commit.receiptId,
      reason: "publish commit",
    });
    approve(pa.id);
    const push = await sc.push(
      ADMIN,
      {
        projectId: "alpha",
        commitReceiptId: commit.receiptId,
        approvalId: pa.id,
      },
      `p-${++keys}`,
    );
    return { verification: v, review, stage, commit, push };
  };

  return {
    tmp,
    repo,
    remote,
    fixture,
    manager,
    workspace,
    verification,
    artifacts,
    sc,
    deploy,
    deployAdapter,
    plan,
    prs,
    credentialLookups,
    approve,
    developAndVerify,
    toPushed,
    repoPolicy,
    releasePolicy,
    restart: buildReleaseServices,
    nextKey: () => `k-${++keys}`,
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

const denied = (code: string) => (e: unknown) =>
  e instanceof ExecutionDeniedError && e.code === code;
const remoteHead = (remote: string, branch = "main") =>
  git(remote, "rev-parse", `refs/heads/${branch}`).trim();

test("EO-4.6 79/84/86 VERIFIED + REVIEWED: bounded stage set, commit with receipt; unrelated/pre-existing changes untouched", async () => {
  const h = await harness();
  try {
    writeFileSync(path.join(h.repo, "notes.txt"), "user edit in progress\n"); // pre-existing, unrelated
    const { verification: v } = await h.developAndVerify();
    const review = await h.sc.recordAgentReview(ADMIN, {
      projectId: "alpha",
      verificationId: v.verificationId,
      reviewerAgentId: "review-agent",
      status: "approved",
    });
    const stage = await h.sc.prepareStageSet(ADMIN, {
      projectId: "alpha",
      verificationId: v.verificationId,
      reviewId: review.reviewId,
    });
    assert.deepEqual(
      stage.files.map((f) => f.path),
      ["README.md", "src/feature.js"],
    );
    assert.equal(stage.sourceFingerprint, v.sourceFingerprint);
    const approval = await h.sc.requestApproval(ADMIN, {
      projectId: "alpha",
      operation: "commit",
      subjectId: stage.stageSetId,
      reason: "ship",
    });
    h.approve(approval.id);
    const commit = await h.sc.commit(
      ADMIN,
      {
        projectId: "alpha",
        stageSetId: stage.stageSetId,
        summary: "add feature flag",
        approvalId: approval.id,
      },
      "c1",
    );
    assert.match(commit.commitSha, /^[0-9a-f]{40}$/);
    assert.equal(git(h.repo, "rev-parse", "HEAD").trim(), commit.commitSha);
    const files = git(
      h.repo,
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      commit.commitSha,
    )
      .trim()
      .split(/\r?\n/)
      .sort();
    assert.deepEqual(
      files,
      ["README.md", "src/feature.js"],
      "exactly the ChangeSet",
    );
    assert.match(
      git(h.repo, "status", "--porcelain"),
      /notes\.txt/,
      "unrelated change is still uncommitted",
    );
    assert.match(
      commit.message,
      /^feat: add feature flag\n\nAI-Workforce-Project: alpha/,
    );
    assert.match(
      commit.message,
      new RegExp(`AI-Workforce-ChangeSet: ${stage.changeSetId}`),
    );
    assert.equal(
      git(h.repo, "log", "-1", "--format=%an <%ae>").trim(),
      "AI Workforce Automation <automation@aiworkforce.test>",
    );
    assert.deepEqual(
      [commit.verificationId, commit.reviewId, commit.approvalIds[0]],
      [v.verificationId, review.reviewId, approval.id],
    );
  } finally {
    h.cleanup();
  }
});

test("EO-4.6 80/82 UNVERIFIED or UNREVIEWED ChangeSet: stage/commit DENIED", async () => {
  const h = await harness();
  try {
    const { verification: v } = await h.developAndVerify();
    await assert.rejects(
      h.sc.prepareStageSet(ADMIN, {
        projectId: "alpha",
        verificationId: v.verificationId,
      }),
      denied("REVIEW_REQUIRED"),
    );
    const changes = await h.sc.recordAgentReview(ADMIN, {
      projectId: "alpha",
      verificationId: v.verificationId,
      reviewerAgentId: "review-agent",
      status: "changes_requested",
    });
    await assert.rejects(
      h.sc.prepareStageSet(ADMIN, {
        projectId: "alpha",
        verificationId: v.verificationId,
        reviewId: changes.reviewId,
      }),
      denied("REVIEW_REQUIRED"),
    );
    await assert.rejects(
      h.sc.prepareStageSet(ADMIN, {
        projectId: "alpha",
        verificationId: "vrf_unknown",
      }),
      NotFoundError,
    );
  } finally {
    h.cleanup();
  }
});

test("EO-4.6 81 SOURCE CHANGED after verification: REVERIFICATION_REQUIRED at stage and at commit", async () => {
  const h = await harness();
  try {
    const { verification: v } = await h.developAndVerify();
    const review = await h.sc.recordAgentReview(ADMIN, {
      projectId: "alpha",
      verificationId: v.verificationId,
      reviewerAgentId: "review-agent",
      status: "approved",
    });
    const stage = await h.sc.prepareStageSet(ADMIN, {
      projectId: "alpha",
      verificationId: v.verificationId,
      reviewId: review.reviewId,
    });
    writeFileSync(
      path.join(h.repo, "src", "feature.js"),
      "export const feature = false; // changed after verify\n",
    );
    const approval = await h.sc.requestApproval(ADMIN, {
      projectId: "alpha",
      operation: "commit",
      subjectId: stage.stageSetId,
      reason: "ship",
    });
    h.approve(approval.id);
    await assert.rejects(
      h.sc.commit(
        ADMIN,
        {
          projectId: "alpha",
          stageSetId: stage.stageSetId,
          summary: "add feature",
          approvalId: approval.id,
        },
        "c1",
      ),
      denied("REVERIFICATION_REQUIRED"),
    );
    await assert.rejects(
      h.sc.prepareStageSet(ADMIN, {
        projectId: "alpha",
        verificationId: v.verificationId,
        reviewId: review.reviewId,
      }),
      denied("REVERIFICATION_REQUIRED"),
    );
    assert.equal(
      git(h.repo, "rev-list", "--count", "HEAD").trim(),
      "1",
      "nothing committed",
    );
  } finally {
    h.cleanup();
  }
});

test("EO-4.6 83 SELF REVIEW: the author (agent or requesting operator) cannot review", async () => {
  const h = await harness();
  try {
    const { verification: v } = await h.developAndVerify();
    await assert.rejects(
      h.sc.recordAgentReview(ADMIN, {
        projectId: "alpha",
        verificationId: v.verificationId,
        reviewerAgentId: "web-agent",
        status: "approved",
      }),
      denied("REVIEW_NOT_INDEPENDENT"),
    );
    await assert.rejects(
      h.sc.submitReview(OPERATOR, {
        projectId: "alpha",
        verificationId: v.verificationId,
        status: "approved",
      }),
      denied("REVIEW_NOT_INDEPENDENT"),
    );
    const independent = await h.sc.submitReview(ADMIN, {
      projectId: "alpha",
      verificationId: v.verificationId,
      status: "approved",
      summary: "Independent",
    });
    assert.equal(independent.reviewerKind, "operator");
  } finally {
    h.cleanup();
  }
});

test("EO-4.6 85 SECRET FILE in the workspace is never staged or committed", async () => {
  const h = await harness();
  try {
    // The secret appears in the working tree BEFORE staging/commit/push.
    writeFileSync(
      path.join(h.repo, ".env.local"),
      "API_KEY=sk-live-abcdefghijklmnop1234\n",
    );
    const { commit, stage } = await h.toPushed();
    assert.ok(!stage.files.some((f) => f.path.includes(".env")));
    assert.match(
      git(h.repo, "status", "--porcelain", "--untracked-files=all"),
      /\.env\.local/,
      "still untracked",
    );
    const tracked = git(h.repo, "ls-files").split(/\r?\n/);
    assert.ok(!tracked.includes(".env.local"));
    assert.ok(
      !git(h.repo, "show", "--stat", commit.commitSha).includes(".env"),
    );
  } finally {
    h.cleanup();
  }
});

test("EO-4.6 87/88/89 NO RAW GIT, NO FORCE PUSH, NO ARBITRARY REMOTE: extra fields are refused", async () => {
  const h = await harness();
  try {
    const { commit } = await h.toPushed();
    for (const extra of [
      { args: ["reset", "--hard"] },
      { command: "git push --force" },
      { force: true },
      { remoteUrl: "https://github.com/evil/repo.git" },
      { branch: "main" },
      { refspec: "+HEAD:main" },
    ]) {
      await assert.rejects(
        h.sc.push(
          ADMIN,
          { projectId: "alpha", commitReceiptId: commit.receiptId, ...extra },
          h.nextKey(),
        ),
        ValidationError,
        JSON.stringify(extra),
      );
    }
    await assert.rejects(
      h.sc.commit(
        ADMIN,
        {
          projectId: "alpha",
          stageSetId: "x",
          summary: "s",
          args: ["--amend"],
        },
        h.nextKey(),
      ),
      ValidationError,
    );
    const surface = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(h.sc)),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(h.deploy)),
    ].join(" ");
    assert.doesNotMatch(surface, /exec|shell|raw|force|runGit|command/i);
    // A project without a governed repository cannot be pushed to.
    await assert.rejects(
      h.sc.push(
        BETA_OPERATOR,
        { projectId: "beta", commitReceiptId: commit.receiptId },
        h.nextKey(),
      ),
      PermissionDeniedError,
    );
  } finally {
    h.cleanup();
  }
});

test("EO-4.6 91/92/93 PUSH: commit exists unpushed until an approved push; push ≠ deploy", async () => {
  const h = await harness();
  try {
    const before = remoteHead(h.remote);
    const { verification: v } = await h.developAndVerify();
    const review = await h.sc.recordAgentReview(ADMIN, {
      projectId: "alpha",
      verificationId: v.verificationId,
      reviewerAgentId: "review-agent",
      status: "approved",
    });
    const stage = await h.sc.prepareStageSet(ADMIN, {
      projectId: "alpha",
      verificationId: v.verificationId,
      reviewId: review.reviewId,
    });
    const ca = await h.sc.requestApproval(ADMIN, {
      projectId: "alpha",
      operation: "commit",
      subjectId: stage.stageSetId,
      reason: "ship",
    });
    h.approve(ca.id);
    const commit = await h.sc.commit(
      ADMIN,
      {
        projectId: "alpha",
        stageSetId: stage.stageSetId,
        summary: "add feature",
        approvalId: ca.id,
      },
      "c1",
    );
    assert.equal(remoteHead(h.remote), before, "COMMITTED, not PUSHED");
    await assert.rejects(
      h.sc.push(
        ADMIN,
        { projectId: "alpha", commitReceiptId: commit.receiptId },
        "p0",
      ),
      denied("APPROVAL_REQUIRED"),
    );
    // An approval for the COMMIT does not authorize the PUSH.
    await assert.rejects(
      h.sc.push(
        ADMIN,
        {
          projectId: "alpha",
          commitReceiptId: commit.receiptId,
          approvalId: ca.id,
        },
        "p1",
      ),
      denied("APPROVAL_REQUIRED"),
    );
    const pa = await h.sc.requestApproval(ADMIN, {
      projectId: "alpha",
      operation: "push",
      subjectId: commit.receiptId,
      reason: "publish",
    });
    h.approve(pa.id);
    const push = await h.sc.push(
      ADMIN,
      {
        projectId: "alpha",
        commitReceiptId: commit.receiptId,
        approvalId: pa.id,
      },
      "p2",
    );
    assert.deepEqual(
      [push.result, push.branch, push.commitSha, push.expectedRemoteSha],
      ["pushed", "main", commit.commitSha, before],
    );
    assert.equal(remoteHead(h.remote), commit.commitSha);
    // Idempotent: the same key replays, no second mutation.
    assert.equal(
      (
        await h.sc.push(
          ADMIN,
          {
            projectId: "alpha",
            commitReceiptId: commit.receiptId,
            approvalId: pa.id,
          },
          "p2",
        )
      ).receiptId,
      push.receiptId,
    );
    assert.equal(
      (await h.deploy.listReleases(ADMIN, "alpha")).length,
      0,
      "PUSHED ≠ DEPLOYED",
    );
    assert.equal(h.deployAdapter.releases, 0);
  } finally {
    h.cleanup();
  }
});

test("EO-4.6 90 REMOTE CHANGED: push blocked, nothing overwritten", async () => {
  const h = await harness();
  try {
    const { verification: v } = await h.developAndVerify();
    const review = await h.sc.recordAgentReview(ADMIN, {
      projectId: "alpha",
      verificationId: v.verificationId,
      reviewerAgentId: "review-agent",
      status: "approved",
    });
    const stage = await h.sc.prepareStageSet(ADMIN, {
      projectId: "alpha",
      verificationId: v.verificationId,
      reviewId: review.reviewId,
    });
    const ca = await h.sc.requestApproval(ADMIN, {
      projectId: "alpha",
      operation: "commit",
      subjectId: stage.stageSetId,
      reason: "ship",
    });
    h.approve(ca.id);
    const commit = await h.sc.commit(
      ADMIN,
      {
        projectId: "alpha",
        stageSetId: stage.stageSetId,
        summary: "add feature",
        approvalId: ca.id,
      },
      "c1",
    );
    // Someone else pushes to the remote meanwhile.
    const other = path.join(h.tmp, "other");
    git(h.tmp, "clone", "-q", h.remote, other);
    writeFileSync(path.join(other, "other.txt"), "concurrent\n");
    git(other, "add", "-A");
    git(other, "commit", "-q", "-m", "concurrent change");
    git(other, "push", "-q", "origin", "main");
    const theirs = remoteHead(h.remote);
    const pa = await h.sc.requestApproval(ADMIN, {
      projectId: "alpha",
      operation: "push",
      subjectId: commit.receiptId,
      reason: "publish",
    });
    h.approve(pa.id);
    await assert.rejects(
      h.sc.push(
        ADMIN,
        {
          projectId: "alpha",
          commitReceiptId: commit.receiptId,
          approvalId: pa.id,
        },
        "p1",
      ),
      denied("REMOTE_CHANGED"),
    );
    assert.equal(
      remoteHead(h.remote),
      theirs,
      "the remote change was not overwritten",
    );
  } finally {
    h.cleanup();
  }
});

test("EO-4.6 26/35 PROTECTED MAIN: pushes to a working branch and opens a PR; main untouched", async () => {
  const h = await harness({ protectedMain: true });
  try {
    const before = remoteHead(h.remote);
    const { push, stage } = await h.toPushed();
    assert.equal(push.branch, `aiw/${stage.changeSetId}`);
    assert.equal(push.pullRequestRequired, true);
    assert.equal(remoteHead(h.remote), before, "protected main unchanged");
    assert.equal(remoteHead(h.remote, push.branch), push.commitSha);
    assert.deepEqual(
      h.prs.map((p) => [p.sourceBranch, p.targetBranch]),
      [[push.branch, "main"]],
    );
    const activity = await h.sc.activity(ADMIN, "alpha");
    assert.equal(
      activity.pullRequests[0]!.checks,
      "unknown",
      "remote CI is never assumed",
    );
  } finally {
    h.cleanup();
  }
});

test("EO-4.6 94/99 DEPLOYMENT CANDIDATE → preview deploy → verify → HEALTHY release receipt (test adapter)", async () => {
  const h = await harness();
  try {
    const { push, verification: v } = await h.toPushed();
    const candidate = await h.deploy.createCandidate(ADMIN, {
      projectId: "alpha",
      pushReceiptId: push.receiptId,
      targetId: "alpha-preview",
      artifactIds: [...v.artifactIds],
    });
    assert.deepEqual(
      [
        candidate.commitSha,
        candidate.sourceFingerprint,
        candidate.verificationId,
      ],
      [push.commitSha, v.sourceFingerprint, v.verificationId],
    );
    assert.equal(candidate.artifacts.length, 1);
    assert.match(candidate.artifacts[0]!.sha256, /^[0-9a-f]{64}$/);
    const release = await h.deploy.deploy(
      ADMIN,
      { projectId: "alpha", candidateId: candidate.candidateId },
      "d1",
    );
    assert.equal(release.status, "healthy", JSON.stringify(release.reasons));
    assert.equal(release.postDeploy!.versionMatches, true);
    assert.equal(release.simulated, true, "test-only adapter is labelled");
    assert.equal(release.releasePolicyVersion, 1);
    const actions = h.fixture.audit
      .query({ type: "execution_event" })
      .map((e) => e.data.action);
    for (const a of [
      "review_recorded",
      "stage_set_created",
      "commit_requested",
      "commit_completed",
      "push_requested",
      "push_completed",
      "deployment_candidate_created",
      "deployment_started",
      "deployment_completed",
      "post_deploy_verification",
      "deployment_healthy",
    ]) {
      assert.ok(actions.includes(a), a);
    }
  } finally {
    h.cleanup();
  }
});

test("EO-4.6 95/96/97/98 STALE candidate, WRONG target, PRODUCTION approval, preview vs production", async () => {
  const h = await harness();
  try {
    const { push } = await h.toPushed();
    await assert.rejects(
      h.deploy.createCandidate(ADMIN, {
        projectId: "alpha",
        pushReceiptId: push.receiptId,
        targetId: "beta-prod",
      }),
      denied("TARGET_NOT_REGISTERED"),
    );
    await assert.rejects(
      h.deploy.createCandidate(ADMIN, {
        projectId: "alpha",
        pushReceiptId: push.receiptId,
        targetId: "firebase:someone-elses-project",
      }),
      denied("TARGET_NOT_REGISTERED"),
    );
    await assert.rejects(
      h.deploy.createCandidate(ADMIN, {
        projectId: "alpha",
        pushReceiptId: push.receiptId,
        targetId: "alpha-prod",
        destination: "prod",
      }),
      ValidationError,
    );
    const prod = await h.deploy.createCandidate(ADMIN, {
      projectId: "alpha",
      pushReceiptId: push.receiptId,
      targetId: "alpha-prod",
    });
    await assert.rejects(
      h.deploy.deploy(
        ADMIN,
        { projectId: "alpha", candidateId: prod.candidateId },
        "d1",
      ),
      denied("APPROVAL_REQUIRED"),
    );
    // A push approval never authorizes production.
    const pushApproval = push.approvalIds[0]!;
    await assert.rejects(
      h.deploy.deploy(
        ADMIN,
        {
          projectId: "alpha",
          candidateId: prod.candidateId,
          approvalId: pushApproval,
        },
        "d2",
      ),
      denied("APPROVAL_REQUIRED"),
    );
    const preview = await h.deploy.createCandidate(ADMIN, {
      projectId: "alpha",
      pushReceiptId: push.receiptId,
      targetId: "alpha-preview",
    });
    assert.equal(
      (
        await h.deploy.deploy(
          ADMIN,
          { projectId: "alpha", candidateId: preview.candidateId },
          "d3",
        )
      ).status,
      "healthy",
      "preview needs no approval",
    );
    // Policy change → stale candidate.
    h.deploy.setReleasePolicy({ ...h.releasePolicy, version: 2 });
    await assert.rejects(
      h.deploy.deploy(
        ADMIN,
        { projectId: "alpha", candidateId: preview.candidateId },
        "d4",
      ),
      denied("STALE_CANDIDATE"),
    );
  } finally {
    h.cleanup();
  }
});

test("EO-4.6 100/101/102 DEPLOY FAILURE, HEALTH FAILURE, VERSION MISMATCH: never HEALTHY", async () => {
  const h = await harness();
  try {
    const { push } = await h.toPushed();
    const c = async () =>
      (
        await h.deploy.createCandidate(ADMIN, {
          projectId: "alpha",
          pushReceiptId: push.receiptId,
          targetId: "alpha-preview",
        })
      ).candidateId;
    h.deployAdapter.fail = true;
    assert.equal(
      (
        await h.deploy.deploy(
          ADMIN,
          { projectId: "alpha", candidateId: await c() },
          "f1",
        )
      ).status,
      "failed",
    );
    h.deployAdapter.fail = false;
    h.deployAdapter.reachable = false;
    const degraded = await h.deploy.deploy(
      ADMIN,
      { projectId: "alpha", candidateId: await c() },
      "f2",
    );
    assert.equal(degraded.status, "degraded");
    h.deployAdapter.reachable = true;
    h.deployAdapter.reportVersion = "0".repeat(40);
    const mismatch = await h.deploy.deploy(
      ADMIN,
      { projectId: "alpha", candidateId: await c() },
      "f3",
    );
    assert.equal(mismatch.status, "failed");
    assert.equal(mismatch.postDeploy!.versionMatches, false);
    h.deployAdapter.reportVersion = undefined;
    h.deployAdapter.hangMs = 3_000;
    const slow = await h.deploy.deploy(
      ADMIN,
      { projectId: "alpha", candidateId: await c() },
      "f4",
    );
    assert.equal(slow.status, "failed");
    assert.equal(slow.reasons[0]!.code, "TIMEOUT");
  } finally {
    h.cleanup();
  }
});

test("EO-4.6 103/110 ROLLBACK to a known healthy release (approved); concurrent production deploys are locked", async () => {
  const h = await harness();
  try {
    const { push } = await h.toPushed();
    const prodDeploy = async (key: string) => {
      const cand = await h.deploy.createCandidate(ADMIN, {
        projectId: "alpha",
        pushReceiptId: push.receiptId,
        targetId: "alpha-prod",
      });
      const a = await h.deploy.requestApproval(ADMIN, {
        projectId: "alpha",
        operation: "deploy",
        subjectId: cand.candidateId,
        reason: "release",
      });
      h.approve(a.id);
      return h.deploy.deploy(
        ADMIN,
        { projectId: "alpha", candidateId: cand.candidateId, approvalId: a.id },
        key,
      );
    };
    const good = await prodDeploy("r1");
    assert.equal(good.status, "healthy");
    assert.deepEqual(
      h.deployAdapter.credentials.at(-1),
      DEPLOY_SECRET,
      "credential resolved server-side for the adapter",
    );
    // Concurrency: two production deploys to the same target.
    h.deployAdapter.hangMs = 200;
    const [x, y] = await Promise.allSettled([
      prodDeploy("r2"),
      prodDeploy("r3"),
    ]);
    const outcomes = [x, y]
      .map((o) =>
        o.status === "fulfilled"
          ? "ok"
          : (o.reason as ExecutionDeniedError).code,
      )
      .sort();
    assert.deepEqual(outcomes, ["DEPLOYMENT_LOCKED", "ok"]);
    h.deployAdapter.hangMs = 0;
    h.deployAdapter.reachable = false;
    const bad = await prodDeploy("r4");
    assert.equal(bad.status, "degraded");
    await assert.rejects(
      h.deploy.rollback(ADMIN, {
        projectId: "alpha",
        releaseId: bad.releaseId,
      }),
      denied("APPROVAL_REQUIRED"),
    );
    const ra = await h.deploy.requestApproval(ADMIN, {
      projectId: "alpha",
      operation: "rollback",
      subjectId: bad.releaseId,
      reason: "restore",
    });
    h.approve(ra.id);
    const rolled = await h.deploy.rollback(ADMIN, {
      projectId: "alpha",
      releaseId: bad.releaseId,
      approvalId: ra.id,
    });
    assert.equal(rolled.status, "rolled_back");
    assert.equal(rolled.rollback!.automatic, false);
    const target = (await h.deploy.listReleases(ADMIN, "alpha")).find(
      (r) => r.releaseId === rolled.rollback!.toReleaseId,
    )!;
    assert.equal(target.status, "healthy");
    assert.equal(
      h.deployAdapter.rollbacks.at(-1),
      target.providerReleaseId,
      "restores a KNOWN previous release, not 'latest'",
    );
  } finally {
    h.cleanup();
  }
});

test("EO-4.6 104/106 CROSS PROJECT + AUTHORIZATION: other project's objects are 404; operators cannot commit/push/deploy", async () => {
  const h = await harness();
  try {
    const { push, commit } = await h.toPushed();
    await assert.rejects(
      h.sc.push(
        OPERATOR,
        { projectId: "alpha", commitReceiptId: commit.receiptId },
        h.nextKey(),
      ),
      PermissionDeniedError,
    );
    await assert.rejects(
      h.deploy.createCandidate(OPERATOR, {
        projectId: "alpha",
        pushReceiptId: push.receiptId,
        targetId: "alpha-preview",
      }),
      PermissionDeniedError,
    );
    await assert.rejects(
      h.sc.getPushReceipt(BETA_OPERATOR, "alpha", push.receiptId),
      NotFoundError,
    );
    await assert.rejects(
      h.deploy.listReleases(BETA_OPERATOR, "alpha"),
      NotFoundError,
    );
    await assert.rejects(h.sc.activity(BETA_OPERATOR, "alpha"), NotFoundError);
  } finally {
    h.cleanup();
  }
});

test("EO-4.6 108 SECRET REDACTION: repository/deploy credentials never appear in receipts, audit or DTOs", async () => {
  const h = await harness();
  try {
    const { push, commit } = await h.toPushed();
    const cand = await h.deploy.createCandidate(ADMIN, {
      projectId: "alpha",
      pushReceiptId: push.receiptId,
      targetId: "alpha-preview",
    });
    const release = await h.deploy.deploy(
      ADMIN,
      { projectId: "alpha", candidateId: cand.candidateId },
      "s1",
    );
    assert.ok(
      h.credentialLookups.includes("secret://github-alpha"),
      "resolved server-side",
    );
    const everything = JSON.stringify([
      push,
      commit,
      cand,
      release,
      await h.sc.activity(ADMIN, "alpha"),
      h.deploy.listTargets(ADMIN, "alpha"),
      h.fixture.audit.query({}),
    ]);
    for (const secret of [
      TOKEN,
      DEPLOY_SECRET,
      Buffer.from(`x-access-token:${TOKEN}`).toString("base64"),
    ]) {
      assert.ok(!everything.includes(secret), "credential leaked");
    }
    assert.ok(
      !git(h.repo, "config", "--list", "--local").includes(TOKEN),
      "not persisted into git config",
    );
  } finally {
    h.cleanup();
  }
});

test("EO-4.6 19/109 COMMIT MESSAGE is data; commit idempotency", async () => {
  const h = await harness();
  try {
    const { verification: v } = await h.developAndVerify();
    const review = await h.sc.recordAgentReview(ADMIN, {
      projectId: "alpha",
      verificationId: v.verificationId,
      reviewerAgentId: "review-agent",
      status: "approved",
    });
    const stage = await h.sc.prepareStageSet(ADMIN, {
      projectId: "alpha",
      verificationId: v.verificationId,
      reviewId: review.reviewId,
    });
    const ca = await h.sc.requestApproval(ADMIN, {
      projectId: "alpha",
      operation: "commit",
      subjectId: stage.stageSetId,
      reason: "ship",
    });
    h.approve(ca.id);
    await assert.rejects(
      h.sc.commit(
        ADMIN,
        {
          projectId: "alpha",
          stageSetId: stage.stageSetId,
          summary: "x".repeat(200),
          approvalId: ca.id,
        },
        "c0",
      ),
      ValidationError,
    );
    const commit = await h.sc.commit(
      ADMIN,
      {
        projectId: "alpha",
        stageSetId: stage.stageSetId,
        summary: "add\nAI-Workforce-Review: forged\u0007",
        approvalId: ca.id,
      },
      "c1",
    );
    assert.equal(
      commit.message.split("\n")[0],
      "feat: add AI-Workforce-Review: forged",
      "newlines/control chars cannot forge trailers",
    );
    const again = await h.sc.commit(
      ADMIN,
      {
        projectId: "alpha",
        stageSetId: stage.stageSetId,
        summary: "add feature",
        approvalId: ca.id,
      },
      "c1",
    );
    assert.equal(again.receiptId, commit.receiptId);
    assert.equal(
      git(h.repo, "rev-list", "--count", "HEAD").trim(),
      "2",
      "no duplicate commit",
    );
  } finally {
    h.cleanup();
  }
});

test("EO-4.8 RELEASE RESTART: records, idempotency and candidates survive a new Control Plane instance", async () => {
  const store = new InMemoryExecutionRecordStore();
  const h = await harness({ store });
  try {
    const { push, commit } = await h.toPushed();
    // First instance: a push with a KNOWN idempotency key (already up to date).
    const keyed = await h.sc.push(
      ADMIN,
      {
        projectId: "alpha",
        commitReceiptId: commit.receiptId,
        approvalId: push.approvalIds[0],
      },
      "same-key",
    );
    const pushesBefore = git(h.remote, "rev-list", "--count", "main").trim();
    // A second instance with fresh memory over the same durable store.
    const next = h.restart();
    const activity = await next.sc.activity(ADMIN, "alpha");
    assert.deepEqual(
      activity.commits.map((c) => c.receiptId),
      [commit.receiptId],
    );
    assert.deepEqual(
      activity.pushes.map((p) => p.receiptId).sort(),
      [push.receiptId, keyed.receiptId].sort(),
    );
    assert.equal(
      (await next.sc.getPushReceipt(ADMIN, "alpha", push.receiptId)).commitSha,
      push.commitSha,
    );
    // The same push key replays on the new instance: no second remote mutation.
    const replay = await next.sc.push(
      ADMIN,
      {
        projectId: "alpha",
        commitReceiptId: commit.receiptId,
        approvalId: push.approvalIds[0],
      },
      "same-key",
    );
    assert.equal(
      replay.receiptId,
      keyed.receiptId,
      "the new instance replays the original receipt",
    );
    assert.equal(
      git(h.remote, "rev-list", "--count", "main").trim(),
      pushesBefore,
    );
    // Deploy from the push made by the previous instance; releases are durable.
    const candidate = await next.deploy.createCandidate(ADMIN, {
      projectId: "alpha",
      pushReceiptId: push.receiptId,
      targetId: "alpha-preview",
    });
    const release = await next.deploy.deploy(
      ADMIN,
      { projectId: "alpha", candidateId: candidate.candidateId },
      "d-restart",
    );
    assert.equal(release.status, "healthy");
    const third = h.restart();
    assert.deepEqual(
      (await third.deploy.listReleases(ADMIN, "alpha")).map((r) => [
        r.releaseId,
        r.status,
      ]),
      [[release.releaseId, "healthy"]],
    );
    assert.equal(
      (
        await third.deploy.deploy(
          ADMIN,
          { projectId: "alpha", candidateId: candidate.candidateId },
          "d-restart",
        )
      ).releaseId,
      release.releaseId,
      "deploy idempotency survives restarts",
    );
    // Re-committing the stage set is refused on any instance (the source
    // moved on with the commit; the create-only marker also guards it).
    await assert.rejects(
      third.sc.commit(
        ADMIN,
        { projectId: "alpha", stageSetId: commit.stageSetId, summary: "again" },
        "c-again",
      ),
      /already committed|verify it again/,
    );
  } finally {
    h.cleanup();
  }
});


/* ------------------------------------------------------------------ */
/* EO-5.8 end-to-end: the REAL pipeline (local Git, real orchestrators, */
/* test deploy adapter) observed through the graph and spatial         */
/* intelligence. Nothing here touches production or a real remote.     */
/* ------------------------------------------------------------------ */
test("EO-5.8 E2E: session → ChangeSet → verification → review → approval → commit → push → deployment → graph → insights → audit", async () => {
  const h = await harness();
  try {
    const tasks = new TaskSystem();
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
    // Lifecycle reads are shared for a few seconds per project (ADR-0023); the scenario moves an
    // injected clock forward between observations so each one sees the latest recorded state.
    let now = 1_000_000;
    const ctx = {
      clock: () => now,
      agents: h.fixture.agents,
      tasks,
      workflows: new WorkflowSystem(),
      approvals: h.fixture.approvals,
      permissions: new PermissionSystem([]),
      tools: new ToolRegistry(h.fixture.audit),
      projects,
      audit: h.fixture.audit,
      agentOps: new AgentOperationalStore(),
      workflowControl: new WorkflowControlStore(),
      environments: h.fixture.registry,
      execution: h.manager,
      verification: h.verification,
      sourceControl: h.sc,
      deployments: h.deploy,
    } as unknown as ControlPlaneContext;
    const gq = new GraphQueryService(ctx);
    // The unit-of-work the operator sees: one running task and one waiting on it (real TaskSystem).
    const upstream = tasks.create({ type: "ops", description: "Build the feature", projectId: "alpha" });
    tasks.create({ type: "ops", description: "Publish the feature", projectId: "alpha", dependencies: [upstream.id] });

    const graph = async () => (await gq.getWorkforceGraph(ADMIN, { projectId: "alpha", mode: "EXECUTION" }))!;
    const insights = async () => (await gq.getInsights(ADMIN, "alpha"))!;
    const observe = () => {
      now += 60_000;
    };
    const has = (g: Awaited<ReturnType<typeof graph>>, type: string) => g.nodes.some((n) => n.type === type);
    const edge = (g: Awaited<ReturnType<typeof graph>>, type: string, source: string, target: string) =>
      g.edges.some((e) => e.type === type && e.source === source && e.target === target);

    // Before anything ran: sparse and honest — no execution nodes are invented.
    const empty = await graph();
    for (const t of ["EXECUTION_SESSION", "CHANGESET", "VERIFICATION", "REVIEW", "COMMIT", "DEPLOYMENT", "APPROVAL"]) {
      assert.ok(!has(empty, t), `no ${t} before anything ran`);
    }

    // ---- the real pipeline, up to a pushed commit ----
    const { verification: v, review, stage, commit, push } = await h.toPushed();
    observe();
    const g1 = await graph();
    for (const t of ["EXECUTION_SESSION", "CHANGESET", "VERIFICATION", "REVIEW", "COMMIT", "APPROVAL"]) {
      assert.ok(has(g1, t), `${t} is projected from the real record`);
    }
    assert.ok(!has(g1, "DEPLOYMENT"), "COMMIT != DEPLOYMENT: nothing was deployed yet");
    // Correlation is by the records' own identifiers, not by any heuristic.
    const cs = `changeset-${commit.changeSetId}`;
    const sessionEdge = g1.edges.find((e) => e.type === "PRODUCES" && e.target === cs);
    assert.ok(sessionEdge, "session PRODUCES the ChangeSet");
    assert.ok(edge(g1, "VERIFIED_BY", cs, `verification-${v.verificationId}`));
    assert.ok(edge(g1, "REVIEWED_BY", cs, `review-${review.reviewId}`));
    assert.ok(edge(g1, "COMMITTED_AS", cs, `commit-${commit.receiptId}`));
    assert.ok(g1.edges.some((e) => e.type === "REQUIRES_APPROVAL" && e.source === `commit-${commit.receiptId}`), "the commit's approval is projected");
    assert.ok(!JSON.stringify(g1).includes("secret://"), "no credential reference reaches the graph");
    assert.ok(!JSON.stringify(g1).includes(h.tmp), "no filesystem path reaches the graph");
    const i1 = await insights();
    assert.ok(i1.findings.some((f) => f.kind === "BLOCKED_TASK" && f.variant === "dependency" && f.params.dependency === "Build the feature"), "the real dependent task is reported as waiting on its real dependency");
    assert.ok(!i1.findings.some((f) => f.kind === "FAILED_EXECUTION" || f.kind === "DEPLOYMENT_PROBLEM"), "a healthy pipeline reports no failure");

    // ---- deployment to a (test-adapter) preview target ----
    const candidate = await h.deploy.createCandidate(ADMIN, {
      projectId: "alpha",
      pushReceiptId: push.receiptId,
      targetId: "alpha-preview",
      artifactIds: [...v.artifactIds],
    });
    const release = await h.deploy.deploy(ADMIN, { projectId: "alpha", candidateId: candidate.candidateId }, "e2e-1");
    assert.equal(release.status, "healthy");
    observe();
    const g2 = await graph();
    const dep = g2.nodes.find((n) => n.id === `deployment-${release.releaseId}`)!;
    assert.ok(dep, "the release is projected");
    assert.match(dep.label, /\(simulated\)/, "a simulated deployment can never read as a real one");
    assert.equal(dep.state, "completed", "healthy (post-deploy verified) is completed");
    assert.ok(edge(g2, "DEPLOYED_TO", `commit-${commit.receiptId}`, dep.id), "linked through the release's own commit SHA");
    assert.notEqual(g2.revision, g1.revision, "revision moved when the authoritative state moved");
    assert.equal((await graph()).revision, g2.revision, "a read does not move the revision");
    assert.ok(!(await insights()).findings.some((f) => f.kind === "DEPLOYMENT_PROBLEM"));

    // ---- FAILURE CONTAINMENT: a failing deployment is reported, never as healthy ----
    h.deployAdapter.fail = true;
    const failing = await h.deploy.createCandidate(ADMIN, { projectId: "alpha", pushReceiptId: push.receiptId, targetId: "alpha-preview" });
    const bad = await h.deploy.deploy(ADMIN, { projectId: "alpha", candidateId: failing.candidateId }, "e2e-2");
    assert.equal(bad.status, "failed");
    observe();
    const g3 = await graph();
    assert.equal(g3.nodes.find((n) => n.id === `deployment-${bad.releaseId}`)!.state, "failed");
    assert.equal(g3.nodes.find((n) => n.id === dep.id)!.state, "completed", "the earlier healthy release is unaffected");
    const i3 = await insights();
    const problem = i3.findings.find((f) => f.kind === "DEPLOYMENT_PROBLEM" && f.subjectNodeId === `deployment-${bad.releaseId}`)!;
    assert.equal(problem.severity, "critical");
    assert.ok(problem.limitations.includes("cause_not_recorded"), "it does not claim to know why");
    assert.notEqual(i3.graphRevision, i1.graphRevision);
    h.deployAdapter.fail = false;

    // ---- KILL/CANCEL PATH: an authorised operator stops work through the governed command ----
    const command = new WorkforceCommandService(ctx);
    const { session: toStop } = await h.manager.createSession(
      OPERATOR,
      {
        projectId: "alpha",
        planId: h.plan.planId,
        planVersion: h.plan.version,
        stageId: "build:web",
        operationId: "workspace.file.create",
        operationIds: ["workspace.file.update", "workspace.file.read"],
      },
      "e2e-cancel",
    );
    assert.ok(["created", "validating", "ready", "running"].includes(toStop.status), `cancellable, was ${toStop.status}: ${JSON.stringify(toStop.reasons)}`);
    const viewerTry = await command.cancelExecution(VIEWER, { sessionId: toStop.sessionId, reason: "no" });
    assert.equal(viewerTry.outcome, "denied", "a viewer cannot stop work");
    const stopped = await command.cancelExecution(OPERATOR, { sessionId: toStop.sessionId, reason: "operator stop" });
    assert.equal(stopped.outcome, "executed");
    observe();
    const g4 = await graph();
    assert.equal(g4.nodes.find((n) => n.id === `session-${toStop.sessionId}`)!.state, "cancelled", "a cancelled session is cancelled, not 'unavailable'");
    assert.ok(!(await insights()).findings.some((f) => f.kind === "FAILED_EXECUTION" && f.subjectNodeId === `session-${toStop.sessionId}`), "a cancellation is not reported as a failure");

    // ---- AUDIT RECONSTRUCTION: request → plan → assignment → execution → ChangeSet → verification →
    //      review → approval → commit → deployment → result, all linked by recorded identifiers ----
    const session = await h.manager.getSession(ADMIN, sessionEdge!.source.replace(/^session-/, ""));
    const chain = {
      plan: session.plan.planId,
      assignedAgent: session.agentId,
      environment: session.environmentInstanceId,
      session: session.sessionId,
      changeSet: commit.changeSetId,
      verification: commit.verificationId,
      review: commit.reviewId,
      approvals: [...commit.approvalIds],
      commit: commit.commitSha,
      release: release.commitSha,
      result: release.status,
    };
    assert.equal(chain.plan, h.plan.planId);
    assert.ok(chain.assignedAgent && chain.environment, "assignment and environment are recorded on the session");
    assert.equal(chain.verification, v.verificationId);
    assert.equal(chain.review, review.reviewId);
    assert.equal(stage.changeSetId, chain.changeSet);
    assert.equal(chain.release, chain.commit, "the deployment is for exactly that commit");
    assert.ok(chain.approvals.length > 0);
    assert.equal(chain.result, "healthy");
    const actions = h.fixture.audit.query({ type: "execution_event" }).map((e) => e.data.action);
    for (const a of ["review_recorded", "stage_set_created", "commit_completed", "push_completed", "deployment_candidate_created", "deployment_started", "deployment_healthy"]) {
      assert.ok(actions.includes(a), `audited: ${a}`);
    }
    const commands = h.fixture.audit.list().filter((e) => e.type === "control_command");
    assert.ok(commands.some((e) => e.data?.command === "cancel_execution" && e.data?.outcome === "denied"));
    const cancelled = commands.find((e) => e.data?.command === "cancel_execution" && e.data?.outcome === "executed");
    assert.ok(cancelled, "the executed cancel is audited as executed");
    assert.equal(cancelled!.data?.actor, OPERATOR.id);
    assert.equal(cancelled!.data?.detailOutcome, "cancelled", "the domain outcome is preserved alongside, not instead");
  } finally {
    h.cleanup();
  }
});


/* ------------------------------------------------------------------ */
/* EO-6.1 — failure containment across the pipeline, and DEPLOYED !=    */
/* HEALTHY with a real production-verification step.                    */
/* ------------------------------------------------------------------ */
test("EO-6.1 CHAIN: no downstream stage runs without its upstream gate — and each refusal records nothing", async () => {
  const h = await harness();
  try {
    const { verification: v } = await h.developAndVerify();
    const review = await h.sc.recordAgentReview(ADMIN, {
      projectId: "alpha",
      verificationId: v.verificationId,
      reviewerAgentId: "review-agent",
      status: "approved",
    });
    const stage = await h.sc.prepareStageSet(ADMIN, {
      projectId: "alpha",
      verificationId: v.verificationId,
      reviewId: review.reviewId,
    });
    const activity = async () => (await h.sc.activity(ADMIN, "alpha", 50)).commits.length;
    const commitWith = (approvalId: string, key: string) =>
      h.sc.commit(ADMIN, { projectId: "alpha", stageSetId: stage.stageSetId, summary: "ship feature", approvalId }, key);

    // APPROVED != EXECUTED and REQUESTED != APPROVED: a pending approval authorises nothing.
    const requested = await h.sc.requestApproval(ADMIN, { projectId: "alpha", operation: "commit", subjectId: stage.stageSetId, reason: "ship" });
    await assert.rejects(commitWith(requested.id, "chain-1"), (e: unknown) => e instanceof ExecutionDeniedError);
    assert.equal(await activity(), 0, "a refused commit leaves no commit receipt");
    // A decided-REJECTED approval authorises nothing either.
    h.fixture.approvals.decide(requested.id, "rejected", "admin-2");
    await assert.rejects(commitWith(requested.id, "chain-2"), (e: unknown) => e instanceof ExecutionDeniedError);
    assert.equal(await activity(), 0);
    // The genuine, approved, correctly-bound approval works — exactly once.
    const good = await h.sc.requestApproval(ADMIN, { projectId: "alpha", operation: "commit", subjectId: stage.stageSetId, reason: "ship feature" });
    h.approve(good.id);
    const commit = await commitWith(good.id, "chain-4");
    assert.equal(await activity(), 1);
    // COMMIT CREATED != PUSH SUCCEEDED: push needs its own approval.
    await assert.rejects(
      h.sc.push(ADMIN, { projectId: "alpha", commitReceiptId: commit.receiptId, approvalId: good.id }, "chain-5"),
      (e: unknown) => e instanceof ExecutionDeniedError,
      "the COMMIT approval must not authorise the PUSH",
    );
    assert.equal((await h.sc.activity(ADMIN, "alpha", 50)).pushes.length, 0);
    assert.notEqual(remoteHead(h.remote), commit.commitSha, "nothing reached the remote");
    // PUSH SUCCEEDED != DEPLOYED: a deployment candidate cannot be built from a commit that was never pushed.
    await assert.rejects(
      h.deploy.createCandidate(ADMIN, { projectId: "alpha", pushReceiptId: "push_that_never_happened", targetId: "alpha-preview" }),
      NotFoundError,
    );
    assert.deepEqual(await h.deploy.listReleases(ADMIN, "alpha"), [], "no release was recorded");
  } finally {
    h.cleanup();
  }
});

test("EO-6.1 DEPLOYED != HEALTHY: a provider-accepted release is healthy ONLY if production verification passes and production itself reports the shipped version", async () => {
  const h = await harness();
  try {
    const { push, verification: v } = await h.toPushed();
    // The "network": production reports whatever it is currently running — set by the deploy, never by the test's expectation.
    const prod: { up: boolean; version?: string; openRoute: boolean } = { up: true, version: undefined, openRoute: false };
    const HTML = '<script src="/assets/index-Live1.js"></script>';
    const json = { "content-type": "application/json", "cache-control": "no-store" };
    const fakeFetch = (async (url: string) => {
      const u = String(url);
      if (u.endsWith("/")) return new Response(HTML, { status: 200, headers: { "content-type": "text/html" } });
      if (u.endsWith("/api/health")) {
        return prod.up
          ? new Response(JSON.stringify({ status: "ok", ...(prod.version ? { version: prod.version } : {}) }), { status: 200, headers: json })
          : new Response("down", { status: 503 });
      }
      if (u.endsWith("/api/projects") && prod.openRoute) return new Response("[]", { status: 200, headers: json });
      return new Response("{}", { status: 401, headers: json });
    }) as unknown as typeof fetch;
    class VerifiedAdapter implements DeploymentAdapter {
      readonly adapterId = "verified-hosting";
      readonly version = "0.0.0-test";
      readonly simulated = true;
      /** Whether this simulated provider really "ships" the candidate to the production the test controls. */
      ships = true;
      async deploy(ctx: DeploymentContext) {
        if (this.ships) prod.version = ctx.candidate.commitSha; // production now RUNS this build and says so
        return { providerReleaseId: "prov-1" }; // the provider ACCEPTED the release either way
      }
      async verify() {
        // The version comes from the report (what production says), NOT from this adapter.
        return toPostDeployVerification(await verifyProduction({ baseUrls: ["https://example.web.app"], fetch: fakeFetch }));
      }
    }
    const adapter = new VerifiedAdapter();
    h.deploy.registerAdapter(adapter);
    h.deploy.registerTarget({ targetId: "alpha-verified", projectId: "alpha", targetClass: "preview", adapterId: "verified-hosting", resources: ["hosting"], providerRef: "site", timeoutMs: 2_000 });
    const run = async (key: string) =>
      h.deploy.deploy(ADMIN, { projectId: "alpha", candidateId: (await h.deploy.createCandidate(ADMIN, { projectId: "alpha", pushReceiptId: push.receiptId, targetId: "alpha-verified", artifactIds: [...v.artifactIds] })).candidateId }, key);

    // 1. Everything checks out AND production reports the shipped commit => healthy.
    const healthy = await run("pv-1");
    assert.equal(healthy.status, "healthy");
    assert.equal(healthy.postDeploy!.versionMatches, true, "production itself reported the candidate's commit");

    // 2. Provider accepted it, production HEALTH fails => degraded.
    prod.up = false;
    assert.equal((await run("pv-2")).status, "degraded");
    prod.up = true;

    // 3. Health is fine but a protected route is OPEN (auth bypass) => NOT healthy.
    prod.openRoute = true;
    const bypass = await run("pv-3");
    assert.notEqual(bypass.status, "healthy", "an open protected route must never end healthy");
    assert.equal(bypass.status, "degraded");
    prod.openRoute = false;

    // 4. The provider accepted the release but production still runs the OLD build (stale): the
    //    reported version differs from the candidate => not healthy. (Previously the bridge echoed the
    //    candidate's own SHA back, so this could never be caught.)
    adapter.ships = false;
    prod.version = "0".repeat(40);
    const stale = await run("pv-4");
    assert.notEqual(stale.status, "healthy");
    assert.equal(stale.postDeploy!.versionMatches, false);
    assert.equal(stale.postDeploy!.reportedVersion, "0".repeat(40));

    // 5. Production reports NO version at all => the release cannot be called healthy.
    prod.version = undefined;
    const silent = await run("pv-5");
    assert.notEqual(silent.status, "healthy");
    assert.equal(silent.postDeploy!.versionMatches, false);
  } finally {
    h.cleanup();
  }
});
