import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovalSystem,
  AuditLog,
  NotFoundError,
  PermissionSystem,
  ToolExecutionEngine,
  ToolRegistry,
  ValidationError,
  DEFAULT_TOOL_LIMITS,
  type PermissionGrant,
  type Tool,
  type ToolDefinition,
  type ToolExecutionContext,
} from "../core/index.js";
import { makeInMemoryTool } from "../adapters/index.js";

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

function baseDef(over: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "t.echo",
    name: "Echo",
    description: "Echoes its input.",
    version: "1.0.0",
    capabilities: ["echo"],
    requiredPermission: { action: "read" },
    allowedAgents: ["agent-a"],
    allowedProjects: ["proj-a"],
    allowedEnvironments: ["local", "test"],
    timeoutMs: 1000,
    limits: { ...DEFAULT_TOOL_LIMITS },
    metadata: {},
    ...over,
  };
}

interface EchoTool {
  tool: Tool;
  calls: number;
}

function echoTool(
  over: Partial<ToolDefinition> = {},
  handler?: (input: unknown, ctx: ToolExecutionContext) => unknown,
): EchoTool {
  const state = { calls: 0 };
  const tool = makeInMemoryTool(baseDef(over), (input, ctx) => {
    state.calls += 1;
    return handler ? handler(input, ctx) : { echoed: input };
  });
  return {
    tool,
    get calls() {
      return state.calls;
    },
  };
}

const ALLOW_READ: PermissionGrant = {
  effect: "allow",
  action: "read",
  agentId: "agent-a",
  projectId: "proj-a",
};

interface EngineFixture {
  engine: ToolExecutionEngine;
  audit: AuditLog;
  registry: ToolRegistry;
  approvals: ApprovalSystem;
}

function makeEngine(
  opts: {
    grants?: PermissionGrant[];
    tools?: Tool[];
    clock?: () => number;
    limits?: Partial<typeof DEFAULT_TOOL_LIMITS>;
  } = {},
): EngineFixture {
  const audit = new AuditLog();
  const registry = new ToolRegistry(audit);
  for (const tool of opts.tools ?? []) registry.register(tool);
  const approvals = new ApprovalSystem();
  const engine = new ToolExecutionEngine({
    registry,
    permissions: new PermissionSystem(opts.grants ?? [ALLOW_READ]),
    approvals,
    audit,
    clock: opts.clock,
    limits: opts.limits,
  });
  return { engine, audit, registry, approvals };
}

function req(
  engine: ToolExecutionEngine,
  over: Partial<Parameters<ToolExecutionEngine["createRequest"]>[0]> = {},
) {
  return engine.createRequest({
    taskId: "task-1",
    agentId: "agent-a",
    projectId: "proj-a",
    toolId: "t.echo",
    action: "read",
    input: { x: 1 },
    environment: "local",
    ...over,
  });
}

/* ================================================================== */
/* TOOL REGISTRY                                                       */
/* ================================================================== */

test("registry: register, get, list, byCapability", () => {
  const { tool } = echoTool();
  const registry = new ToolRegistry();
  registry.register(tool);
  assert.equal(registry.get("t.echo")?.name, "Echo");
  assert.deepEqual(
    registry.list().map((t) => t.id),
    ["t.echo"],
  );
  assert.deepEqual(
    registry.byCapability("echo").map((t) => t.id),
    ["t.echo"],
  );
  assert.equal(registry.byCapability("nope").length, 0);
});

test("registry: duplicate registration throws", () => {
  const registry = new ToolRegistry();
  registry.register(echoTool().tool);
  assert.throws(() => registry.register(echoTool().tool), /already registered/);
});

test("registry: validation rejects malformed definitions", () => {
  const registry = new ToolRegistry();
  assert.throws(
    () => registry.register(echoTool({ id: "  " }).tool),
    ValidationError,
  );
  assert.throws(
    () => registry.register(echoTool({ capabilities: [] }).tool),
    /capabilities/,
  );
  assert.throws(
    () =>
      registry.register(
        echoTool({
          requiredPermission: { action: "teleport" as never },
        }).tool,
      ),
    /permission action/,
  );
  assert.throws(
    () =>
      registry.register(
        echoTool({ allowedEnvironments: ["moon" as never] }).tool,
      ),
    /environment/,
  );
  assert.throws(
    () => registry.register(echoTool({ timeoutMs: 0 }).tool),
    /timeoutMs/,
  );
  assert.throws(
    () =>
      registry.register(
        echoTool({
          limits: { ...DEFAULT_TOOL_LIMITS, maxInputBytes: -1 },
        }).tool,
      ),
    /limits/,
  );
});

