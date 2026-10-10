/**
 * EO-4.1 — secure execution contracts, sandbox & policy foundation.
 *
 * Drives the real ExecutionManager over real EO-3 planning (plans, approvals,
 * environment registry, agent qualification) with in-memory stores. The only
 * test double is a sandbox provider that ADVERTISES isolation so pre-flight
 * can reach ELIGIBLE; every one of its execution methods throws, and the
 * tests assert none is ever called. Nothing executes.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ExecutionDeniedError,
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  grantAllows,
  validateExecutionRequest,
  validateNetworkDestination,
  validateNetworkPolicy,
  validateResourceLimits,
  validateSecretReference,
  type ExecutionSession,
} from "../contracts/index.js";
import {
  BASELINE_DENY_ALL_POLICY,
  DenyAllSecretBroker,
  ExecutionManager,
  ExecutionPolicyRegistry,
  InMemoryExecutionReceiptStore,
  assertRealPathWithinRoot,
  beginAttempt,
  boundOutput,
  buildStructuredInvocation,
  createExecutionReceipt,
  evaluatePolicy,
  finishAttempt,
  isWithinScope,
  limitEnforcementFor,
  resolveWorkspacePath,
  transitionSession,
} from "../core/index.js";
import { agent, webRequest } from "./fixtures/planning.js";
import {
  ADMIN,
  ALPHA_POLICY,
  BETA_OPERATOR,
  FAKE_SECRET,
  OPERATIONS,
  OPERATOR,
  VIEWER,
  harness,
} from "./fixtures/execution.js";

const codes = (r: { reasons: readonly { code: string }[] }) =>
  r.reasons.map((x) => x.code);

/* ------------------------------------------------------------------ */
/* Pre-flight gates                                                   */
/* ------------------------------------------------------------------ */

test("preflight VALID: current plan + qualified agent + eligible env + allowed capability → ELIGIBLE, nothing runs", async () => {
  const h = await harness();
  const result = await h.manager.preflight(OPERATOR, h.request());
  assert.equal(result.decision, "ELIGIBLE", JSON.stringify(result.reasons));
  assert.deepEqual(result.reasons, []);
  assert.ok(Object.values(result.checks).every((c) => c === "pass"));
  assert.equal(result.agentId, "web-agent");
  assert.equal(result.environmentInstanceId, "web-1");
  assert.deepEqual(result.policy, { policyId: "alpha-web", version: 1 });
  assert.equal(result.executionAvailable, false);
  assert.equal(result.limitEnforcement?.sessionTimeoutMs, "enforced");
  // Not enforced by the provider → stated honestly, never claimed.
  assert.equal(result.limitEnforcement?.memoryBytes, "unsupported");
  assert.deepEqual(result.network, { mode: "deny_all" });
  assert.equal(h.sandbox.calls, 0, "no sandbox method may be invoked");
  assert.ok(!("internal" in result), "internal grant context must not leak");
});

test("preflight STALE_PLAN: a superseded revision is denied, never swapped for the newest", async () => {
  const h = await harness();
  h.fixture.agents.register(agent("web-agent-2", ["web_development"]));
  const { plan: v2 } = await h.fixture.planning.replan(h.plan.planId, {
    id: "op-1",
  });
  assert.equal(v2.version, 2);
  const stale = await h.manager.preflight(OPERATOR, h.request());
  assert.equal(stale.decision, "DENIED");
  assert.ok(codes(stale).includes("STALE_PLAN"));
  assert.equal(stale.plan.version, 1);
  const current = await h.manager.preflight(
    OPERATOR,
    h.request({ planVersion: 2 }),
  );
  assert.ok(!codes(current).includes("STALE_PLAN"));
});

test("preflight AGENT_NOT_QUALIFIED: the agent is re-validated, not trusted from the plan snapshot", async () => {
  const h = await harness();
  h.fixture.disabled.add("web-agent");
  const result = await h.manager.preflight(OPERATOR, h.request());
  assert.equal(result.decision, "DENIED");
  assert.ok(codes(result).includes("AGENT_NOT_QUALIFIED"));
  assert.match(
    result.reasons.find((r) => r.code === "AGENT_NOT_QUALIFIED")!.detail,
    /agent_disabled/,
  );
});

test("preflight ENVIRONMENT_UNAVAILABLE: an offline instance is not used just because the plan chose it", async () => {
  const h = await harness();
  h.fixture.registry.markInstanceUnavailable("web-1");
  const result = await h.manager.preflight(OPERATOR, h.request());
  assert.equal(result.decision, "DENIED");
  assert.ok(codes(result).includes("ENVIRONMENT_UNAVAILABLE"));
});

