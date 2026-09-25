/**
 * EO-4.5 reusable adapter contract suite + deterministic runner test double.
 *
 * Every EnvironmentExecutionAdapter must satisfy the same behaviour:
 * compatibility, readiness, bounded invocation, timeout, cancellation,
 * receipts evidence and error normalization. Physical platforms are NOT
 * required: FakeRunner is a TEST-ONLY runner (`simulated: true`).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  EXECUTION_ERROR_CODES,
  type EnvironmentExecutionAdapter,
  type EnvironmentInstance,
  type EnvironmentOperationRequirement,
  type ExecutionOperationDefinition,
  type ExecutionRunner,
  type HostInstance,
  type RunnerDescriptor,
  type RunnerHeartbeat,
  type RunnerJobSpec,
  type RunnerRunOptions,
  type RunnerRunResult,
  type RunnerStatus,
  type SandboxSpec,
  type StructuredInvocation,
} from "../../contracts/index.js";
import { EnvironmentAdapterRegistry } from "../../core/index.js";

/* ------------------------------------------------------------------ */
/* FakeRunner (test double)                                           */
/* ------------------------------------------------------------------ */

export interface FakeRunnerOptions {
  runnerId: string;
  adapterId: string;
  instances: readonly string[];
  runnerClass?: RunnerDescriptor["runnerClass"];
  trust?: RunnerDescriptor["trust"];
  verified?: boolean;
  capacity?: number;
  projectIds?: readonly string[];
  credentialRef?: RunnerDescriptor["credentialRef"];
  routing?: RunnerDescriptor["routing"];
  isolated?: boolean;
}

/**
 * Behaviour is chosen by the FIXED argv of the registered operation:
 * `ok [fingerprint]`, `hang`, `disconnect`, `throw`, `fail`, `echo-credential`.
 */
export class FakeRunner implements ExecutionRunner {
  readonly descriptor: RunnerDescriptor;
  status: RunnerStatus = "online";
  healthy = true;
  heartbeatAge = 0;
  readonly calls = { prepare: 0, run: 0, cancel: 0, release: 0 };
  readonly credentialsSeen: string[] = [];
  readonly files = new Map<string, Uint8Array>();
  private readonly aborts = new Map<string, () => void>();

  constructor(options: FakeRunnerOptions) {
    const isolated = options.isolated ?? true;
    this.descriptor = {
      runnerId: options.runnerId,
      adapterId: options.adapterId,
      environmentInstanceIds: options.instances,
      runnerClass: options.runnerClass ?? "self_hosted",
      trust: options.trust ?? "trusted",
      identity: {
        fingerprint: `key-${options.runnerId}`,
        verified: options.verified ?? true,
      },
      capacity: options.capacity ?? 2,
      ...(options.projectIds ? { projectIds: options.projectIds } : {}),
      ...(options.credentialRef
        ? { credentialRef: options.credentialRef }
        : {}),
      ...(options.routing ? { routing: options.routing } : {}),
      sandbox: {
        filesystemIsolation: isolated,
        networkIsolation: isolated,
        enforcedLimits: [
          "sessionTimeoutMs",
          "operationTimeoutMs",
          "maxOutputBytes",
          "maxArtifactBytes",
          "maxToolCalls",
        ],
        networkModes: ["deny_all"],
        supportsKill: true,
      },
      simulated: true,
    };
  }

  heartbeat(): RunnerHeartbeat {
    return {
      status: this.status,
      at: new Date(Date.now() - this.heartbeatAge).toISOString(),
    };
  }

  async healthCheck() {
    return this.healthy
      ? { ready: true, detail: "ok" }
      : { ready: false, detail: "toolchain probe failed" };
  }

  async prepare(_spec: RunnerJobSpec) {
    this.calls.prepare += 1;
  }