test("registry: stored definitions are immutable", () => {
  const registry = new ToolRegistry();
  const stored = registry.register(echoTool().tool);
  assert.throws(() => {
    (stored as { timeoutMs: number }).timeoutMs = 999;
  }, TypeError);
});

test("registry: update() is the only sanctioned change and re-validates", () => {
  const { audit } = makeEngine();
  const registry = new ToolRegistry(audit);
  registry.register(echoTool().tool);
  const next = registry.update("t.echo", { version: "1.1.0" });
  assert.equal(next.version, "1.1.0");
  assert.equal(registry.get("t.echo")?.version, "1.1.0");
  assert.throws(
    () => registry.update("t.echo", { timeoutMs: -5 }),
    /timeoutMs/,
  );
});

test("registry: eligibility + describe (no handler leaked)", () => {
  const registry = new ToolRegistry();
  registry.register(
    echoTool({ allowedAgents: ["*"], allowedProjects: ["proj-a"] }).tool,
  );
  assert.equal(registry.eligibleForAgent("t.echo", "anyone"), true);
  assert.equal(registry.eligibleForProject("t.echo", "proj-a"), true);
  assert.equal(registry.eligibleForProject("t.echo", "proj-b"), false);

  const view = registry.describe("t.echo") as unknown as Record<
    string,
    unknown
  >;
  assert.equal(view.name, "Echo");
  assert.equal(view.execute, undefined);
  assert.equal(view.inputSchema, undefined);
});

test("registry: register emits a tool_registered audit event", () => {
  const audit = new AuditLog();
  const registry = new ToolRegistry(audit);
  registry.register(echoTool().tool);
  const event = audit.list().find((e) => e.type === "tool_registered");
  assert.equal((event?.data as { toolId?: string }).toolId, "t.echo");
  assert.equal((event?.data as { action?: string }).action, "register");
});

/* ================================================================== */
/* TOOL REQUEST                                                        */
/* ================================================================== */

test("request: createRequest fills id, timestamp, and defaults", () => {
  const { engine } = makeEngine({ tools: [echoTool().tool] });
  const request = engine.createRequest({
    taskId: "task-1",
    agentId: "agent-a",
    projectId: "proj-a",
    toolId: "t.echo",
  });
  assert.match(request.requestId, /^toolreq_/);
  assert.equal(request.action, "read"); // from the tool's requiredPermission
  assert.equal(request.environment, "local");
  assert.equal(request.input, null);
  assert.ok(request.requestedAt);
});

test("request: an invalid request is a structured failure, tool not run", async () => {
  const echo = echoTool();
  const { engine } = makeEngine({ tools: [echo.tool] });
  const request = req(engine, {});
  (request as { agentId: string }).agentId = "";
  const result = await engine.execute(request);
  assert.equal(result.status, "failure");
  assert.equal(result.error?.reason, "invalid_request");
  assert.equal(echo.calls, 0);
});

test("request: an unknown tool is a structured failure", async () => {
  const { engine } = makeEngine();
  const result = await engine.execute(
    engine.createRequest({
      taskId: "t",
      agentId: "agent-a",
      projectId: "proj-a",
      toolId: "t.ghost",
      action: "read",
    }),
  );
  assert.equal(result.status, "failure");
  assert.equal(result.error?.reason, "unknown_tool");
});

test("request: unauthorized agent is denied and the tool never runs", async () => {
  const echo = echoTool({ allowedAgents: ["agent-b"] });
  const { engine } = makeEngine({ tools: [echo.tool] });
  const result = await engine.execute(req(engine));
  assert.equal(result.status, "denied");
  assert.equal(result.error?.reason, "agent_not_allowed");
  assert.equal(echo.calls, 0);
});

test("request: unauthorized project is denied", async () => {
  const echo = echoTool({ allowedProjects: ["proj-b"] });
  const { engine } = makeEngine({ tools: [echo.tool] });
  const result = await engine.execute(req(engine, { projectId: "proj-a" }));
  assert.equal(result.status, "denied");
  assert.equal(result.error?.reason, "project_not_allowed");
  assert.equal(echo.calls, 0);
});

test("request: unauthorized environment is denied", async () => {
  const echo = echoTool({ allowedEnvironments: ["local"] });
  const { engine } = makeEngine({
    tools: [echo.tool],
    grants: [{ ...ALLOW_READ, environment: undefined }],
  });
  const result = await engine.execute(req(engine, { environment: "test" }));
  assert.equal(result.status, "denied");
  assert.equal(result.error?.reason, "environment_not_allowed");
  assert.equal(echo.calls, 0);
});