test("preflight APPROVAL_REQUIRED: high-risk operation needs an approved approval for THIS revision", async () => {
  const h = await harness();
  const denied = await h.manager.preflight(
    OPERATOR,
    h.request({ operationId: "web.build.release", input: {} }),
  );
  assert.equal(denied.decision, "DENIED");
  assert.deepEqual(codes(denied), ["APPROVAL_REQUIRED"]);
  assert.deepEqual(
    denied.requiredApprovals.map((a) => a.reason),
    ["operation_risk"],
  );
});

test("approval revalidation: an approval of V1 is valid for V1 only; client state is never trusted", async () => {
  const h = await harness();
  const prod = await h.fixture.planning.createPlan(
    {
      ...webRequest("alpha"),
      deployments: [
        {
          componentId: "web",
          targetType: "firebase_hosting",
          stage: "production",
        },
      ],
    },
    { id: "op-1" },
  );
  const submitted = await h.fixture.planning.submitForApproval(prod.planId, {
    id: "op-1",
  });
  const approval = h.fixture.approvals.decide(
    submitted.approval.approvalId!,
    "approved",
    "admin-1",
  );
  await h.fixture.planning.applyApprovalDecision(approval, { id: "admin-1" });
  const req = {
    projectId: "alpha",
    planId: prod.planId,
    planVersion: prod.version,
    stageId: "build:web",
    operationId: "web.build.release",
  };
  const ok = await h.manager.preflight(OPERATOR, req);
  assert.equal(ok.decision, "ELIGIBLE", JSON.stringify(ok.reasons));
  assert.equal(ok.requiredApprovals[0]!.approvalId, approval.id);

  // A client cannot smuggle approval state or risk into the request.
  assert.throws(
    () => validateExecutionRequest({ ...req, approved: true }),
    ValidationError,
  );
  assert.throws(
    () => validateExecutionRequest({ ...req, risk: "low" }),
    ValidationError,
  );

  // V2 (after replan) is NOT covered by V1's approval.
  h.fixture.agents.register(agent("web-agent-2", ["web_development"]));
  const { plan: v2 } = await h.fixture.planning.replan(prod.planId, {
    id: "op-1",
  });
  const onV2 = await h.manager.preflight(OPERATOR, {
    ...req,
    planVersion: v2.version,
  });
  assert.ok(codes(onV2).includes("APPROVAL_REQUIRED"));
});

test("preflight TOOL_NOT_ALLOWED: tool policy excludes the assigned agent", async () => {
  const h = await harness();
  const result = await h.manager.preflight(
    OPERATOR,
    h.request({
      stageId: "test:web:unit",
      operationId: "web.test.unit",
      input: {},
    }),
  );
  assert.equal(result.decision, "DENIED");
  assert.ok(codes(result).includes("TOOL_NOT_ALLOWED"));
});

test("preflight UNKNOWN tool/operation: denied, never resolved dynamically", async () => {
  const h = await harness();
  for (const operationId of [
    "rm-rf",
    "child_process.exec",
    "../../web.build",
  ]) {
    const result = await h.manager
      .preflight(OPERATOR, h.request({ operationId, input: {} }))
      .catch((e: unknown) => e);
    if (result instanceof ValidationError) continue; // malformed id rejected outright
    assert.ok(!(result instanceof Error), String(result));
    const r = result as Awaited<ReturnType<typeof h.manager.preflight>>;
    assert.equal(r.decision, "DENIED");
    assert.ok(codes(r).includes("TOOL_NOT_ALLOWED"));
  }
  const ghost = await h.manager.preflight(
    OPERATOR,
    h.request({
      stageId: "security:secret_scan",
      operationId: "web.ghost",
      input: {},
    }),
  );
  assert.ok(codes(ghost).includes("TOOL_NOT_ALLOWED"));
  // An operation for the wrong stage kind is refused too.
  const wrongStage = await h.manager.preflight(
    OPERATOR,
    h.request({ operationId: "web.test.unit", input: {} }),
  );
  assert.ok(codes(wrongStage).includes("TOOL_NOT_ALLOWED"));
});

test("preflight WORKSPACE_VIOLATION: traversal, absolute and mixed-separator escapes", async () => {
  const h = await harness();
  for (const outDir of [
    "../x",
    "dist/../../x",
    "..\\..\\x",
    "dist\\..\\..\\x",
    "dist/..\\../x",
    "/etc/passwd",
    "C:\\Windows",
    "C:relative",
    "\\\\server\\share\\x",
    "\\\\?\\C:\\x",
    "\\rooted",
    "~/secrets",
    "dist/file.txt:stream",
    "dist\u0000x",
    "-rf",
  ]) {
    const result = await h.manager.preflight(
      OPERATOR,
      h.request({ input: { profile: "production", outDir } }),
    );
    assert.equal(result.decision, "DENIED", outDir);
    assert.ok(
      codes(result).includes("WORKSPACE_VIOLATION"),
      `${outDir}: ${codes(result).join(",")}`,
    );
  }
});

