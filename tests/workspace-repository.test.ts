/**
 * EO-4.3 — isolated workspace & repository operations.
 *
 * Every mutation runs against TEMPORARY git repositories created per test
 * (never the AI Workforce repository). Operations flow through the real
 * ExecutionManager → ToolExecutionEngine → WorkspaceRepositorySandbox.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  WorkspaceRepositorySandbox,
  resolveTrustedExecutable,
} from "../adapters/index.js";
import {
  DEFAULT_WORKSPACE_FILE_POLICY,
  NotFoundError,
  ValidationError,
  type ExecutionCapability,
  type ExecutionPolicy,
  type ExecutionSession,
  type InvocationResult,
  type WorkspaceFilePolicy,
} from "../contracts/index.js";
import {
  BASELINE_DENY_ALL_POLICY,
  BoundedInvocationDispatcher,
  ExecutionManager,
  ExecutionOperationRegistry,
  ExecutionPolicyRegistry,
  ExecutionToolRegistry,
  InMemoryExecutionReceiptStore,
  InMemoryExecutionSessionStore,
  PermissionSystem,
  REPOSITORY_OPERATIONS,
  REPOSITORY_TOOL,
  SandboxRegistry,
  ToolExecutionEngine,
  ToolRegistry,
  WORKSPACE_OPERATIONS,
  WORKSPACE_TOOL,
  registerExecutionTool,
} from "../core/index.js";
import { BETA_OPERATOR, FAKE_SECRET, OPERATOR } from "./fixtures/execution.js";
import {
  WEB_AGENT,
  WEB_HOST,
  WEB_INSTANCE,
  agent,
  planningFixture,
  webRequest,
} from "./fixtures/planning.js";

const GIT = resolveTrustedExecutable("git");
const READ_OPS = [
  "workspace.file.read",
  "workspace.file.stat",
  "workspace.file.list",
  "workspace.file.search",
];
const WRITE_OPS = ["workspace.file.create", "workspace.file.update"];
const REPO_OPS = REPOSITORY_OPERATIONS.map((o) => o.id);
const ALL_OPS = [...WORKSPACE_OPERATIONS.map((o) => o.id), ...REPO_OPS];

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

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
      ...args,
    ],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    },
  );
}

/** A fresh temp git repository with committed files. */
function makeRepo(
  root: string,
  name: string,
  files: Record<string, string>,
): string {
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
    capabilities?: ExecutionCapability[];
    policy?: Partial<WorkspaceFilePolicy>;
    preexisting?: Record<string, string>;
  } = {},
) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "aiw-eo43-"));
  const repoA = makeRepo(tmp, "repo-a", {
    "README.md": "# Alpha\n",
    "src/app.ts": "export const answer = 42;\n",
    "src/old.ts": "export const legacy = true;\n",
    ".env": `API_KEY=${FAKE_SECRET}\n`,
    ".github/workflows/ci.yml": "name: ci\n",
    "big.txt": "x".repeat(4096),
  });
  const repoB = makeRepo(tmp, "repo-b", {
    "b-only.txt": "beta secret project file\n",
  });
  const outside = path.join(tmp, "outside");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "secret.txt"), "host secret\n");
  const stateRoot = path.join(tmp, "state");
  mkdirSync(stateRoot);
  for (const [rel, content] of Object.entries(options.preexisting ?? {}))
    writeFileSync(path.join(repoA, rel), content);

  const fixture = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [WEB_AGENT, agent("sec-agent", ["security_review"])],
  });
  const tools = new ToolRegistry(fixture.audit);
  const executionTools = new ExecutionToolRegistry();
  const dispatcher = new BoundedInvocationDispatcher();
  const scope = {
    allowedAgents: ["web-agent"],
    allowedProjects: ["alpha", "beta"],
    allowedEnvironments: ["local" as const],
  };
  registerExecutionTool(
    tools,
    executionTools,
    dispatcher,
    WORKSPACE_TOOL,
    scope,
  );
  registerExecutionTool(
    tools,
    executionTools,
    dispatcher,
    REPOSITORY_TOOL,
    scope,
  );
  const operations = new ExecutionOperationRegistry();
  [...WORKSPACE_OPERATIONS, ...REPOSITORY_OPERATIONS].forEach((o) =>
    operations.register(o),
  );

  const policy: ExecutionPolicy = {
    policyId: "workspace-dev",
    version: 1,
    description: "EO-4.3 test policy.",
    rules: [
      {
        id: "workspace",
        operationIds: ALL_OPS,
        capabilities: options.capabilities ?? [
          "filesystem.read",
          "filesystem.write.workspace",
          "filesystem.delete.workspace",
          "repository.read",
        ],
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
      operationTimeoutMs: 30_000,
      maxOutputBytes: 512 * 1024,
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
  policies.bindProject("alpha", "workspace-dev", 1);
  policies.bindProject("beta", "workspace-dev", 1);

  const events: { action: string; data: Record<string, unknown> }[] = [];
  const workspace = new WorkspaceRepositorySandbox({
    repositories: [
      { repositoryId: "repo-alpha", projectId: "alpha", localPath: repoA },
      {
        repositoryId: "repo-beta",
        projectId: "beta",
        localPath: repoB,
        remote: {
          url: "https://github.example.test/org/beta.git",
          credentialRef: "secret://github-beta-token",
        },
      },
    ],
    environmentInstanceIds: ["web-1"],
    gitPath: GIT,
    stateRoot,
    policy: {
      ...DEFAULT_WORKSPACE_FILE_POLICY,
      maxReadBytes: 2048,
      maxWriteBytes: 2048,
      ...options.policy,
    },
    onEvent: (e) => {
      events.push(e);
      fixture.audit.record("execution_event", {
        projectId: e.projectId,
        data: { ...e.data, action: e.action },
      });
    },
  });
  const sandboxes = new SandboxRegistry();
  sandboxes.register(workspace);
  const engine = new ToolExecutionEngine({
    registry: tools,
    permissions: new PermissionSystem([{ effect: "allow", action: "execute" }]),
    audit: fixture.audit,
  });
  const sessions = new InMemoryExecutionSessionStore();
  const receipts = new InMemoryExecutionReceiptStore();
  let seq = 0;
  const manager = new ExecutionManager({
    planning: fixture.planning,
    approvals: fixture.approvals,
    agents: fixture.agents,
    isAgentEnabled: (id) => !fixture.disabled.has(id),
    environments: fixture.registry,
    tools,
    projects: { has: (id) => id === "alpha" || id === "beta" },
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
  });
  const plans = {
    alpha: await fixture.planning.createPlan(webRequest("alpha"), {
      id: "op-1",
    }),
    beta: await fixture.planning.createPlan(webRequest("beta"), { id: "op-2" }),
  };
  let keys = 0;
  const session = async (
    ops: string[],
    project: "alpha" | "beta" = "alpha",
  ): Promise<ExecutionSession> => {
    const principal = project === "alpha" ? OPERATOR : BETA_OPERATOR;
    const plan = plans[project];
    const { session } = await manager.createSession(
      principal,
      {
        projectId: project,
        planId: plan.planId,
        planVersion: plan.version,
        stageId: "build:web",
        operationId: ops[0],
        ...(ops.length > 1 ? { operationIds: ops.slice(1) } : {}),
      },
      `key-${++keys}`,
    );
    return session;
  };
  let invocations = 0;
  const invoke = (
    s: ExecutionSession,
    operationId: string,
    input: Record<string, string | number> = {},
    principal = s.projectId === "beta" ? BETA_OPERATOR : OPERATOR,
  ): Promise<InvocationResult> =>
    manager.invoke(principal, {
      sessionId: s.sessionId,
      invocationId: `inv-${++invocations}`,
      toolId: operationId.startsWith("repository.")
        ? "repository"
        : "workspace",
      operationId,
      input,
    });
  const cleanup = () => rmSync(tmp, { recursive: true, force: true });
  return {
    tmp,
    repoA,
    repoB,
    outside,
    stateRoot,
    manager,
    workspace,
    receipts,
    events,
    fixture,
    session,
    invoke,
    cleanup,
    sessions,
  };
}

const codes = (r: { reasons: readonly { code: string }[] }) =>
  r.reasons.map((x) => x.code);
const result = (r: InvocationResult) => r.result as Record<string, unknown>;

test("preconditions: git is available for isolated test repositories", () => {
  assert.ok(GIT, "git must be on PATH for EO-4.3 repository tests");
});

test("READ: an authorized workspace read returns bounded content + hash", async () => {
  const h = await harness();
  try {
    const s = await h.session(READ_OPS);
    assert.equal(s.status, "ready", JSON.stringify(s.reasons));
    assert.equal(s.workspace.mode, "read_only");
    const r = await h.invoke(s, "workspace.file.read", { path: "README.md" });
    assert.equal(r.exitClass, "success", JSON.stringify(r.reasons));
    assert.equal(result(r).content, "# Alpha\n");
    assert.equal(result(r).sha256, sha("# Alpha\n"));
    const list = await h.invoke(s, "workspace.file.list", {});
    const names = (result(list).entries as { name: string }[]).map(
      (e) => e.name,
    );
    assert.ok(names.includes("src") && !names.includes(".git"));
    assert.equal(
      (await h.sessions.get(s.sessionId))!.status,
      "running",
      "persistent session stays open",
    );
  } finally {
    h.cleanup();
  }
});

test("WRITE: create + update produce a ChangeSet, receipts and audit — never content in evidence", async () => {
  const h = await harness();
  try {
    const s = await h.session([...READ_OPS, ...WRITE_OPS]);
    assert.equal(s.workspace.mode, "read_write");
    const created = await h.invoke(s, "workspace.file.create", {
      path: "src/new.ts",
      content: "export const created = 1;\n",
    });
    assert.equal(created.exitClass, "success", JSON.stringify(created.reasons));
    assert.equal(
      readFileSync(path.join(h.repoA, "src/new.ts"), "utf8"),
      "export const created = 1;\n",
    );
    const updated = await h.invoke(s, "workspace.file.update", {
      path: "README.md",
      content: "# Alpha v2\n",
      expectedHash: sha("# Alpha\n"),
    });
    assert.equal(updated.exitClass, "success", JSON.stringify(updated.reasons));
    const changeSet = await h.manager.getChangeSet(OPERATOR, s.sessionId);
    assert.deepEqual(
      changeSet!.entries.map((e) => [e.path, e.change]),
      [
        ["README.md", "modified"],
        ["src/new.ts", "created"],
      ],
    );
    const receipt = h.receipts.get(updated.receiptId)!;
    assert.equal(receipt.workspaceId, s.workspace.workspaceId);
    assert.equal(receipt.changeSetId, changeSet!.changeSetId);
    assert.equal(receipt.changes![0]!.afterHash, sha("# Alpha v2\n"));
    assert.ok(
      !JSON.stringify(receipt).includes("Alpha v2"),
      "no content in receipts",
    );
    const actions = h.fixture.audit
      .query({ type: "execution_event" })
      .map((e) => e.data.action);
    for (const a of [
      "workspace_created",
      "file_created",
      "file_modified",
      "changeset_updated",
    ])
      assert.ok(actions.includes(a), a);
    assert.ok(
      !JSON.stringify(
        h.fixture.audit.query({ type: "execution_event" }),
      ).includes("export const created"),
    );
  } finally {
    h.cleanup();
  }
});

test("READ-ONLY and DELETE separation: no escalation, write ≠ delete", async () => {
  const h = await harness();
  try {
    const reader = await h.session(READ_OPS);
    const w = await h.invoke(reader, "workspace.file.create", {
      path: "x.txt",
      content: "x",
    });
    assert.equal(w.outcome, "denied");
    assert.ok(codes(w).includes("TOOL_NOT_ALLOWED"));
    const writer = await h.session([...READ_OPS, ...WRITE_OPS]);
    const d = await h.invoke(writer, "workspace.file.delete", {
      path: "src/old.ts",
      expectedHash: sha("export const legacy = true;\n"),
    });
    assert.equal(d.outcome, "denied");
    assert.ok(existsSync(path.join(h.repoA, "src/old.ts")));
  } finally {
    h.cleanup();
  }
  const noDelete = await harness({
    capabilities: [
      "filesystem.read",
      "filesystem.write.workspace",
      "repository.read",
    ],
  });
  try {
    const s = await noDelete.session([
      "workspace.file.read",
      "workspace.file.delete",
    ]);
    assert.equal(s.status, "denied", "policy grants write but not delete");
    assert.ok(s.reasons.some((r) => r.code === "POLICY_DENIED"));
  } finally {
    noDelete.cleanup();
  }
});

test("TRAVERSAL / ABSOLUTE / MALICIOUS paths → WORKSPACE_VIOLATION (host + other project unreachable)", async () => {
  const h = await harness();
  try {
    const s = await h.session([...READ_OPS, ...WRITE_OPS]);
    for (const p of [
      "../outside/secret.txt",
      "../repo-b/b-only.txt",
      "src/../../outside/secret.txt",
      "..\\repo-b\\b-only.txt",
      h.outside,
      "/etc/passwd",
      "C:\\Users\\Administrator\\.ssh\\id_rsa",
      "\\\\server\\share\\x",
      "~/.aws/credentials",
      "a\u0000b",
      "con",
      "file.txt:stream",
      "-rf",
      "x".repeat(2000),
    ]) {
      const r = await h.invoke(s, "workspace.file.read", { path: p });
      assert.equal(r.outcome, "denied", p);
      assert.ok(
        codes(r).some(
          (c) => c === "WORKSPACE_VIOLATION" || c === "INVALID_TOOL_INPUT",
        ),
        `${p}: ${codes(r)}`,
      );
      const c = await h.invoke(s, "workspace.file.create", {
        path: p,
        content: "pwn",
      });
      assert.equal(c.outcome, "denied", p);
    }
    assert.equal(
      readFileSync(path.join(h.outside, "secret.txt"), "utf8"),
      "host secret\n",
    );
    // The other project's files are not addressable from this workspace.
    const b = await h.invoke(s, "workspace.file.read", { path: "b-only.txt" });
    assert.equal(b.outcome, "denied");
  } finally {
    h.cleanup();
  }
});

test("SYMLINK / JUNCTION escape: denied for read and write", async (t) => {
  const h = await harness();
  try {
    try {
      symlinkSync(
        h.outside,
        path.join(h.repoA, "link"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch {
      t.skip("platform does not allow creating links");
      return;
    }
    const s = await h.session([...READ_OPS, ...WRITE_OPS]);
    const r = await h.invoke(s, "workspace.file.read", {
      path: "link/secret.txt",
    });
    assert.ok(
      codes(r).includes("WORKSPACE_VIOLATION"),
      JSON.stringify(r.reasons),
    );
    const w = await h.invoke(s, "workspace.file.create", {
      path: "link/planted.txt",
      content: "x",
    });
    assert.ok(
      codes(w).includes("WORKSPACE_VIOLATION"),
      JSON.stringify(w.reasons),
    );
    assert.ok(!existsSync(path.join(h.outside, "planted.txt")));
  } finally {
    h.cleanup();
  }
});

test("CROSS PROJECT: project B's operator cannot touch project A's session; B's workspace is B's repo", async () => {
  const h = await harness();
  try {
    const a = await h.session(READ_OPS);
    await assert.rejects(
      h.invoke(a, "workspace.file.read", { path: "README.md" }, BETA_OPERATOR),
      NotFoundError,
    );
    const b = await h.session(READ_OPS, "beta");
    const r = await h.invoke(b, "workspace.file.read", { path: "b-only.txt" });
    assert.equal(r.exitClass, "success", JSON.stringify(r.reasons));
    const notA = await h.invoke(b, "workspace.file.read", {
      path: "README.md",
    });
    assert.equal(notA.outcome, "denied");
  } finally {
    h.cleanup();
  }
});

test("SECRET files: never readable, skipped by search, omitted from diffs; values redacted", async () => {
  const h = await harness();
  try {
    const s = await h.session([...READ_OPS, ...REPO_OPS]);
    const r = await h.invoke(s, "workspace.file.read", { path: ".env" });
    assert.equal(r.outcome, "denied");
    assert.ok(codes(r).includes("POLICY_DENIED"));
    const search = await h.invoke(s, "workspace.file.search", {
      query: "API_KEY",
    });
    assert.deepEqual(result(search).results, []);
    writeFileSync(
      path.join(h.repoA, ".env"),
      `API_KEY=${FAKE_SECRET}\nOTHER=1\n`,
    );
    writeFileSync(
      path.join(h.repoA, "src/app.ts"),
      `export const answer = 43; // ${FAKE_SECRET}\n`,
    );
    const diff = await h.invoke(s, "repository.diff");
    assert.equal(diff.exitClass, "success", JSON.stringify(diff.reasons));
    assert.deepEqual(result(diff).omittedSecretFiles, [".env"]);
    assert.match(String(result(diff).diff), /answer = 43/);
    assert.ok(
      !JSON.stringify(diff).includes(FAKE_SECRET),
      "secret-shaped values redacted",
    );
    assert.ok(
      !JSON.stringify(h.receipts.get(diff.receiptId)).includes(FAKE_SECRET),
    );
  } finally {
    h.cleanup();
  }
});

test("SIZE LIMITS: oversized read and write → RESOURCE_LIMIT", async () => {
  const h = await harness();
  try {
    const s = await h.session([...READ_OPS, ...WRITE_OPS]);
    const r = await h.invoke(s, "workspace.file.read", { path: "big.txt" });
    assert.ok(codes(r).includes("RESOURCE_LIMIT"));
    const w = await h.invoke(s, "workspace.file.create", {
      path: "huge.txt",
      content: "y".repeat(3000),
    });
    assert.ok(codes(w).includes("RESOURCE_LIMIT"));
    assert.ok(!existsSync(path.join(h.repoA, "huge.txt")));
  } finally {
    h.cleanup();
  }
});

test("REPOSITORY: status, diff and bounded history are structured", async () => {
  const h = await harness();
  try {
    git(h.repoA, "commit", "-q", "--allow-empty", "-m", "second");
    const s = await h.session([...WRITE_OPS, ...READ_OPS, ...REPO_OPS]);
    await h.invoke(s, "workspace.file.update", {
      path: "src/app.ts",
      content: "export const answer = 7;\n",
      expectedHash: sha("export const answer = 42;\n"),
    });
    const status = await h.invoke(s, "repository.status");
    assert.equal(status.exitClass, "success", JSON.stringify(status.reasons));
    assert.equal(result(status).branch, "main");
    assert.deepEqual(
      (result(status).entries as { path: string }[]).map((e) => e.path),
      ["src/app.ts"],
    );
    const diff = await h.invoke(s, "repository.diff");
    assert.match(
      String(result(diff).diff),
      /-export const answer = 42;\n\+export const answer = 7;/,
    );
    const log = await h.invoke(s, "repository.log", { limit: 1 });
    const commits = result(log).commits as {
      subject: string;
      commit: string;
    }[];
    assert.equal(commits.length, 1);
    assert.equal(commits[0]!.subject, "second");
    assert.match(commits[0]!.commit, /^[0-9a-f]{40}$/);
    const tooMany = await h.invoke(s, "repository.log", { limit: 5000 });
    assert.ok(codes(tooMany).includes("INVALID_TOOL_INPUT"));
    const branch = await h.invoke(s, "repository.currentBranch");
    assert.equal(result(branch).branch, "main");
  } finally {
    h.cleanup();
  }
});

test("NO RAW GIT, NO PUSH/COMMIT/STAGE/BRANCH: not registered, not grantable, not injectable", async () => {
  const h = await harness();
  try {
    const registered = [...WORKSPACE_OPERATIONS, ...REPOSITORY_OPERATIONS]
      .map((o) => o.id)
      .join(" ");
    assert.doesNotMatch(
      registered,
      /push|commit|stage|add|branch\.create|checkout|reset|fetch|clone|raw/i,
    );
    const s = await h.session(REPO_OPS);
    for (const operationId of [
      "repository.rawGitCommand",
      "repository.push",
      "repository.commit",
    ]) {
      const r = await h.invoke(s, operationId);
      assert.equal(r.outcome, "denied", operationId);
    }
    const injected = await h.invoke(s, "repository.log", {
      limit: 1,
      args: "push --force",
    });
    assert.ok(codes(injected).includes("INVALID_TOOL_INPUT"));
    for (const field of [
      "gitArgs",
      "command",
      "rawGitCommand",
      "repositoryUrl",
      "cwd",
    ]) {
      await assert.rejects(
        h.manager.invoke(OPERATOR, {
          sessionId: s.sessionId,
          invocationId: `x-${field}`,
          toolId: "repository",
          operationId: "repository.status",
          [field]: "push",
        }),
        ValidationError,
      );
    }
    // A session asking for push is denied by policy (forbidden capability).
    const log = git(h.repoA, "log", "--oneline");
    assert.equal(log.trim().split("\n").length, 1, "no commit was created");
  } finally {
    h.cleanup();
  }
});

test("PRE-EXISTING CHANGES: baseline recorded; agent cannot overwrite; rollback preserves them", async () => {
  const h = await harness({
    preexisting: { "README.md": "# Alpha (user edit)\n" },
  });
  try {
    const s = await h.session([
      ...READ_OPS,
      ...WRITE_OPS,
      "workspace.file.delete",
      ...REPO_OPS,
    ]);
    const blocked = await h.invoke(s, "workspace.file.update", {
      path: "README.md",
      content: "agent",
      expectedHash: sha("# Alpha (user edit)\n"),
    });
    assert.ok(
      codes(blocked).includes("WORKSPACE_CONFLICT"),
      JSON.stringify(blocked.reasons),
    );
    const changeSet0 = await h.manager.getChangeSet(OPERATOR, s.sessionId);
    assert.deepEqual(changeSet0!.baseline, ["README.md"]);
    assert.match(changeSet0!.baseRevision ?? "", /^[0-9a-f]{40}$/);

    // One created, one modified, one deleted file.
    await h.invoke(s, "workspace.file.create", {
      path: "docs/new.md",
      content: "new\n",
    });
    await h.invoke(s, "workspace.file.update", {
      path: "src/app.ts",
      content: "export const answer = 1;\n",
      expectedHash: sha("export const answer = 42;\n"),
    });
    const del = await h.invoke(s, "workspace.file.delete", {
      path: "src/old.ts",
      expectedHash: sha("export const legacy = true;\n"),
    });
    assert.equal(del.exitClass, "success", JSON.stringify(del.reasons));
    const changeSet = await h.manager.getChangeSet(OPERATOR, s.sessionId);
    assert.deepEqual(
      changeSet!.entries.map((e) => [e.path, e.change]),
      [
        ["docs/new.md", "created"],
        ["src/app.ts", "modified"],
        ["src/old.ts", "deleted"],
      ],
    );
    const changed = await h.invoke(s, "repository.changedFiles");
    const origin = Object.fromEntries(
      (result(changed).files as { path: string; origin: string }[]).map((f) => [
        f.path,
        f.origin,
      ]),
    );
    assert.equal(origin["README.md"], "preexisting");
    assert.equal(origin["src/app.ts"], "session");

    // ROLLBACK: only session-owned changes are reverted.
    const report = await h.manager.rollbackWorkspace(OPERATOR, s.sessionId);
    assert.deepEqual([...report.reverted].sort(), [
      "docs/new.md",
      "src/app.ts",
      "src/old.ts",
    ]);
    assert.ok(!existsSync(path.join(h.repoA, "docs/new.md")));
    assert.equal(
      readFileSync(path.join(h.repoA, "src/app.ts"), "utf8"),
      "export const answer = 42;\n",
    );
    assert.equal(
      readFileSync(path.join(h.repoA, "src/old.ts"), "utf8"),
      "export const legacy = true;\n",
    );
    assert.equal(
      readFileSync(path.join(h.repoA, "README.md"), "utf8"),
      "# Alpha (user edit)\n",
      "pre-existing change preserved",
    );
    assert.equal(
      (await h.manager.getChangeSet(OPERATOR, s.sessionId))!.status,
      "rolled_back",
    );
  } finally {
    h.cleanup();
  }
});

test("ROLLBACK never reverts a file someone else changed after the session wrote it", async () => {
  const h = await harness();
  try {
    const s = await h.session([...READ_OPS, ...WRITE_OPS]);
    await h.invoke(s, "workspace.file.create", {
      path: "notes.md",
      content: "agent\n",
    });
    writeFileSync(path.join(h.repoA, "notes.md"), "user took over\n");
    const report = await h.manager.rollbackWorkspace(OPERATOR, s.sessionId);
    assert.deepEqual(report.reverted, []);
    assert.equal(report.skipped[0]!.path, "notes.md");
    assert.equal(
      readFileSync(path.join(h.repoA, "notes.md"), "utf8"),
      "user took over\n",
    );
  } finally {
    h.cleanup();
  }
});

test("CONCURRENCY + CONFLICTS: one write lease per workspace; stale hashes never overwrite", async () => {
  const h = await harness();
  try {
    const first = await h.session([...READ_OPS, ...WRITE_OPS]);
    const second = await h.session([...READ_OPS, ...WRITE_OPS]);
    const a = await h.invoke(first, "workspace.file.create", {
      path: "a.txt",
      content: "a",
    });
    assert.equal(a.exitClass, "success");
    const b = await h.invoke(second, "workspace.file.create", {
      path: "b.txt",
      content: "b",
    });
    assert.ok(
      codes(b).includes("WORKSPACE_CONFLICT"),
      JSON.stringify(b.reasons),
    );
    // Readers are not blocked by the write lease.
    const reader = await h.session(READ_OPS);
    assert.equal(
      (await h.invoke(reader, "workspace.file.read", { path: "a.txt" }))
        .exitClass,
      "success",
    );
    // Lost-update protection.
    const stale = await h.invoke(first, "workspace.file.update", {
      path: "a.txt",
      content: "a2",
      expectedHash: sha("not the current content"),
    });
    assert.ok(codes(stale).includes("WORKSPACE_CONFLICT"));
    const dup = await h.invoke(first, "workspace.file.create", {
      path: "a.txt",
      content: "overwrite?",
    });
    assert.ok(codes(dup).includes("WORKSPACE_CONFLICT"));
    assert.equal(readFileSync(path.join(h.repoA, "a.txt"), "utf8"), "a");
    // Completing the first session releases the lease.
    await h.manager.completeSession(OPERATOR, first.sessionId);
    assert.equal(
      (
        await h.invoke(second, "workspace.file.create", {
          path: "b.txt",
          content: "b",
        })
      ).exitClass,
      "success",
    );
  } finally {
    h.cleanup();
  }
});

test("PROTECTED FILES: CI/CD config needs filesystem.write.protected; .git is never reachable", async () => {
  const h = await harness();
  try {
    const s = await h.session([...READ_OPS, ...WRITE_OPS]);
    const ci = await h.invoke(s, "workspace.file.update", {
      path: ".github/workflows/ci.yml",
      content: "name: pwned\n",
      expectedHash: sha("name: ci\n"),
    });
    assert.ok(codes(ci).includes("POLICY_DENIED"));
    assert.equal(
      readFileSync(path.join(h.repoA, ".github/workflows/ci.yml"), "utf8"),
      "name: ci\n",
    );
    for (const p of [".git/config", ".git/hooks/pre-commit", ".GIT/HEAD"]) {
      assert.equal(
        (await h.invoke(s, "workspace.file.read", { path: p })).outcome,
        "denied",
        p,
      );
      assert.equal(
        (await h.invoke(s, "workspace.file.create", { path: p, content: "x" }))
          .outcome,
        "denied",
        p,
      );
    }
    const dist = await h.invoke(s, "workspace.file.create", {
      path: "dist/bundle.js",
      content: "x",
    });
    assert.ok(
      codes(dist).includes("POLICY_DENIED"),
      "generated output is not source",
    );
    assert.ok(
      h.fixture.audit
        .query({ type: "execution_event" })
        .some((e) => e.data.action === "protected_operation_denied"),
    );
  } finally {
    h.cleanup();
  }
  const privileged = await harness({
    capabilities: [
      "filesystem.read",
      "filesystem.write.workspace",
      "filesystem.write.protected",
      "repository.read",
    ],
  });
  try {
    const s = await privileged.session([...READ_OPS, ...WRITE_OPS]);
    const ci = await privileged.invoke(s, "workspace.file.update", {
      path: ".github/workflows/ci.yml",
      content: "name: ci2\n",
      expectedHash: sha("name: ci\n"),
    });
    assert.equal(ci.exitClass, "success", JSON.stringify(ci.reasons));
    assert.equal(ci.changes![0]!.risk, "protected");
  } finally {
    privileged.cleanup();
  }
});

test("CLEANUP: completion releases the lease and removes only proven adapter state; fails closed", async () => {
  const h = await harness();
  try {
    const s = await h.session([...READ_OPS, ...WRITE_OPS]);
    await h.invoke(s, "workspace.file.create", {
      path: "kept.txt",
      content: "k",
    });
    const statePath = path.join(h.stateRoot, s.workspace.workspaceId);
    assert.ok(existsSync(statePath));
    const done = await h.manager.completeSession(OPERATOR, s.sessionId);
    assert.equal(done.status, "succeeded");
    assert.ok(!existsSync(statePath), "adapter state removed");
    assert.ok(
      existsSync(path.join(h.repoA, "kept.txt")),
      "the working tree is never deleted",
    );
    assert.equal(
      h.workspace.workspace(s.workspace.workspaceId)!.state,
      "closed",
    );
    assert.equal(
      (await h.manager.getChangeSet(OPERATOR, s.sessionId))!.status,
      "ready_for_review",
    );

    // Tampered ownership marker → nothing is deleted.
    const t = await h.session(READ_OPS);
    await h.invoke(t, "workspace.file.read", { path: "README.md" });
    const tState = path.join(h.stateRoot, t.workspace.workspaceId);
    writeFileSync(
      path.join(tState, ".aiw-workspace.json"),
      JSON.stringify({ workspaceId: "someone-else" }),
    );
    await h.manager.completeSession(OPERATOR, t.sessionId);
    assert.ok(existsSync(tState), "cleanup failed closed");
    const released = h.fixture.audit
      .query({ type: "execution_event" })
      .filter((e) => e.data.action === "workspace_released");
    assert.ok(released.some((e) => typeof e.data.failure === "string"));
  } finally {
    h.cleanup();
  }
});

test("PRIVATE REPOSITORY boundary: only a credential REFERENCE exists; never in views, receipts or audit", async () => {
  const h = await harness();
  try {
    const s = await h.session(REPO_OPS, "beta");
    const status = await h.invoke(s, "repository.status");
    assert.equal(status.exitClass, "success", JSON.stringify(status.reasons));
    const everything = JSON.stringify([
      status,
      h.receipts.forSession(s.sessionId),
      h.fixture.audit.list(),
      h.workspace.workspace(s.workspace.workspaceId),
    ]);
    assert.ok(!everything.includes("github-beta-token"));
    assert.ok(
      !everything.includes(h.repoB.replaceAll("\\", "\\\\")),
      "no host path leaks",
    );
  } finally {
    h.cleanup();
  }
  assert.throws(
    () =>
      new WorkspaceRepositorySandbox({
        repositories: [
          {
            repositoryId: "r",
            projectId: "p",
            remote: { url: "https://user:token@github.com/x/y.git" },
          },
        ],
        environmentInstanceIds: [],
        stateRoot: os.tmpdir(),
      }),
    /embedded credentials/,
  );
});