/* ================================================================== */
/* PERMISSIONS                                                         */
/* ================================================================== */

test("permissions: an explicit allow grant permits execution", async () => {
  const { engine } = makeEngine({ tools: [echoTool().tool] });
  const result = await engine.execute(req(engine));
  assert.equal(result.status, "success");
  assert.deepEqual(result.output, { echoed: { x: 1 } });
});

test("permissions: deny-by-default blocks and the tool never runs", async () => {
  const echo = echoTool();
  const { engine, audit } = makeEngine({ tools: [echo.tool], grants: [] });
  const result = await engine.execute(req(engine));
  assert.equal(result.status, "denied");
  assert.equal(result.error?.reason, "permission_denied");
  assert.equal(echo.calls, 0);
  const decision = audit.list().find((e) => e.type === "permission_decision");
  assert.equal((decision?.data as { allowed?: boolean }).allowed, false);
});

test("permissions: an explicit deny beats an allow", async () => {
  const echo = echoTool();
  const { engine } = makeEngine({
    tools: [echo.tool],
    grants: [
      ALLOW_READ,
      { effect: "deny", action: "read", projectId: "proj-a" },
    ],
  });
  const result = await engine.execute(req(engine));
  assert.equal(result.status, "denied");
  assert.equal(echo.calls, 0);
});

/* ================================================================== */
/* APPROVAL                                                            */
/* ================================================================== */

const approvalDef = baseDef({
  id: "t.write",
  name: "Writer",
  requiredPermission: { action: "write" },
  approvalPolicy: { always: true, reason: "writes require sign-off" },
});

function writerEngine(grants: PermissionGrant[] = []) {
  const echo = echoTool({ ...approvalDef }, () => ({ wrote: true }));
  const fixture = makeEngine({
    tools: [echo.tool],
    grants: [
      { effect: "allow", action: "write", agentId: "agent-a" },
      ...grants,
    ],
  });
  return { ...fixture, echo };
}

test("approval: a gated tool stops with approval_required and does not run", async () => {
  const { engine, echo, audit } = writerEngine();
  const request = engine.createRequest({
    taskId: "task-1",
    agentId: "agent-a",
    projectId: "proj-a",
    toolId: "t.write",
    action: "write",
  });
  const result = await engine.execute(request);
  assert.equal(result.status, "approval_required");
  assert.ok(result.approvalId);
  assert.equal(echo.calls, 0);
  assert.ok(audit.list().some((e) => e.type === "approval_requested"));
});

test("approval: resume before a decision throws", async () => {
  const { engine } = writerEngine();
  const request = engine.createRequest({
    taskId: "task-1",
    agentId: "agent-a",
    projectId: "proj-a",
    toolId: "t.write",
    action: "write",
  });
  const parked = await engine.execute(request);
  await assert.rejects(engine.resume(parked.requestId), /still pending/);
});

test("approval: approve then resume runs the tool", async () => {
  const { engine, echo, approvals, audit } = writerEngine();
  const request = engine.createRequest({
    taskId: "task-1",
    agentId: "agent-a",
    projectId: "proj-a",
    toolId: "t.write",
    action: "write",
  });
  const parked = await engine.execute(request);
  approvals.decide(parked.approvalId!, "approved", "human:sam");
  const result = await engine.resume(parked.requestId);
  assert.equal(result.status, "success");
  assert.deepEqual(result.output, { wrote: true });
  assert.equal(echo.calls, 1);
  assert.ok(audit.list().some((e) => e.type === "approval_decided"));
});

test("approval: reject then resume denies without running", async () => {
  const { engine, echo, approvals } = writerEngine();
  const request = engine.createRequest({
    taskId: "task-1",
    agentId: "agent-a",
    projectId: "proj-a",
    toolId: "t.write",
    action: "write",
  });
  const parked = await engine.execute(request);
  approvals.decide(parked.approvalId!, "rejected", "human:sam");
  const result = await engine.resume(parked.requestId);
  assert.equal(result.status, "denied");
  assert.equal(result.error?.reason, "approval_rejected");
  assert.equal(echo.calls, 0);
});

test("approval: an expired approval denies on resume", async () => {
  const { engine, echo, approvals } = writerEngine();
  const request = engine.createRequest({
    taskId: "task-1",
    agentId: "agent-a",
    projectId: "proj-a",
    toolId: "t.write",
    action: "write",
  });
  const parked = await engine.execute(request);
  approvals.expire(parked.approvalId!);
  const result = await engine.resume(parked.requestId);
  assert.equal(result.status, "denied");
  assert.equal(result.error?.reason, "approval_expired");
  assert.equal(echo.calls, 0);
});