test("model output is untrusted: extra input properties and raw commands are rejected", async () => {
  const h = await harness();
  const extra = await h.manager.preflight(
    OPERATOR,
    h.request({ input: { profile: "production", command: "rm -rf /" } }),
  );
  assert.ok(codes(extra).includes("INVALID_TOOL_INPUT"));
  const badEnum = await h.manager.preflight(
    OPERATOR,
    h.request({ input: { profile: "production; curl evil" } }),
  );
  assert.ok(codes(badEnum).includes("INVALID_TOOL_INPUT"));
  assert.throws(
    () =>
      validateExecutionRequest({ ...h.request(), command: "npm run build" }),
    ValidationError,
  );
  assert.throws(
    () => validateExecutionRequest({ ...h.request(), shell: "bash -c x" }),
    ValidationError,
  );
});

test("policy DENY BY DEFAULT: no explicit grant → denied; baseline policy permits nothing", async () => {
  const h = await harness();
  const betaPlan = await h.fixture.planning.createPlan(webRequest("beta"), {
    id: "op-2",
  });
  const result = await h.manager.preflight(BETA_OPERATOR, {
    projectId: "beta",
    planId: betaPlan.planId,
    planVersion: betaPlan.version,
    stageId: "build:web",
    operationId: "web.build",
    input: {},
  });
  assert.equal(result.decision, "DENIED");
  assert.deepEqual(result.policy, {
    policyId: "baseline-deny-all",
    version: 1,
  });
  assert.ok(codes(result).includes("POLICY_DENIED"));
  assert.match(
    result.reasons.find((r) => r.code === "POLICY_DENIED")!.detail,
    /deny by default|forbidden|exceeds/,
  );
});

test("capabilities never imply each other: build ⇏ deploy, repository.write ⇏ push", () => {
  const deploy = evaluatePolicy(
    ALPHA_POLICY,
    OPERATIONS.find((o) => o.id === "web.deploy")!,
  );
  assert.equal(deploy.allowed, false);
  const push = evaluatePolicy(
    ALPHA_POLICY,
    OPERATIONS.find((o) => o.id === "web.push")!,
  );
  assert.equal(push.allowed, false);
  assert.match(push.reasons[0]!.detail, /every capability/);
  const build = evaluatePolicy(ALPHA_POLICY, OPERATIONS[0]!);
  assert.equal(build.allowed, true);
  assert.deepEqual(build.capabilities, [
    "build.invoke",
    "filesystem.write.workspace",
  ]);
  // Forbidden capabilities override any rule; baseline forbids deploy/push.
  assert.equal(
    evaluatePolicy(
      { ...ALPHA_POLICY, forbiddenCapabilities: ["build.invoke"] },
      OPERATIONS[0]!,
    ).allowed,
    false,
  );
  assert.ok(
    BASELINE_DENY_ALL_POLICY.forbiddenCapabilities.includes("deploy.invoke"),
  );
});

test("policies are versioned and immutable; rule wildcards are refused", () => {
  const registry = new ExecutionPolicyRegistry({ policyId: "p", version: 1 });
  registry.register({ ...ALPHA_POLICY, policyId: "p" });
  assert.throws(
    () => registry.register({ ...ALPHA_POLICY, policyId: "p" }),
    /immutable/,
  );
  const stored = registry.get("p", 1)!;
  assert.throws(() => {
    (stored.rules as unknown as unknown[]).push({});
  }, TypeError);
  assert.throws(
    () =>
      registry.register({
        ...ALPHA_POLICY,
        policyId: "w",
        rules: [{ ...ALPHA_POLICY.rules[0]!, operationIds: ["*"] }],
      }),
    /wildcards/,
  );
  assert.throws(
    () => registry.bindProject("alpha", "nope", 1),
    /unknown policy/,
  );
});

test("determinism: same plan/policy/agent/environment/approval state → same decision", async () => {
  const h = await harness();
  const a = await h.manager.preflight(OPERATOR, h.request());
  const b = await h.manager.preflight(OPERATOR, h.request());
  assert.deepEqual(a, b);
  const c = await h.manager.preflight(
    OPERATOR,
    h.request({ operationId: "web.build.release", input: {} }),
  );
  const d = await h.manager.preflight(
    OPERATOR,
    h.request({ operationId: "web.build.release", input: {} }),
  );
  assert.deepEqual(c, d);
});