  async run(
    jobId: string,
    invocation: StructuredInvocation,
    options: RunnerRunOptions,
  ): Promise<RunnerRunResult> {
    this.calls.run += 1;
    if (options.credential) this.credentialsSeen.push(options.credential);
    const [mode, fingerprint] = invocation.argv;
    const out = (
      text: string,
      exitClass: RunnerRunResult["exitClass"] = "success",
    ): RunnerRunResult => ({
      exitClass,
      exitCode: exitClass === "success" ? 0 : 1,
      stdout: { text, truncated: false, originalBytes: text.length },
      stderr: { text: "", truncated: false, originalBytes: 0 },
      durationMs: 1,
      redactions: 0,
      ...(fingerprint ? { sourceFingerprint: fingerprint } : {}),
      toolchains: [{ kind: "fake", version: "1.0.0" }],
    });
    if (mode === "throw") throw new Error("runner crashed");
    if (mode === "fail") return out("tests failed", "tool_failure");
    if (mode === "echo-credential") return out(`token=${options.credential}`);
    if (mode === "hang" || mode === "disconnect") {
      if (mode === "disconnect")
        setTimeout(() => (this.status = "offline"), 30);
      await new Promise<void>((resolve) => {
        this.aborts.set(jobId, resolve);
        options.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
      return out("", "cancelled");
    }
    return out("ok");
  }

  async cancel(jobId: string) {
    this.calls.cancel += 1;
    this.aborts.get(jobId)?.();
  }

  async release(jobId: string) {
    this.calls.release += 1;
    this.aborts.delete(jobId);
  }

  async readArtifact(_projectId: string, path: string) {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error("missing");
    return bytes;
  }

  async writeArtifact(_projectId: string, path: string, bytes: Uint8Array) {
    this.files.set(path, bytes);
    return {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.byteLength,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

export function stubEnvironments(
  hosts: readonly HostInstance[],
  instances: readonly EnvironmentInstance[],
) {
  return {
    getInstance: (id: string) => instances.find((i) => i.id === id),
    getHost: (id: string) => hosts.find((h) => h.hostId === id || h.id === id),
    listInstances: () => [...instances],
  };
}

export function envOperation(
  id: string,
  environment: EnvironmentOperationRequirement,
  overrides: Partial<ExecutionOperationDefinition> = {},
): ExecutionOperationDefinition {
  return {
    id,
    toolId: `${environment.family}-tool`,
    stageKind: "build",
    description: id,
    requiredCapabilities: ["process.invoke.bounded"],
    risk: "low",
    input: {},
    output: { kind: "text" },
    workspaceAccess: "none",
    networkAccess: "none",
    executionClass: "diagnostic",
    environment,
    ...overrides,
  };
}

export function sandboxSpec(
  environmentInstanceId: string,
  projectId = "alpha",
  sessionId = `ses-${Math.random().toString(36).slice(2)}`,
): SandboxSpec {
  return {
    sessionId,
    projectId,
    environmentInstanceId,
    workspace: {
      workspaceId: `ws-${sessionId}`,
      sessionId,
      projectId,
      rootRef: `workspace://${projectId}/ws`,
      mode: "read_only",
      status: "requested",
    },
    limits: {
      sessionTimeoutMs: 60_000,
      operationTimeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
      maxArtifactBytes: 1_000_000,
      maxToolCalls: 10,
    },
    network: { mode: "deny_all" },
    grants: [],
  };
}

export function invocation(
  executableId: string,
  argv: string[],
  timeoutMs = 5_000,
): StructuredInvocation {
  return {
    executableId,
    operationId: "contract.op",
    argv,
    workingDirectoryRef: "workspace://contract",
    environmentVariableRefs: [],
    timeoutMs,
  };
}

/* ------------------------------------------------------------------ */
/* The reusable contract                                              */
/* ------------------------------------------------------------------ */

export interface AdapterContractFixture {
  name: string;
  adapter: () => EnvironmentExecutionAdapter;
  hosts: readonly HostInstance[];
  instances: readonly EnvironmentInstance[];
  readyInstanceId: string;
  /** An instance of a different platform/toolchain that must be refused. */
  incompatibleInstanceId: string;
  requirement: EnvironmentOperationRequirement;
  executableId: string;
}

const KNOWN_CODES = new Set<string>(EXECUTION_ERROR_CODES);

export function adapterContractSuite(f: AdapterContractFixture): void {
  const make = () => {
    const registry = new EnvironmentAdapterRegistry({
      environments: stubEnvironments(f.hosts, f.instances),
      heartbeatPollMs: 10,
      timeoutGraceMs: 30,
    });
    const adapter = f.adapter();
    registry.registerAdapter(adapter);
    const runner = new FakeRunner({
      runnerId: `${f.name}-runner`,
      adapterId: adapter.adapterId,
      instances: [f.readyInstanceId],
    });
    const provider = registry.registerRunner(runner);
    const op = envOperation(`${f.name}.op`, f.requirement);
    return { registry, adapter, runner, provider, op };
  };
  const ctx = (id: string) => {
    const instance = f.instances.find((i) => i.id === id)!;
    const host = f.hosts.find((h) => h.hostId === instance.hostId)!;
    return { instance, host };
  };

  test(`74 CONTRACT [${f.name}] compatibility: eligible vs refused with normalized codes`, () => {
    const { adapter } = make();
    const ok = adapter.evaluate(ctx(f.readyInstanceId), f.requirement);
    assert.equal(ok.eligible, true, JSON.stringify(ok.reasons));
    const no = adapter.evaluate(ctx(f.incompatibleInstanceId), f.requirement);
    assert.equal(no.eligible, false);
    assert.ok(no.reasons.length > 0);
    for (const r of no.reasons) assert.ok(KNOWN_CODES.has(r.code), r.code);
    // Deterministic.
    assert.deepEqual(
      adapter.evaluate(ctx(f.incompatibleInstanceId), f.requirement),
      no,
    );
  });

  test(`74 CONTRACT [${f.name}] readiness: discovered + adapter + live runner; offline runner is not ready`, () => {
    const { registry, runner, op } = make();
    const ready = registry.resolve({
      projectId: "alpha",
      environmentInstanceId: f.readyInstanceId,
      operation: op,
      executableId: f.executableId,
    });
    assert.equal(ready.ready, true, JSON.stringify(ready.reasons));
    assert.equal(ready.runnerId, runner.descriptor.runnerId);
    runner.status = "offline";
    const down = registry.resolve({
      projectId: "alpha",
      environmentInstanceId: f.readyInstanceId,
      operation: op,
      executableId: f.executableId,
    });
    assert.equal(down.ready, false);
    assert.equal(down.reasons[0]!.code, "RUNNER_UNAVAILABLE");
    runner.status = "online";
    runner.heartbeatAge = 10 * 60_000;
    assert.equal(
      registry.resolve({
        projectId: "alpha",
        environmentInstanceId: f.readyInstanceId,
        operation: op,
      }).ready,
      false,
      "a stale heartbeat is not ready",
    );
  });

  test(`74 CONTRACT [${f.name}] bounded invocation: lease, receipt evidence, release`, async () => {
    const { registry, provider, runner, adapter } = make();
    const handle = await provider.start(sandboxSpec(f.readyInstanceId));
    assert.equal(registry.activeLeases(runner.descriptor.runnerId).length, 1);
    const outcome = await provider.invoke(
      handle,
      invocation(f.executableId, ["ok"]),
      {
        signal: new AbortController().signal,
        maxOutputBytes: 1024,
      },
    );
    assert.equal(outcome.exitClass, "success");
    assert.deepEqual(
      {
        adapterId: outcome.environment!.adapterId,
        adapterVersion: outcome.environment!.adapterVersion,
        runnerId: outcome.environment!.runnerId,
        runnerIdentity: outcome.environment!.runnerIdentity,
        environmentInstanceId: outcome.environment!.environmentInstanceId,
        simulated: outcome.environment!.simulated,
      },
      {
        adapterId: adapter.adapterId,
        adapterVersion: adapter.version,
        runnerId: runner.descriptor.runnerId,
        runnerIdentity: runner.descriptor.identity.fingerprint,
        environmentInstanceId: f.readyInstanceId,
        simulated: true,
      },
    );
    await provider.cleanup(handle);
    assert.equal(registry.activeLeases(runner.descriptor.runnerId).length, 0);
    assert.equal(runner.calls.release, 1);
  });

  test(`74 CONTRACT [${f.name}] timeout: a hanging runner is cancelled and normalized`, async () => {
    const { provider, runner } = make();
    const handle = await provider.start(sandboxSpec(f.readyInstanceId));
    const outcome = await provider.invoke(
      handle,
      invocation(f.executableId, ["hang"], 40),
      {
        signal: new AbortController().signal,
        maxOutputBytes: 1024,
      },
    );
    assert.equal(outcome.exitClass, "timeout");
    assert.equal(outcome.denial!.code, "RUNNER_TIMEOUT");
    assert.equal(runner.calls.cancel, 1);
    await provider.cleanup(handle);
  });

  test(`74 CONTRACT [${f.name}] cancellation propagates Manager → adapter → runner`, async () => {
    const { provider, runner } = make();
    const handle = await provider.start(sandboxSpec(f.readyInstanceId));
    const controller = new AbortController();
    const pending = provider.invoke(
      handle,
      invocation(f.executableId, ["hang"]),
      {
        signal: controller.signal,
        maxOutputBytes: 1024,
      },
    );
    setTimeout(() => controller.abort(), 20);
    const outcome = await pending;
    assert.equal(outcome.exitClass, "cancelled");
    assert.equal(runner.calls.cancel, 1);
    await provider.cleanup(handle);
  });

  test(`74 CONTRACT [${f.name}] error normalization: crash → ADAPTER_ERROR, never success`, async () => {
    const { provider } = make();
    const handle = await provider.start(sandboxSpec(f.readyInstanceId));
    const outcome = await provider.invoke(
      handle,
      invocation(f.executableId, ["throw"]),
      {
        signal: new AbortController().signal,
        maxOutputBytes: 1024,
      },
    );
    assert.equal(outcome.exitClass, "sandbox_failure");
    assert.equal(outcome.denial!.code, "ADAPTER_ERROR");
    await provider.cleanup(handle);
  });
}