test("approval: environment-scoped policy only gates the named environment", async () => {
  const def = baseDef({
    id: "t.deploy",
    requiredPermission: { action: "deploy" },
    allowedEnvironments: ["staging", "production"],
    approvalPolicy: { environments: ["production"] },
  });
  const echo = echoTool({ ...def }, () => ({ deployed: true }));
  const { engine } = makeEngine({
    tools: [echo.tool],
    grants: [{ effect: "allow", action: "deploy", agentId: "agent-a" }],
  });

  const staging = await engine.execute(
    engine.createRequest({
      taskId: "t",
      agentId: "agent-a",
      projectId: "proj-a",
      toolId: "t.deploy",
      action: "deploy",
      environment: "staging",
    }),
  );
  assert.equal(staging.status, "success");

  const prod = await engine.execute(
    engine.createRequest({
      taskId: "t",
      agentId: "agent-a",
      projectId: "proj-a",
      toolId: "t.deploy",
      action: "deploy",
      environment: "production",
    }),
  );
  assert.equal(prod.status, "approval_required");
});

/* ================================================================== */
/* EXECUTION                                                           */
/* ================================================================== */

test("execution: success returns output + lifecycle audit phases", async () => {
  const { engine, audit } = makeEngine({ tools: [echoTool().tool] });
  const result = await engine.execute(req(engine));
  assert.equal(result.status, "success");
  assert.ok(result.durationMs >= 0);
  const phases = audit
    .list()
    .filter((e) => e.type === "tool_execution")
    .map((e) => (e.data as { phase: string }).phase);
  for (const p of [
    "requested",
    "validated",
    "resolved",
    "authorized",
    "executing",
    "completed",
  ]) {
    assert.ok(phases.includes(p), `missing phase: ${p}`);
  }
});

test("execution: a throwing tool is a structured failure", async () => {
  const echo = echoTool({}, () => {
    throw new Error("handler blew up");
  });
  const { engine, audit } = makeEngine({ tools: [echo.tool] });
  const result = await engine.execute(req(engine));
  assert.equal(result.status, "failure");
  assert.equal(result.error?.reason, "tool_error");
  assert.match(result.error!.message, /handler blew up/);
  assert.ok(
    audit
      .list()
      .some(
        (e) =>
          e.type === "tool_execution" &&
          (e.data as { phase?: string }).phase === "failed",
      ),
  );
});

test("execution: a slow tool is reported as timeout, output discarded", async () => {
  let clockValue = 0;
  const echo = echoTool({ timeoutMs: 100 }, () => {
    clockValue += 5_000;
    return { late: true };
  });
  const { engine } = makeEngine({
    tools: [echo.tool],
    clock: () => clockValue,
  });
  const result = await engine.execute(req(engine));
  assert.equal(result.status, "timeout");
  assert.equal(result.error?.reason, "timeout");
  assert.equal(result.output, undefined);
});

test("execution: a malformed result (output schema) fails", async () => {
  const echo = echoTool(
    {
      outputSchema: (value) => {
        if (!value || typeof value !== "object" || !("ok" in value)) {
          throw new Error("expected { ok }");
        }
      },
    },
    () => ({ nope: true }),
  );
  const { engine } = makeEngine({ tools: [echo.tool] });
  const result = await engine.execute(req(engine));
  assert.equal(result.status, "failure");
  assert.equal(result.error?.reason, "malformed_result");
});

test("execution: an input-schema violation fails before the tool runs", async () => {
  const echo = echoTool({
    inputSchema: (value) => {
      if (!value || typeof value !== "object" || !("query" in value)) {
        throw new Error("expected { query }");
      }
    },
  });
  const { engine } = makeEngine({ tools: [echo.tool] });
  const result = await engine.execute(req(engine, { input: { wrong: 1 } }));
  assert.equal(result.status, "failure");
  assert.equal(result.error?.reason, "malformed_result");
  assert.equal(echo.calls, 0);
});

test("execution: per-task call limit stops further calls", async () => {
  const echo = echoTool({
    limits: { ...DEFAULT_TOOL_LIMITS, maxCallsPerTask: 2 },
  });
  const { engine } = makeEngine({ tools: [echo.tool] });
  assert.equal((await engine.execute(req(engine))).status, "success");
  assert.equal((await engine.execute(req(engine))).status, "success");
  const third = await engine.execute(req(engine));
  assert.equal(third.status, "failure");
  assert.equal(third.error?.reason, "call_limit_exceeded");
  assert.equal((third.error?.details as { scope?: string }).scope, "task");
  assert.equal(echo.calls, 2);
});