test("no sandbox provider → SANDBOX_UNAVAILABLE (provider availability is never faked)", async () => {
  const h = await harness({ sandbox: false });
  const result = await h.manager.preflight(OPERATOR, h.request());
  assert.deepEqual(codes(result), ["SANDBOX_UNAVAILABLE"]);
  assert.equal(result.limitEnforcement?.sessionTimeoutMs, "unsupported");
});

/* ------------------------------------------------------------------ */
/* Authorization & project isolation                                  */
/* ------------------------------------------------------------------ */

test("authorization: viewer (authenticated, active) cannot pre-flight; out-of-scope projects look nonexistent", async () => {
  const h = await harness();
  await assert.rejects(
    h.manager.preflight(VIEWER, h.request()),
    PermissionDeniedError,
  );
  await assert.rejects(
    h.manager.preflight(BETA_OPERATOR, h.request()),
    NotFoundError,
  );
  await assert.rejects(
    h.manager.preflight(OPERATOR, h.request({ projectId: "gamma" })),
    NotFoundError,
  );
  // A plan of alpha addressed through beta is not found (no cross-project IDOR).
  await assert.rejects(
    h.manager.preflight(ADMIN, h.request({ projectId: "beta" })),
    NotFoundError,
  );
});

test("sessions: idempotent creation, scoped grants, project-isolated workspace, no cross-project access", async () => {
  const h = await harness();
  const first = await h.manager.createSession(OPERATOR, h.request(), "key-1");
  const again = await h.manager.createSession(OPERATOR, h.request(), "key-1");
  assert.equal(first.replayed, false);
  assert.equal(again.replayed, true);
  assert.equal(again.session.sessionId, first.session.sessionId);
  await assert.rejects(
    h.manager.createSession(
      OPERATOR,
      h.request({
        stageId: "test:web:unit",
        operationId: "web.test.unit",
        input: {},
      }),
      "key-1",
    ),
    StateTransitionError,
  );

  const s = first.session;
  assert.equal(s.status, "ready");
  assert.deepEqual(s.plan, {
    planId: h.plan.planId,
    version: 1,
    executionPlanId: `${h.plan.planId}@v1`,
  });
  assert.equal(s.workspace.projectId, "alpha");
  assert.match(s.workspace.rootRef, /^workspace:\/\/alpha\//);
  assert.deepEqual(s.grants.map((g) => g.capability).sort(), [
    "build.invoke",
    "filesystem.write.workspace",
  ]);
  const grant = s.grants[0]!;
  const use = {
    sessionId: s.sessionId,
    projectId: "alpha",
    agentId: "web-agent",
    environmentInstanceId: "web-1",
    workspaceId: s.workspace.workspaceId,
    toolId: "wf.web-build",
    operationId: "web.build",
    capability: grant.capability,
    at: "2026-09-24T12:01:00.000Z",
  };
  assert.equal(grantAllows(grant, use), true);
  assert.equal(grantAllows(grant, { ...use, projectId: "beta" }), false);
  assert.equal(grantAllows(grant, { ...use, workspaceId: "ews_other" }), false);
  assert.equal(grantAllows(grant, { ...use, sessionId: "exs_other" }), false);
  assert.equal(
    grantAllows(grant, { ...use, capability: "deploy.invoke" }),
    false,
  );
  assert.equal(
    grantAllows(grant, { ...use, at: "2030-01-01T00:00:00.000Z" }),
    false,
    "grants expire",
  );

  // IDOR: session/workspace of alpha are invisible to a beta operator.
  await assert.rejects(
    h.manager.getSession(BETA_OPERATOR, s.sessionId),
    NotFoundError,
  );
  await assert.rejects(
    h.manager.listSessions(BETA_OPERATOR, "alpha"),
    NotFoundError,
  );
  await assert.rejects(
    h.manager.cancel(BETA_OPERATOR, s.sessionId, "x", "cancel"),
    NotFoundError,
  );
  assert.deepEqual(await h.manager.listSessions(ADMIN, "beta"), []);
  assert.equal(
    (await h.manager.getSession(VIEWER, s.sessionId)).sessionId,
    s.sessionId,
  );
  await assert.rejects(
    h.manager.getSession(ADMIN, "exs_unknown"),
    NotFoundError,
  );
});

test("a denied pre-flight produces a terminal DENIED session with no grants", async () => {
  const h = await harness();
  h.fixture.registry.markInstanceUnavailable("web-1");
  const { session } = await h.manager.createSession(
    OPERATOR,
    h.request(),
    "key-denied",
  );
  assert.equal(session.status, "denied");
  assert.deepEqual(session.grants, []);
  assert.equal(session.workspace.status, "released");
  assert.ok(session.reasons.some((r) => r.code === "ENVIRONMENT_UNAVAILABLE"));
});

/* ------------------------------------------------------------------ */
/* Lifecycle, cancellation, kill                                      */
/* ------------------------------------------------------------------ */

test("lifecycle: illegal transitions are rejected; terminal states never resume", async () => {
  const h = await harness();
  const { session } = await h.manager.createSession(
    OPERATOR,
    h.request(),
    "key-lc",
  );
  assert.throws(
    () => transitionSession(session, "succeeded", "t"),
    StateTransitionError,
  );
  assert.throws(
    () => transitionSession({ ...session, status: "created" }, "running", "t"),
    StateTransitionError,
  );
  const running = transitionSession(session, "running", "t1");
  assert.equal(running.startedAt, "t1");
  const done = transitionSession(running, "succeeded", "t2");
  assert.equal(done.endedAt, "t2");
  for (const to of ["running", "ready", "cancelling", "failed"] as const) {
    assert.throws(
      () => transitionSession(done, to, "t3"),
      StateTransitionError,
    );
  }
  const denied: ExecutionSession = { ...session, status: "denied" };
  assert.throws(
    () => transitionSession(denied, "running", "t"),
    StateTransitionError,
  );
});

test("attempts: retries are new attempts; closed attempts are never rewritten", async () => {
  const h = await harness();
  const { session } = await h.manager.createSession(
    OPERATOR,
    h.request(),
    "key-att",
  );
  let s = transitionSession(session, "running", "t1");
  s = beginAttempt(s, "att_1", "t1");
  assert.throws(() => beginAttempt(s, "att_2", "t1"), StateTransitionError);
  s = finishAttempt(s, "att_1", "failed", "t2", "rcp_1");
  assert.throws(
    () => finishAttempt(s, "att_1", "succeeded", "t3"),
    StateTransitionError,
  );
  s = beginAttempt(s, "att_2", "t3");
  assert.deepEqual(
    s.attempts.map((a) => [a.number, a.status]),
    [
      [1, "failed"],
      [2, "running"],
    ],
  );
});

test("cancellation: idempotent, state-aware, audited; kill is admin-only", async () => {
  const h = await harness();
  const { session } = await h.manager.createSession(
    OPERATOR,
    h.request(),
    "key-c",
  );
  const first = await h.manager.cancel(
    OPERATOR,
    session.sessionId,
    "no longer needed",
    "cancel",
  );
  assert.equal(first.outcome, "cancelled");
  assert.equal(first.session.status, "cancelled");
  const second = await h.manager.cancel(
    OPERATOR,
    session.sessionId,
    "again",
    "cancel",
  );
  assert.equal(second.outcome, "already_cancelled");
  assert.equal(second.session.revision, first.session.revision);

  // A running session moves to CANCELLING (the sandbox must confirm).
  const { session: other } = await h.manager.createSession(
    OPERATOR,
    h.request(),
    "key-r",
  );
  const running = transitionSession(other, "running", "t");
  assert.equal(await h.sessions.commit(running, other.revision), "committed");
  await assert.rejects(
    h.manager.cancel(OPERATOR, other.sessionId, "stop", "kill"),
    PermissionDeniedError,
  );
  const killed = await h.manager.cancel(
    ADMIN,
    other.sessionId,
    "runaway",
    "kill",
  );
  assert.equal(killed.outcome, "cancelling");
  assert.equal(killed.session.cancellation?.kind, "kill");
  assert.equal(
    (await h.manager.cancel(ADMIN, other.sessionId, "again", "kill")).outcome,
    "already_cancelling",
  );

  // A succeeded session keeps its history.
  const { session: third } = await h.manager.createSession(
    OPERATOR,
    h.request(),
    "key-s",
  );
  const ok = transitionSession(
    transitionSession(third, "running", "t"),
    "succeeded",
    "t2",
  );
  await h.sessions.commit(ok, third.revision);
  assert.equal(
    (await h.manager.cancel(OPERATOR, third.sessionId, "late", "cancel"))
      .outcome,
    "already_terminal",
  );
  await assert.rejects(
    h.manager.cancel(VIEWER, third.sessionId, "x", "cancel"),
    PermissionDeniedError,
  );
  await assert.rejects(
    h.manager.cancel(OPERATOR, third.sessionId, "  ", "cancel"),
    ValidationError,
  );

  const actions = h.fixture.audit
    .query({ type: "execution_event" })
    .map((e) => [e.data.action, e.data.outcome]);
  assert.ok(
    actions.some(
      ([a, o]) => a === "cancel_requested" && o === "already_cancelled",
    ),
  );
  assert.ok(
    actions.some(([a, o]) => a === "kill_requested" && o === "cancelling"),
  );
  assert.equal(h.sandbox.calls, 0);
});

/* ------------------------------------------------------------------ */
/* Path safety                                                        */
/* ------------------------------------------------------------------ */

test("path safety: canonical workspace-relative paths under Windows and POSIX rules", () => {
  assert.equal(resolveWorkspacePath("dist"), "dist");
  assert.equal(
    resolveWorkspacePath("./dist//assets/./app.js"),
    "dist/assets/app.js",
  );
  assert.equal(
    resolveWorkspacePath("dist\\assets\\app.js"),
    "dist/assets/app.js",
  );
  assert.equal(resolveWorkspacePath("."), ".");
  for (const bad of [
    "",
    "..",
    "a/../..",
    "/abs",
    "\\\\srv\\s",
    "\\\\.\\pipe\\x",
    "D:\\",
    "d:x",
    "CON",
    "nul.txt",
    "a/aux",
    "name. ",
    "a/b.",
    "x:y",
    "a|b",
    "a*",
    "~",
    "a\nb",
  ]) {
    assert.throws(
      () => resolveWorkspacePath(bad),
      ExecutionDeniedError,
      JSON.stringify(bad),
    );
  }
  assert.throws(() => resolveWorkspacePath(42), ExecutionDeniedError);
  assert.equal(isWithinScope("dist/app.js", "dist"), true);
  assert.equal(
    isWithinScope("distribution/x", "dist"),
    false,
    "prefix siblings are outside",
  );
  assert.equal(
    isWithinScope("DIST/x", "dist"),
    true,
    "case-insensitive (Windows-safe)",
  );
});

test("path safety: post-realpath check catches symlink/junction escapes on both platforms", () => {
  assertRealPathWithinRoot(
    "/srv/ws/alpha/ews_1",
    "/srv/ws/alpha/ews_1/dist/a.js",
    "posix",
  );
  assert.throws(
    () =>
      assertRealPathWithinRoot(
        "/srv/ws/alpha/ews_1",
        "/srv/ws/alpha/ews_10/x",
        "posix",
      ),
    ExecutionDeniedError,
  );
  assert.throws(
    () =>
      assertRealPathWithinRoot(
        "/srv/ws/alpha/ews_1",
        "/srv/ws/beta/ews_2/x",
        "posix",
      ),
    ExecutionDeniedError,
  );
  assert.throws(
    () =>
      assertRealPathWithinRoot("/srv/ws/alpha/ews_1", "/etc/passwd", "posix"),
    ExecutionDeniedError,
  );
  assertRealPathWithinRoot(
    "C:\\ws\\alpha\\ews_1",
    "c:/WS/alpha/EWS_1/dist",
    "win32",
  );
  assert.throws(
    () =>
      assertRealPathWithinRoot(
        "C:\\ws\\alpha\\ews_1",
        "C:\\ws\\beta\\x",
        "win32",
      ),
    ExecutionDeniedError,
  );
  assert.throws(
    () =>
      assertRealPathWithinRoot(
        "C:\\ws\\alpha\\ews_1",
        "\\\\server\\share\\x",
        "win32",
      ),
    ExecutionDeniedError,
  );
});

/* ------------------------------------------------------------------ */
/* Structured invocation (no raw shell)                               */
/* ------------------------------------------------------------------ */

test("structured invocation: argv comes only from the server template; no free-form args", () => {
  const executable = {
    executableId: "node-build",
    operations: {
      "web.build": [
        { kind: "literal" as const, value: "build" },
        {
          kind: "enum_input" as const,
          input: "profile",
          values: ["production", "development"],
        },
        { kind: "workspace_path_input" as const, input: "outDir" },
      ],
    },
    environmentVariables: ["NODE_ENV"],
  };
  const inv = buildStructuredInvocation(
    executable,
    "web.build",
    { profile: "production", outDir: "dist" },
    "workspace://alpha/ews_1",
    1000,
  );
  assert.deepEqual(inv.argv, ["build", "production", "dist"]);
  assert.ok(!("rawShellCommand" in inv) && !("command" in inv));
  assert.throws(
    () =>
      buildStructuredInvocation(
        executable,
        "web.build",
        { profile: "--eval=x", outDir: "dist" },
        "w",
        1000,
      ),
    ExecutionDeniedError,
  );
  assert.throws(
    () =>
      buildStructuredInvocation(
        executable,
        "web.build",
        { profile: "production", outDir: "../x" },
        "w",
        1000,
      ),
    ExecutionDeniedError,
  );
  assert.throws(
    () => buildStructuredInvocation(executable, "rm", {}, "w", 1000),
    ExecutionDeniedError,
  );
  assert.throws(
    () =>
      buildStructuredInvocation(
        executable,
        "web.build",
        { profile: "production", outDir: "dist" },
        "w",
        0,
      ),
    ExecutionDeniedError,
  );
});

test("the manager exposes no general-purpose execution surface", () => {
  const methods = Object.getOwnPropertyNames(ExecutionManager.prototype);
  const forbidden =
    /^(execute|run|runShell|shell|bash|powershell|cmd|spawn|spawnArbitrary|runAnything|exec)/i;
  assert.deepEqual(
    methods.filter((m) => forbidden.test(m)),
    [],
  );
});

/* ------------------------------------------------------------------ */
/* Limits, network, secrets, receipts                                 */
/* ------------------------------------------------------------------ */

test("resource limits: negative/zero/unbounded/over-ceiling rejected; enforcement is stated honestly", () => {
  const ok = ALPHA_POLICY.defaultLimits;
  assert.deepEqual(validateResourceLimits(ok), ok);
  assert.throws(
    () => validateResourceLimits({ ...ok, maxOutputBytes: -1 }),
    ValidationError,
  );
  assert.throws(
    () => validateResourceLimits({ ...ok, maxToolCalls: 0 }),
    ValidationError,
  );
  assert.throws(
    () => validateResourceLimits({ ...ok, maxToolCalls: 1.5 }),
    ValidationError,
  );
  const { sessionTimeoutMs: _omit, ...unbounded } = ok;
  void _omit;
  assert.throws(() => validateResourceLimits(unbounded), /unbounded/);
  assert.throws(
    () =>
      validateResourceLimits({
        ...ok,
        sessionTimeoutMs: Number.MAX_SAFE_INTEGER,
      }),
    /ceiling/,
  );
  assert.throws(
    () =>
      validateResourceLimits({
        ...ok,
        operationTimeoutMs: ok.sessionTimeoutMs + 1,
      }),
    /must not exceed/,
  );
  assert.throws(
    () => validateResourceLimits({ ...ok, infinite: true }),
    /unexpected/,
  );
  const report = limitEnforcementFor(undefined, ok);
  assert.ok(Object.values(report).every((v) => v === "unsupported"));
});

test("network: default deny; SSRF-prone destinations are refused", () => {
  assert.deepEqual(validateNetworkPolicy(undefined), { mode: "deny_all" });
  assert.deepEqual(BASELINE_DENY_ALL_POLICY.network, { mode: "deny_all" });
  assert.deepEqual(
    validateNetworkDestination({ host: "registry.npmjs.org", scheme: "https" }),
    {
      host: "registry.npmjs.org",
      port: 443,
      scheme: "https",
    },
  );
  for (const host of [
    "localhost",
    "127.0.0.1",
    "169.254.169.254",
    "10.0.0.1",
    "[::1]",
    "::1",
    "metadata.google.internal",
    "db.internal",
    "printer.local",
    "*.example.com",
    "intranet",
    "Example.com",
  ]) {
    assert.throws(
      () => validateNetworkDestination({ host, scheme: "https" }),
      ValidationError,
      host,
    );
  }
  assert.throws(
    () => validateNetworkDestination({ host: "example.com", scheme: "http" }),
    ValidationError,
  );
  assert.throws(
    () => validateNetworkPolicy({ mode: "allow_all" }),
    ValidationError,
  );
  assert.throws(
    () =>
      validateNetworkPolicy({ mode: "allow_approved_hosts", destinations: [] }),
    ValidationError,
  );
});

test("secrets: referenced, never stored; nothing serialized carries a secret value", async () => {
  const h = await harness();
  assert.equal(
    validateSecretReference("secret://npm-read-token"),
    "secret://npm-read-token",
  );
  assert.throws(() => validateSecretReference(FAKE_SECRET), ValidationError);
  assert.throws(
    () => validateSecretReference("secret://../x"),
    ValidationError,
  );
  const broker = new DenyAllSecretBroker();
  assert.deepEqual(await broker.describe("secret://npm-read-token"), {
    ref: "secret://npm-read-token",
    available: false,
  });
  await assert.rejects(broker.issueHandle(), ExecutionDeniedError);

  const preflight = await h.manager.preflight(OPERATOR, h.request());
  const { session } = await h.manager.createSession(
    OPERATOR,
    h.request(),
    "key-sec",
  );
  const receipt = createExecutionReceipt(
    {
      receiptId: "rcp_sim_1",
      sessionId: session.sessionId,
      attemptId: "att_sim_1",
      projectId: "alpha",
      plan: session.plan,
      stageId: session.stageId,
      agentId: session.agentId,
      environmentInstanceId: session.environmentInstanceId,
      toolId: session.toolId,
      operationId: session.operationId,
      policy: session.policy,
      approvalIds: [],
      startedAt: "2026-09-24T12:00:00.000Z",
      endedAt: "2026-09-24T12:00:05.000Z",
      outcome: "failed",
      exitClass: "tool_failure",
      artifacts: [],
      logRefs: [
        `error: auth failed with ${FAKE_SECRET} and token hunter2hunter2`,
      ],
      resources: { wallClockMs: 5000, outputBytes: 10, outputTruncated: false },
      simulated: true,
    },
    ["hunter2hunter2"],
  );
  const audit = h.fixture.audit.query({ type: "execution_event" });
  for (const [label, value] of Object.entries({
    session,
    policy: h.policies.get("alpha-web", 1),
    preflight,
    receipt,
    audit,
  })) {
    const json = JSON.stringify(value);
    assert.ok(!json.includes(FAKE_SECRET), `${label} leaks a secret`);
    assert.ok(
      !json.includes("hunter2hunter2"),
      `${label} leaks a known secret`,
    );
  }
  assert.equal(receipt.redaction.redactedValues, 2);
});

test("receipts: deterministic simulated receipt, policy version, session correlation, immutable", async () => {
  const h = await harness();
  const { session } = await h.manager.createSession(
    OPERATOR,
    h.request(),
    "key-rcp",
  );
  const input = {
    receiptId: "rcp_sim_2",
    sessionId: session.sessionId,
    attemptId: "att_1",
    projectId: session.projectId,
    plan: session.plan,
    stageId: session.stageId,
    agentId: session.agentId,
    environmentInstanceId: session.environmentInstanceId,
    toolId: session.toolId,
    operationId: session.operationId,
    policy: session.policy,
    approvalIds: [],
    startedAt: "2026-09-24T12:00:00.000Z",
    endedAt: "2026-09-24T12:00:01.000Z",
    outcome: "succeeded" as const,
    exitClass: "success" as const,
    artifacts: [
      {
        artifactId: "art_1",
        kind: "static_web_bundle",
        sizeBytes: 1234,
        digest: { algorithm: "sha256" as const, value: "a".repeat(64) },
        mediaType: "application/zip",
        producerSessionId: session.sessionId,
        storageRef: "artifact://alpha/art_1",
      },
    ],
    logRefs: ["log://alpha/exs/1"],
    resources: { wallClockMs: 1000, outputBytes: 42, outputTruncated: false },
    simulated: true,
  };
  const a = createExecutionReceipt(input);
  const b = createExecutionReceipt(input);
  assert.deepEqual(a, b);
  assert.equal(
    a.simulated,
    true,
    "simulation is labelled, never presented as production",
  );
  assert.deepEqual(a.policy, { policyId: "alpha-web", version: 1 });
  assert.equal(a.sessionId, session.sessionId);
  assert.throws(() => {
    (a as { outcome: string }).outcome = "failed";
  }, TypeError);
  const store = new InMemoryExecutionReceiptStore();
  store.record(a);
  assert.throws(() => store.record({ ...a, outcome: "failed" }), /immutable/);
  assert.equal(store.get("rcp_sim_2")?.outcome, "succeeded");
  assert.throws(
    () =>
      createExecutionReceipt({
        ...input,
        simulated: undefined as unknown as boolean,
      }),
    /simulated/,
  );
  assert.throws(
    () =>
      createExecutionReceipt({ ...input, endedAt: "2026-09-24T11:00:00.000Z" }),
    /precedes/,
  );
});

test("bounded output: redaction first, explicit truncation", () => {
  const out = boundOutput(`${"x".repeat(100)} ${FAKE_SECRET}`, 50);
  assert.equal(out.truncated, true);
  assert.equal(Buffer.byteLength(out.text), 50);
  assert.ok(out.originalBytes > 50);
  const small = boundOutput(`key=${FAKE_SECRET}`, 1000);
  assert.equal(small.truncated, false);
  assert.equal(small.text, "key=[redacted]");
  assert.equal(small.redactions, 1);
});