test("execution: per-agent call limit stops further calls", async () => {
  const echo = echoTool({
    limits: { ...DEFAULT_TOOL_LIMITS, maxCallsPerAgent: 1 },
  });
  const { engine } = makeEngine({ tools: [echo.tool] });
  assert.equal(
    (await engine.execute(req(engine, { taskId: "task-1" }))).status,
    "success",
  );
  const second = await engine.execute(req(engine, { taskId: "task-2" }));
  assert.equal(second.status, "failure");
  assert.equal((second.error?.details as { scope?: string }).scope, "agent");
});

test("execution: input over the size limit fails before running", async () => {
  const echo = echoTool({
    limits: { ...DEFAULT_TOOL_LIMITS, maxInputBytes: 20 },
  });
  const { engine } = makeEngine({ tools: [echo.tool] });
  const result = await engine.execute(
    req(engine, { input: { blob: "x".repeat(100) } }),
  );
  assert.equal(result.status, "failure");
  assert.equal(result.error?.reason, "input_too_large");
  assert.equal(echo.calls, 0);
});

test("execution: output over the size limit fails", async () => {
  const echo = echoTool(
    { limits: { ...DEFAULT_TOOL_LIMITS, maxOutputBytes: 20 } },
    () => ({ blob: "y".repeat(100) }),
  );
  const { engine } = makeEngine({ tools: [echo.tool] });
  const result = await engine.execute(req(engine));
  assert.equal(result.status, "failure");
  assert.equal(result.error?.reason, "output_too_large");
});

test("execution: an engine-wide ceiling overrides a permissive tool limit", async () => {
  const echo = echoTool({
    limits: { ...DEFAULT_TOOL_LIMITS, maxCallsPerTask: 100 },
  });
  const { engine } = makeEngine({
    tools: [echo.tool],
    limits: { maxCallsPerTask: 1 },
  });
  assert.equal((await engine.execute(req(engine))).status, "success");
  assert.equal(
    (await engine.execute(req(engine))).error?.reason,
    "call_limit_exceeded",
  );
});

/* ================================================================== */
/* SECURITY                                                            */
/* ================================================================== */

test("security: a tool cannot bypass the permission system", async () => {
  const echo = echoTool();
  const { engine } = makeEngine({ tools: [echo.tool], grants: [] });
  await engine.execute(req(engine));
  await engine.execute(req(engine));
  assert.equal(echo.calls, 0, "handler must never run without permission");
});

test("security: a tool cannot bypass approval", async () => {
  const { engine, echo } = writerEngine();
  const request = engine.createRequest({
    taskId: "task-1",
    agentId: "agent-a",
    projectId: "proj-a",
    toolId: "t.write",
    action: "write",
  });
  await engine.execute(request);
  assert.equal(echo.calls, 0, "handler must not run before approval");
});

test("security: project isolation — a grant scoped to one project does not leak", async () => {
  const echo = echoTool({ allowedProjects: ["*"] });
  const { engine } = makeEngine({
    tools: [echo.tool],
    grants: [
      {
        effect: "allow",
        action: "read",
        agentId: "agent-a",
        projectId: "proj-a",
      },
    ],
  });
  assert.equal(
    (await engine.execute(req(engine, { projectId: "proj-a" }))).status,
    "success",
  );
  const other = await engine.execute(req(engine, { projectId: "proj-b" }));
  assert.equal(other.status, "denied");
  assert.equal(other.error?.reason, "permission_denied");
});

test("security: the audit trail never contains tool output payloads", async () => {
  const secret = "SECRET-PAYLOAD-DO-NOT-LOG";
  const echo = echoTool({}, () => ({ secret, ok: true }));
  const { engine, audit } = makeEngine({ tools: [echo.tool] });
  const result = await engine.execute(req(engine));
  assert.equal(result.status, "success");
  assert.ok(!JSON.stringify(audit.list()).includes(secret));
});

/* ================================================================== */
/* RESET / INTROSPECTION                                               */
/* ================================================================== */

test("engine: callCounts + reset", async () => {
  const { engine } = makeEngine({ tools: [echoTool().tool] });
  await engine.execute(req(engine));
  assert.equal(engine.callCounts().task["task-1::t.echo"], 1);
  engine.reset();
  assert.deepEqual(engine.callCounts().task, {});
});

test("engine: resume on an unknown request id throws NotFoundError", async () => {
  const { engine } = makeEngine({ tools: [echoTool().tool] });
  await assert.rejects(engine.resume("toolreq_ghost"), NotFoundError);
});
